import asyncio
import logging
import os
import re

from dotenv import load_dotenv

from database.db import create_table, close_db, get_user, register_user, get_top_users_stats
from web_server import run_web_server

# MAX bot framework
from maxapi import Bot, Dispatcher
from maxapi.types import BotStarted, Command, MessageCreated


load_dotenv()

TOKEN = os.getenv("MAX_BOT_TOKEN") or os.getenv("BOT_TOKEN")
GAME_URL = (os.getenv("GAME_URL") or os.getenv("WEBAPP_URL") or "").strip()  # как минимум ссылка
GAME_URL = GAME_URL.rstrip("/")


# --- простое состояние регистрации для MAX (не трогаем Telegram FSM) ---
# user_id -> "waiting_fullname" | "waiting_age"
REG_STATE: dict[int, str] = {}


def _parse_fullname(text: str) -> tuple[str, str] | None:
    text = (text or "").strip()
    parts = [p for p in text.split() if p]
    if len(parts) < 2:
        return None
    first_name = parts[0]
    last_name = " ".join(parts[1:])

    # Валидация как в Telegram-хендлере: русские буквы/дефис.
    # (мягкая — чтобы не ломать UX, но отсекает явный мусор)
    ru_re = re.compile(r"^[А-Яа-яЁё\-]+$")
    if not ru_re.match(first_name):
        return None
    for p in last_name.split():
        if not ru_re.match(p):
            return None
    return first_name, last_name


def _parse_age(text: str) -> int | None:
    text = (text or "").strip()
    m = re.search(r"\d+", text)
    if not m:
        return None
    age = int(m.group())
    if age < 6 or age > 120:
        return None
    return age


async def _send_welcome(event: MessageCreated | BotStarted, user_id: int, chat_id: int):
    user = await get_user(user_id)
    if user:
        _, first_name, *_ = user
        txt = f"С возвращением, {first_name}! Нажми /start чтобы начать испытание."
        # В MAX нет web_app-кнопки как в Telegram, поэтому даём ссылку на игру
        if GAME_URL:
            txt += f"\n\n🎮 Игра: {GAME_URL}"
        await event.bot.send_message(chat_id=chat_id, text=txt)
        return

    REG_STATE[user_id] = "waiting_fullname"
    await event.bot.send_message(
        chat_id=chat_id,
        text=(
            "Добро пожаловать на АПЗ!\n"
            "✍️ Введите *Имя и Фамилию* одним сообщением (через пробел).\n"
            "Пример: Иван Иванов"
        ),
        format="markdown",
    )


async def main():
    if not TOKEN:
        raise RuntimeError("Не найден токен: установи MAX_BOT_TOKEN (или BOT_TOKEN) в .env")

    logging.basicConfig(level=logging.INFO)
    await create_table()

    bot = Bot(TOKEN)
    dp = Dispatcher()

    # Важно: если ранее был настроен webhook, polling не получит события
    # (указано в README max-botapi-python)
    try:
        await bot.delete_webhook()
    except Exception:
        # если webhook не был установлен/нет прав — просто продолжаем
        pass

    @dp.bot_started()
    async def on_bot_started(event: BotStarted):
        # В MAX кнопка «Начать» генерирует BotStarted, а не /start
        chat_id = getattr(event, "chat_id", None)
        user_id = getattr(event, "user_id", None)

        # На случай если поле user_id отсутствует (зависит от контекста/чата)
        if user_id is None:
            # В личном чате chat_id обычно совпадает с user_id
            user_id = int(chat_id)

        await _send_welcome(event, int(user_id), int(chat_id))

    @dp.message_created(Command("start"))
    async def on_start(event: MessageCreated):
        chat_id = int(getattr(event.message, "chat_id", getattr(event, "chat_id", 0)))
        sender = getattr(event.message, "sender", None)
        user_id = getattr(sender, "user_id", None) or getattr(sender, "id", None)

        if user_id is None:
            # fallback
            user_id = chat_id

        await _send_welcome(event, int(user_id), int(chat_id))

    @dp.message_created(Command("stats"))
    async def on_stats(event: MessageCreated):
        chat_id = int(getattr(event.message, "chat_id", getattr(event, "chat_id", 0)))
        sender = getattr(event.message, "sender", None)
        user_id = getattr(sender, "user_id", None) or getattr(sender, "id", None) or chat_id

        user = await get_user(int(user_id))
        if not user:
            await event.message.answer("Сначала отправь /start и пройди регистрацию.")
            return

        try:
            rows = await get_top_users_stats(limit=20)
        except Exception:
            rows = []

        # Формируем текст, близкий к Telegram-версии
        lines = ["🏆 Топ игроков:"]
        if not rows:
            lines.append("Пока нет данных.")
        else:
            for i, r in enumerate(rows, start=1):
                # ожидаем: (user_id, first_name, last_name, age, score, ...) - проектные поля
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
        # Обработка регистрации в MAX (без FSM aiogram)
        text = getattr(event.message, "text", None) or ""
        chat_id = int(getattr(event.message, "chat_id", 0))
        sender = getattr(event.message, "sender", None)
        user_id = getattr(sender, "user_id", None) or getattr(sender, "id", None) or chat_id
        user_id = int(user_id)

        state = REG_STATE.get(user_id)
        if not state:
            return  # не перехватываем обычные сообщения

        if state == "waiting_fullname":
            parsed = _parse_fullname(text)
            if not parsed:
                await event.message.answer(
                    "❌ Нужно ввести *Имя и Фамилию* через пробел (только русские буквы).\n"
                    "Пример: Иван Иванов",
                    format="markdown",
                )
                return

            first_name, last_name = parsed
            # запрашиваем возраст
            REG_STATE[user_id] = "waiting_age"
            # временно сохраним имя/фам в state через кортеж в dict
            REG_STATE[(user_id << 1) + 1] = (first_name, last_name)  # нестандартный ключ, чтобы не трогать БД
            await event.message.answer("Отлично! Теперь введи возраст (числом).")
            return

        if state == "waiting_age":
            age = _parse_age(text)
            if age is None:
                await event.message.answer("❌ Возраст должен быть числом (например 25). Попробуй ещё раз.")
                return

            name_key = (user_id << 1) + 1
            first_name, last_name = REG_STATE.get(name_key, ("", ""))
            try:
                await register_user(user_id, first_name, last_name, age)
            except Exception:
                # если пользователь уже есть — просто продолжаем
                pass

            # очистка
            REG_STATE.pop(user_id, None)
            REG_STATE.pop(name_key, None)

            msg = "✅ Готово! Ты зарегистрирован(а)."
            if GAME_URL:
                msg += f"\n\n🎮 Игра: {GAME_URL}\n\nКоманды: /start /stats"
            await event.message.answer(msg)

    # Поднимаем мини-веб-приложение (игра + админ-панель) как и в Telegram-боте
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
