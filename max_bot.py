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
    get_user_rank,
)
from web_server import run_web_server

# MAX bot framework (max-botapi-python / maxapi)
from maxapi import Bot, Dispatcher, F
from maxapi.enums.intent import Intent
from maxapi.types import BotStarted, Command, MessageCreated

# В разных версиях maxapi часть моделей может быть (или не быть) реэкспортирована в maxapi.types.
# Делаем совместимый импорт.
try:  # pragma: no cover
    from maxapi.types import MessageCallback, CallbackButton, LinkButton
except Exception:  # pragma: no cover
    from maxapi.types.updates.message_callback import MessageCallback
    from maxapi.types.attachments.buttons.callback_button import CallbackButton
    from maxapi.types.attachments.buttons.link_button import LinkButton
from maxapi.utils.inline_keyboard import InlineKeyboardBuilder


load_dotenv()

# ВАЖНО: чтобы не перепутать с Telegram, используем отдельную переменную.
TOKEN = (os.getenv("MAX_BOT_TOKEN") or "").strip()
if not TOKEN:
    raise RuntimeError("Не найден токен MAX_BOT_TOKEN в .env")

GAME_URL = (os.getenv("GAME_URL") or os.getenv("WEBAPP_URL") or "").strip().rstrip("/")

# --- простое состояние регистрации для MAX (не трогаем Telegram FSM) ---
# user_id -> "waiting_fullname" | "waiting_age"
REG_STATE: Dict[int, str] = {}
REG_NAME: Dict[int, Tuple[str, str]] = {}


def _parse_fullname(text: str) -> Optional[Tuple[str, str]]:
    text = (text or "").strip()
    parts = [p for p in text.split() if p]
    if len(parts) < 2:
        return None
    first_name = parts[0]
    last_name = " ".join(parts[1:])

    # Мягкая валидация: русские буквы/дефис/пробелы
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


def _extract_chat_and_user_ids_from_message(event: MessageCreated) -> Tuple[int, int]:
    '''
    MAX SDK может немного отличаться по именам полей.
    Делаем максимально терпимо к разным версиям.
    '''
    msg = getattr(event, "message", None)
    chat_id = getattr(msg, "chat_id", None) or getattr(event, "chat_id", None) or 0

    sender = getattr(msg, "sender", None) or getattr(event, "sender", None)
    user_id = (
        getattr(sender, "user_id", None)
        or getattr(sender, "id", None)
        or getattr(event, "user_id", None)
        or chat_id
        or 0
    )

    return int(chat_id), int(user_id)


def _get_message_text(event: MessageCreated) -> str:
    """Достаём текст из входящего сообщения MAX максимально совместимо.

    В актуальных примерах maxapi используется event.message.body.text.
    В некоторых версиях/типах может быть event.message.text.
    """
    msg = getattr(event, "message", None)
    if msg is None:
        return ""

    # Актуальный путь из документации/примеров: message.body.text
    body = getattr(msg, "body", None)
    if body is not None:
        text = getattr(body, "text", None)
        if isinstance(text, str) and text.strip():
            return text

    # Запасной вариант (на случай другой схемы)
    text2 = getattr(msg, "text", None)
    if isinstance(text2, str) and text2.strip():
        return text2

    # Иногда body может быть dict-подобным
    try:
        if isinstance(body, dict):
            t = body.get("text")
            if isinstance(t, str) and t.strip():
                return t
    except Exception:
        pass

    return ""


def _extract_chat_and_user_ids_from_started(event: BotStarted) -> Tuple[int, int]:
    chat_id = getattr(event, "chat_id", None) or getattr(event, "chatId", None) or 0
    user_id = getattr(event, "user_id", None) or getattr(event, "userId", None) or 0

    # В личном чате chat_id часто = user_id, но не всегда. Подстрахуемся.
    if not user_id and chat_id:
        user_id = chat_id

    return int(chat_id), int(user_id)


async def _send_welcome(bot: Bot, chat_id: int, user_id: int) -> None:
    def _main_keyboard() -> list:
        builder = InlineKeyboardBuilder()
        if GAME_URL:
            builder.row(
                LinkButton(
                    text="🏭 Зайти на завод (Играть)",
                    url=GAME_URL,
                )
            )
        builder.row(
            CallbackButton(
                text="📊 Статистика",
                payload="stats",
                intent=Intent.POSITIVE,
            )
        )
        return [builder.as_markup()]

    user = await get_user(user_id)
    if user:
        _, first_name, *_ = user
        text = f"С возвращением, {first_name}!"
        await bot.send_message(chat_id=chat_id, text=text, attachments=_main_keyboard())
        return

    REG_STATE[user_id] = "waiting_fullname"
    await bot.send_message(
        chat_id=chat_id,
        text=(
            "Добро пожаловать на АПЗ!\n"
            "✍️ Введите Имя и Фамилию одним сообщением (через пробел).\n"
            "Пример: Иван Иванов"
        ),
    )


