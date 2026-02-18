import asyncio
import logging
import os
import re
from typing import Dict, Tuple, Optional

from dotenv import load_dotenv

from database.db import (
    create_table,
    close_db,
    get_user,
    register_user,
    get_top_users_stats,
)
from web_server import run_web_server

# MAX bot framework (max-botapi-python / maxapi)
from maxapi import Bot, Dispatcher

# Фильтры/типы
from maxapi.types import BotStarted, Command, MessageCreated

# Кнопки (в библиотеке maxapi есть готовые payload/кнопки)
try:
    from maxapi.types import (
        ButtonsPayload,
        CallbackButton,
        LinkButton,
        ButtonType,
        Intent,
    )
except Exception:  # на случай несовпадения версий
    ButtonsPayload = CallbackButton = LinkButton = ButtonType = Intent = None  # type: ignore


load_dotenv()

TOKEN = (os.getenv("MAX_BOT_TOKEN") or "").strip()
if not TOKEN:
    raise RuntimeError("Не найден токен MAX_BOT_TOKEN в .env")

GAME_URL = (os.getenv("GAME_URL") or os.getenv("WEBAPP_URL") or "").strip().rstrip("/")

# --- простое состояние регистрации для MAX (не трогаем Telegram FSM) ---
# В MAX у BotStarted может не приходить user_id (зависит от версии/типа события),
# поэтому состояние храним по chat_id (в личке chat_id обычно стабилен).
REG_STATE: Dict[int, str] = {}               # chat_id -> "waiting_fullname" | "waiting_age"
REG_NAME: Dict[int, Tuple[str, str]] = {}    # chat_id -> (first_name, last_name)
CHAT_USER: Dict[int, int] = {}               # chat_id -> user_id (если удалось достать)


def _parse_fullname(text: str) -> Optional[Tuple[str, str]]:
    text = (text or "").strip()
    parts = [p for p in text.split() if p]
    if len(parts) < 2:
        return None
    first_name = parts[0]
    last_name = " ".join(parts[1:])

    # Мягкая валидация: русские буквы/дефис
    ru_re = re.compile(r"^[А-Яа-яЁё\-]+$")
    if not ru_re.match(first_name):
        return None
    for p in last_name.split():
        if not ru_re.match(p):
            return None
    return first_name, last_name


def _parse_age(text: str) -> Optional[int]:
    text = (text or "").strip()
    m = re.search(r"\d+", text)
    if not m:
        return None
    age = int(m.group())
    if age < 6 or age > 120:
        return None
    return age


def _norm_start_word(text: str) -> str:
    return (text or "").strip().lower()


def _is_start_request(text: str) -> bool:
    t = _norm_start_word(text)
    # MAX-кнопка «Начать» часто отправляет обычный текст
    if t in {"начать", "start", "старт"}:
        return True
    return False


def _is_stats_request(text: str) -> bool:
    t = _norm_start_word(text)
    return t in {"статистика", "stats", "/stats"}


def _extract_chat_id_from_any(event) -> int:
    """Достаём chat_id максимально совместимо.

    По актуальным примерам библиотеки maxapi / max-botapi-python:
    - BotStarted: event.chat_id
    - MessageCreated: чаще всего тоже доступен event.chat_id
      (в некоторых версиях chat_id лежит внутри event.message.chat_id / chatId).
    """

    # 1) Самый надёжный путь — event.chat_id / event.chatId
    chat_id = getattr(event, "chat_id", None) or getattr(event, "chatId", None)

    # 2) Иногда chat_id находится в event.message
    msg = getattr(event, "message", None)
    if not chat_id and msg is not None:
        chat_id = getattr(msg, "chat_id", None) or getattr(msg, "chatId", None)

    # 3) Иногда message может быть dict/pydantic — вытащим из дампа
    if not chat_id and msg is not None:
        try:
            dump = None
            if hasattr(msg, "model_dump"):
                dump = msg.model_dump()  # pydantic v2
            elif hasattr(msg, "dict"):
                dump = msg.dict()  # pydantic v1
            if isinstance(dump, dict):
                chat_id = dump.get("chat_id") or dump.get("chatId")
                if not chat_id and isinstance(dump.get("chat"), dict):
                    chat = dump.get("chat")
                    chat_id = chat.get("chat_id") or chat.get("chatId") or chat.get("id")
        except Exception:
            pass

    try:
        return int(chat_id or 0)
    except Exception:
        return 0


def _extract_user_id_from_message(event: MessageCreated) -> int:
    msg = getattr(event, "message", None)
    if msg is None:
        return 0
    sender = getattr(msg, "sender", None) or getattr(event, "sender", None)
    user_id = (
        getattr(sender, "user_id", None)
        or getattr(sender, "userId", None)
        or getattr(sender, "id", None)
        or getattr(event, "user_id", None)
        or getattr(event, "userId", None)
        or 0
    )
    try:
        return int(user_id or 0)
    except Exception:
        return 0


