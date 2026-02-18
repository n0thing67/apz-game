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
from maxapi.types import BotStarted, Command, MessageCreated


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


def _extract_chat_and_user_ids_from_started(event: BotStarted) -> Tuple[int, int]:
    chat_id = getattr(event, "chat_id", None) or getattr(event, "chatId", None) or 0
    user_id = getattr(event, "user_id", None) or getattr(event, "userId", None) or 0

    # В личном чате chat_id часто = user_id, но не всегда. Подстрахуемся.
    if not user_id and chat_id:
        user_id = chat_id

    return int(chat_id), int(user_id)


async def _send_welcome(bot: Bot, chat_id: int, user_id: int) -> None:
    user = await get_user(user_id)
    if user:
        _, first_name, *_ = user
        text = f"С возвращением, {first_name}!\n\nКоманды: /start /stats"
        if GAME_URL:
            text += f"\n\n🎮 Игра: {GAME_URL}"
        await bot.send_message(chat_id=chat_id, text=text)
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
        chat_id, user_id = _extract_chat_and_user_ids_from_message(event)

        user = await get_user(user_id)
        if not user:
            await event.message.answer("Сначала нажми «Начать» (или отправь /start) и пройди регистрацию.")
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

    @dp.message_created()
    async def on_any_message(event: MessageCreated):
        # Регистрация (после BotStarted)
        _chat_id, user_id = _extract_chat_and_user_ids_from_message(event)
        text = getattr(event.message, "text", None) or ""
        state = REG_STATE.get(user_id)

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

            msg = "✅ Готово! Ты зарегистрирован(а).\n\nКоманды: /start /stats"
            if GAME_URL:
                msg += f"\n\n🎮 Игра: {GAME_URL}"
            await event.message.answer(msg)

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