async def _render_stats_text(user_id: int) -> str:
    user = await get_user(user_id)
    if not user:
        return "Похоже, ты ещё не зарегистрирован(а).\nНажми /start и пройди регистрацию."

    _uid, fn, ln, _age, score = user
    name = f"{fn} {ln}".strip() or "(без имени)"

    try:
        rank_info = await get_user_rank(user_id)
    except Exception:
        rank_info = None

    if rank_info:
        rank, total = rank_info
        head = f"📊 Твоя статистика\n👤 {name}\n⭐ Очки: {score}\n🏅 Место: {rank} из {total}"
    else:
        head = f"📊 Твоя статистика\n👤 {name}\n⭐ Очки: {score}"

    try:
        rows = await get_top_users_stats(limit=10)
    except Exception:
        rows = []

    lines = [head, "", "🏆 Топ игроков:"]
    if not rows:
        lines.append("Пока нет данных.")
    else:
        for i, r in enumerate(rows, start=1):
            try:
                _tid, tfn, tln, tscore, _apt = r
                tname = f"{tfn} {tln}".strip() or "(без имени)"
                lines.append(f"{i}. {tname} — {tscore}")
            except Exception:
                lines.append(f"{i}. {r}")

    return "\n".join(lines)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    await create_table()

    bot = Bot(TOKEN)
    dp = Dispatcher()

    # Если у бота раньше был установлен webhook — polling не получит события,
    # пока webhook не удалить (это прямо сказано в README max-botapi-python).
    try:
        await bot.delete_webhook()
    except Exception:
        pass

    @dp.bot_started()
    async def on_bot_started(event: BotStarted):
        chat_id, user_id = _extract_chat_and_user_ids_from_started(event)
        if not chat_id:
            return
        await _send_welcome(event.bot, chat_id, user_id)

    @dp.message_created(Command("start"))
    async def on_start(event: MessageCreated):
        chat_id, user_id = _extract_chat_and_user_ids_from_message(event)
        if not chat_id:
            return
        await _send_welcome(event.bot, chat_id, user_id)

    @dp.message_created(Command("stats"))
    async def on_stats(event: MessageCreated):
        _chat_id, user_id = _extract_chat_and_user_ids_from_message(event)
        await event.message.answer(await _render_stats_text(user_id))

    @dp.message_callback(F.callback.payload == "stats")
    async def on_stats_callback(event: MessageCallback):
        chat_id, user_id = event.get_ids()
        if chat_id is None:
            # если исходное сообщение к моменту callback удалили
            chat_id = event.callback.user.user_id

        # 1) ответим на callback всплывашкой
        try:
            await event.answer(notification="Статистика")
        except Exception:
            pass

        # 2) отправим статистику отдельным сообщением
        await event.bot.send_message(chat_id=chat_id, text=await _render_stats_text(user_id))

    @dp.message_created()
    async def on_any_message(event: MessageCreated):
        # Регистрация (после BotStarted)
        _chat_id, user_id = _extract_chat_and_user_ids_from_message(event)
        text = _get_message_text(event)
        state = REG_STATE.get(user_id)

        # Кнопка «Начать» в MAX часто отправляет обычный текст (не /start),
        # поэтому ловим этот кейс отдельно.
        start_text = (text or "").strip().lower()
        if start_text in ("начать", "start", "/start"):
            # Сбрасываем незавершённую регистрацию и запускаем приветствие заново
            REG_STATE.pop(user_id, None)
            REG_NAME.pop(user_id, None)
            chat_id, _ = _extract_chat_and_user_ids_from_message(event)
            if chat_id:
                await _send_welcome(event.bot, chat_id, user_id)
            return

        if not state:
            return

        if state == "waiting_fullname":
            parsed = _parse_fullname(text)
            if not parsed:
                await event.message.answer("❌ Нужно ввести Имя и Фамилию через пробел.\nПример: Иван Иванов")
                return

            REG_NAME[user_id] = parsed
            REG_STATE[user_id] = "waiting_age"
            await event.message.answer("Отлично! Теперь введи возраст (числом).")
            return

        if state == "waiting_age":
            age = _parse_age(text)
            if age is None:
                await event.message.answer("❌ Возраст должен быть числом (например 25). Попробуй ещё раз.")
                return

            first_name, last_name = REG_NAME.get(user_id, ("", ""))
            try:
                await register_user(user_id, first_name, last_name, age)
            except Exception:
                pass

            REG_STATE.pop(user_id, None)
            REG_NAME.pop(user_id, None)

            # После регистрации сразу показываем кнопки как в Telegram-версии
            chat_id, _ = _extract_chat_and_user_ids_from_message(event)
            if chat_id:
                await _send_welcome(event.bot, chat_id, user_id)
            else:
                await event.message.answer("✅ Готово! Ты зарегистрирован(а).")

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