def _get_message_text(event: MessageCreated) -> str:
    """Достаём текст из входящего сообщения MAX максимально совместимо.

    В актуальных примерах maxapi используется event.message.body.text. 
    """
    msg = getattr(event, "message", None)
    if msg is None:
        return ""

    body = getattr(msg, "body", None)

    # 1) основной путь: message.body.text
    if body is not None:
        t = getattr(body, "text", None)
        if isinstance(t, str) and t.strip():
            return t

    # 2) запасные варианты: message.text
    t2 = getattr(msg, "text", None)
    if isinstance(t2, str) and t2.strip():
        return t2

    # 3) dict-like body/message
    try:
        if isinstance(body, dict) and isinstance(body.get("text"), str) and body.get("text").strip():
            return body.get("text")  # type: ignore[return-value]
        if isinstance(msg, dict) and isinstance(msg.get("text"), str) and msg.get("text").strip():
            return msg.get("text")  # type: ignore[return-value]
    except Exception:
        pass

    # 4) pydantic dump (в разных версиях поля могут называться по-разному)
    try:
        dump = None
        if hasattr(msg, "model_dump"):
            dump = msg.model_dump()
        elif hasattr(msg, "dict"):
            dump = msg.dict()
        if isinstance(dump, dict):
            b = dump.get("body")
            if isinstance(b, dict) and isinstance(b.get("text"), str) and b.get("text").strip():
                return b.get("text")
            if isinstance(dump.get("text"), str) and dump.get("text").strip():
                return dump.get("text")
    except Exception:
        pass

    return ""


def _keyboard_main_menu():
    """Собираем клавиатуру MAX (если типы доступны в версии библиотеки)."""
    if not (ButtonsPayload and CallbackButton and ButtonType and Intent):
        return None

    buttons = []

    # «Зайти на завод» — ссылка на webapp/игру
    if GAME_URL and LinkButton and ButtonType:
        try:
            btn_play = LinkButton(
                type=ButtonType.LINK,
                text="🏭 Зайти на завод",
                url=GAME_URL,
                intent=getattr(Intent, "PRIMARY", getattr(Intent, "DEFAULT", None)),
            )
            buttons.append([btn_play])
        except Exception:
            pass

    # «Статистика» — callback
    try:
        btn_stats = CallbackButton(
            type=ButtonType.CALLBACK,
            text="📊 Статистика",
            payload="stats",
            intent=getattr(Intent, "POSITIVE", getattr(Intent, "DEFAULT", None)),
        )
        buttons.append([btn_stats])
    except Exception:
        pass

    if not buttons:
        return None

    try:
        return ButtonsPayload(buttons=buttons)
    except Exception:
        return None


async def _send_menu(bot: Bot, chat_id: int, text: str) -> None:
    kb = _keyboard_main_menu()
    if kb is not None:
        try:
            await bot.send_message(chat_id=chat_id, text=text, attachments=[kb])
            return
        except Exception:
            # Если в текущей версии attachments/keyboard отличаются — просто отправим текст
            pass
    await bot.send_message(chat_id=chat_id, text=text)


async def _send_welcome(bot: Bot, chat_id: int, user_id: int) -> None:
    # запоминаем user_id для этого чата (если пришёл)
    if user_id:
        CHAT_USER[chat_id] = user_id

    db_user_id = CHAT_USER.get(chat_id) or chat_id

    user = await get_user(db_user_id)
    if user:
        _, first_name, *_ = user
        text = f"С возвращением, {first_name}!"
        await _send_menu(bot, chat_id, text)
        return

    # новая регистрация / перезапуск регистрации
    REG_STATE[chat_id] = "waiting_fullname"
    REG_NAME.pop(chat_id, None)

    await bot.send_message(
        chat_id=chat_id,
        text=(
            "Добро пожаловать на АПЗ!\n"
            "✍️ Введите Имя и Фамилию одним сообщением (через пробел).\n"
            "Пример: Иван Иванов\n\n"
            "Если вы уже нажимали «Начать», но бот перезапустился — просто нажмите «Начать» ещё раз."
        ),
    )


async def _send_stats(event: MessageCreated, chat_id: int, db_user_id: int) -> None:
    user = await get_user(db_user_id)
    if not user:
        # Если человек не зарегистрирован — предлагаем старт
        await event.message.answer("Сначала нажми «Начать» и пройди регистрацию.")
        return

    try:
        rows = await get_top_users_stats(limit=20)
    except Exception:
        rows = []

    lines = ["🏆 Топ игроков:"]
    if not rows:
        lines.append("Пока нет данных.")
    else:
        for i, r in enumerate(rows, start=1):
            try:
                _uid, fn, ln, _age, score, *_ = r
                name = f"{fn} {ln}".strip()
            except Exception:
                name = str(r[0])
                score = r[1] if len(r) > 1 else 0
            lines.append(f"{i}. {name} — {score}")

    await event.message.answer("\n".join(lines))


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    await create_table()

    bot = Bot(TOKEN)
    dp = Dispatcher()

    # Если у бота раньше был установлен webhook — polling не получит события,
    # пока webhook не удалить (сказано в README библиотеки). 
    try:
        await bot.delete_webhook()
    except Exception:
        pass

    @dp.bot_started()
    async def on_bot_started(event: BotStarted):
        chat_id = _extract_chat_id_from_any(event)
        if not chat_id:
            return
        # В BotStarted user_id может не быть — это нормально.
        user_id = getattr(event, "user_id", None) or getattr(event, "userId", None) or 0
        try:
            user_id = int(user_id or 0)
        except Exception:
            user_id = 0
        await _send_welcome(event.bot, chat_id, user_id)

    @dp.message_created(Command("stats"))
    async def on_stats(event: MessageCreated):
        chat_id = _extract_chat_id_from_any(event)
        user_id = _extract_user_id_from_message(event)
        if user_id:
            CHAT_USER[chat_id] = user_id
        db_user_id = CHAT_USER.get(chat_id) or chat_id
        await _send_stats(event, chat_id, db_user_id)

    # Ловим callback по кнопке «Статистика»
    try:
        from maxapi.types import CallbackCreated
        from maxapi import F  # фильтры как в примерах/документации 

        @dp.callback_created(F.callback.payload == "stats")
        async def on_stats_button(event: CallbackCreated):
            chat_id = _extract_chat_id_from_any(event)
            user_id = getattr(getattr(event, "callback", None), "user_id", None) or getattr(event, "user_id", None) or 0
            try:
                user_id = int(user_id or 0)
            except Exception:
                user_id = 0
            if user_id:
                CHAT_USER[chat_id] = user_id
            db_user_id = CHAT_USER.get(chat_id) or chat_id
            # отвечаем тем же топом
            # CallbackCreated обычно не имеет message.answer, поэтому шлём через bot
            tmp_event = type("Tmp", (), {"message": type("M", (), {"answer": lambda self, t: event.bot.send_message(chat_id=chat_id, text=t)})()})()
            await _send_stats(tmp_event, chat_id, db_user_id)
    except Exception:
        # Если callback-и в конкретной версии библиотеки недоступны — живём через /stats и текст «Статистика»
        pass

    @dp.message_created()
    async def on_any_message(event: MessageCreated):
        chat_id = _extract_chat_id_from_any(event)
        user_id = _extract_user_id_from_message(event)
        if user_id:
            CHAT_USER[chat_id] = user_id
        db_user_id = CHAT_USER.get(chat_id) or chat_id

        text = _get_message_text(event).strip()

        # Если пользователь нажал «Начать» повторно или хочет перезапустить — поддерживаем это в любой момент
        if _is_start_request(text):
            REG_STATE.pop(chat_id, None)
            REG_NAME.pop(chat_id, None)
            await _send_welcome(event.bot, chat_id, user_id)
            return

        # «Статистика» текстом (на случай, если кнопка/колбек недоступны в конкретной версии клиента)
        if _is_stats_request(text):
            await _send_stats(event, chat_id, db_user_id)
            return

        state = REG_STATE.get(chat_id)

        # Если бот перезапустился и состояние потерялось:
        # - если пользователь не зарегистрирован, не молчим — подскажем нажать «Начать»
        if not state:
            user = await get_user(db_user_id)
            if not user:
                # Частый кейс в MAX: после BotStarted/"Добро пожаловать" chat_id в следующем событии
                # может прийти в другом поле, и мы можем не найти REG_STATE.
                # Чтобы пользователь не застревал, если он прислал "Имя Фамилия" — продолжаем регистрацию автоматически.
                parsed = _parse_fullname(text)
                if parsed:
                    REG_NAME[chat_id] = parsed
                    REG_STATE[chat_id] = "waiting_age"
                    await event.message.answer("Отлично! Теперь введи возраст (числом).")
                    return

                await event.message.answer("Я ещё не знаю вас 🙂 Нажмите «Начать», чтобы пройти регистрацию.")
            return

        if state == "waiting_fullname":
            parsed = _parse_fullname(text)
            if not parsed:
                await event.message.answer("❌ Нужно ввести Имя и Фамилию через пробел.\nПример: Иван Иванов")
                return

            REG_NAME[chat_id] = parsed
            REG_STATE[chat_id] = "waiting_age"
            await event.message.answer("Отлично! Теперь введи возраст (числом).")
            return

        if state == "waiting_age":
            age = _parse_age(text)
            if age is None:
                await event.message.answer("❌ Возраст должен быть числом (например 25). Попробуй ещё раз.")
                return

            first_name, last_name = REG_NAME.get(chat_id, ("", ""))
            try:
                await register_user(db_user_id, first_name, last_name, age)
            except Exception:
                pass

            REG_STATE.pop(chat_id, None)
            REG_NAME.pop(chat_id, None)

            await _send_menu(event.bot, chat_id, "✅ Готово! Ты зарегистрирован(а).")
            return

    # Поднимаем web-сервер (как и в Telegram версии)
    web_task = asyncio.create_task(run_web_server())

    print("MAX-бот запущен...")
    try:
        await dp.start_polling(bot)
    finally:
        web_task.cancel()
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("MAX-бот выключен")
