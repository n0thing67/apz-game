import asyncio
import os
import logging
import json
import re

from dotenv import load_dotenv

from database.db import create_table, close_db, register_user, update_score, update_aptitude_top, get_user

from web_server import run_web_server

# MAX SDK
from maxapi import Bot, Dispatcher
from maxapi.types import MessageCreated, MessageCallback, Command
from maxapi.utils.inline_keyboard import InlineKeyboardBuilder
from maxapi.types.attachments.buttons import OpenAppButton, CallbackButton, LinkButton

load_dotenv()

# ====== ENV ======
# Токен MAX бота (рекомендуется MAX_BOT_TOKEN). Для совместимости можно использовать BOT_TOKEN.
MAX_TOKEN = os.getenv("MAX_BOT_TOKEN") or os.getenv("BOT_TOKEN")

# Админы (как в Telegram-версии)
raw_admins = os.getenv("ADMIN_IDS", "")
ADMIN_IDS = {int(x.strip()) for x in raw_admins.split(",") if x.strip().isdigit()}

raw_admin_channel = os.getenv("ADMIN_CHANNEL_ID", os.getenv("ADMIN_CHAT_ID", "")).strip()
ADMIN_CHANNEL_ID = int(raw_admin_channel) if raw_admin_channel.lstrip('-').isdigit() else None

# URL'ы (та же логика, что и в Telegram)
GAME_URL = os.getenv("GAME_URL", "https://n0thing67.github.io/APZ-games/").rstrip("/")
ADMIN_URL = os.getenv("ADMIN_URL", os.getenv("WEBAPP_URL", "")).rstrip("/")


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


def _is_technical_aptitude(value: str | None) -> bool:
    if not value:
        return False
    v = str(value).strip()
    if not v:
        return False
    v_low = v.lower()
    return (
        v == "TECH"
        or v_low in {
            "техническое направление",
            "техническое мышление",
            "technical",
            "tech",
        }
    )


async def _notify_admins_about_technical(bot: Bot, user_id: int, reg_name: str | None = None) -> None:
    """Уведомляет админов/админ-чат о том, что итог профтеста — техническое направление."""
    name_part = (reg_name or "").strip() or "(имя не указано)"
    text = (
        "🧠 Профориентация: техническое направление\n"
        f"👤 {name_part}\n"
        f"🆔 {user_id}"
    )

    # 1) если задан канал/чат — шлём туда
    if ADMIN_CHANNEL_ID is not None:
        try:
            await bot.send_message(chat_id=ADMIN_CHANNEL_ID, text=text)
            return
        except Exception:
            pass

    # 2) fallback: ЛС всем админам
    for admin_id in ADMIN_IDS:
        try:
            await bot.send_message(chat_id=admin_id, text=text)
        except Exception:
            continue


def _api_query_part() -> str:
    """Параметр ?api=... для GitHub Pages игры (как в Telegram версии)."""
    if not ADMIN_URL:
        return ""
    try:
        from urllib.parse import quote
        return f"?api={quote(ADMIN_URL, safe='')}"
    except Exception:
        return f"?api={ADMIN_URL}"


def game_keyboard_payload():
    """Кнопка открытия игры в MAX (OpenAppButton)."""
    builder = InlineKeyboardBuilder()
    # OpenAppButton — открытие приложения/ссылки внутри MAX
    builder.row(
        OpenAppButton(
            text="🏭 Зайти на завод (Играть)",
            url=f"{GAME_URL}/" + _api_query_part(),
        )
    )
    return builder.as_markup()


def stats_keyboard_payload():
    builder = InlineKeyboardBuilder()
    builder.row(CallbackButton(text="📊 Статистика", payload="stats"))
    return builder.as_markup()


def admin_keyboard_payload():
    builder = InlineKeyboardBuilder()
    if ADMIN_URL:
        builder.row(OpenAppButton(text="Админ-панель", url=f"{ADMIN_URL}/admin.html"))
    else:
        builder.row(LinkButton(text="Админ-панель (URL не задан)", url="https://example.com"))
    return builder.as_markup()


# ====== Простая FSM регистрация (не трогаем существующую Telegram-логику) ======
# user_id -> state data
REG_STATE: dict[int, dict] = {}

_ru_token = re.compile(r"^[А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)*$")


def _looks_like_json_webapp_payload(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if not (t.startswith("{") and t.endswith("}")):
        return False
    # небольшой хак: чтобы не пытаться парсить всё подряд
    return any(k in t for k in ("score", "aptitude_top", "aptitudeTop"))


async def _handle_web_payload(bot: Bot, chat_id: int, user_id: int, payload: dict):
    """Обработка результатов игры (score + aptitude_top) из сообщения."""
    # Если админ удалил пользователя из БД — блокируем запись, просим /start
    try:
        user = await get_user(user_id)
    except Exception:
        user = None

    if not user:
        await bot.send_message(
            chat_id=chat_id,
            text="⚠️ Ваш профиль не найден (возможно, он был удалён администратором).\n"
                 "Нажмите /start, чтобы зарегистрироваться заново."
        )
        return

    score_raw = payload.get("score", None)
    score = 0
    if score_raw is not None:
        try:
            score = int(score_raw or 0)
        except Exception:
            score = 0

    aptitude_top = payload.get("aptitude_top") or payload.get("aptitudeTop") or None
    if isinstance(aptitude_top, str):
        aptitude_top = aptitude_top.strip() or None

    if aptitude_top is not None:
        await update_aptitude_top(user_id, aptitude_top)
        # уведомление админов
        if _is_technical_aptitude(aptitude_top):
            _tid, fname, lname, *_ = user
            reg_name = f"{fname} {lname}".strip()
            await _notify_admins_about_technical(bot, user_id, reg_name=reg_name)

    if score_raw is not None:
        await update_score(user_id, score)

    APT_LABEL = {
        "TECH": "🔧 Техническое мышление",
        "LOGIC": "🧩 Логическое мышление",
        "CREATIVE": "🎨 Творческое мышление",
        "HUMAN": "📖 Гуманитарное мышление",
        "SOCIAL": "🤝 Командное мышление",
    }

    if score_raw is not None and aptitude_top is not None:
        text = (
            f"🚀 Результат получен! Твой счёт: {score}⭐️.\n"
            f"🧠 Профиль сохранён: {APT_LABEL.get(aptitude_top, aptitude_top)}.\n"
            f"Нажми кнопку «Статистика», чтобы посмотреть результаты."
        )
        await bot.send_message(chat_id=chat_id, text=text, attachments=[stats_keyboard_payload()])
    elif score_raw is not None:
        await bot.send_message(
            chat_id=chat_id,
            text=f"🚀 Результат получен! Твой счёт: {score}⭐️.\n"
                 f"Нажми кнопку «Статистика», чтобы посмотреть результаты.",
            attachments=[stats_keyboard_payload()],
        )
    elif aptitude_top is not None:
        await bot.send_message(
            chat_id=chat_id,
            text=f"🧠 Результат теста сохранён: {APT_LABEL.get(aptitude_top, aptitude_top)}.\n"
                 f"Нажми кнопку «Статистика», чтобы посмотреть результаты.",
            attachments=[stats_keyboard_payload()],
        )
    else:
        await bot.send_message(chat_id=chat_id, text="✅ Данные получены.")


async def _send_stats(bot: Bot, chat_id: int, user_id: int) -> None:
    """Отправляет пользователю его статистику (аналог Telegram версии)."""
    # Берём расширенный профиль (если есть)
    profile = None
    try:
        from database.db import get_user_profile
        profile = await get_user_profile(user_id)
    except Exception:
        profile = None

    user = await get_user(user_id)
    if not user:
        await bot.send_message(chat_id=chat_id, text="📊 Статистика пока недоступна.")
        return

    _tid, fname, lname, _age, score = user

    rank_info = None
    try:
        from database.db import get_user_rank
        rank_info = await get_user_rank(user_id)
    except Exception:
        rank_info = None

    aptitude_top = None
    if profile and len(profile) >= 6:
        aptitude_top = profile[5]

    APT_LABEL = {
        "TECH": ("🔧", "Техническое мышление"),
        "LOGIC": ("🧩", "Логическое мышление"),
        "CREATIVE": ("🎨", "Творческое мышление"),
        "HUMAN": ("📖", "Гуманитарное мышление"),
        "SOCIAL": ("🤝", "Командное мышление"),
    }

    lines = [
        "📊 Твоя статистика:",
        f"👤 {fname} {lname}",
        f"⭐️ Очки: {score}",
    ]
    if rank_info:
        rank, total = rank_info
        if total and total > 0:
            lines.append(f"🏆 Рейтинг: {rank} из {total}")
    if aptitude_top:
        emoji, label = APT_LABEL.get(aptitude_top, ("🧠", str(aptitude_top)))
        lines.append(f"{emoji} {label}")

    await bot.send_message(chat_id=chat_id, text="\n".join(lines))


async def main():
    logging.basicConfig(level=logging.INFO)

    if not MAX_TOKEN:
        raise RuntimeError("Не найден токен MAX бота. Укажите MAX_BOT_TOKEN (или BOT_TOKEN) в .env")

    await create_table()

    bot = Bot(token=MAX_TOKEN)
    dp = Dispatcher()

    # ====== /start ======
    @dp.message_created(Command("start"))
    async def cmd_start(event: MessageCreated):
        chat_id, user_id = event.get_ids()
        if chat_id is None or user_id is None:
            return

        # сбрасываем локальный стейт регистрации
        REG_STATE.pop(user_id, None)

        user = await get_user(user_id)
        if user:
            _, first_name, *_ = user
            await bot.send_message(
                chat_id=chat_id,
                text=f"С возвращением, {first_name}! Нажми кнопку ниже, чтобы начать испытание.",
                attachments=[game_keyboard_payload()],
            )
            return

        await bot.send_message(
            chat_id=chat_id,
            text=(
                "Добро пожаловать на АПЗ! Для начала работы, пожалуйста, представьтесь.\n"
                "✍️ Введите Имя и Фамилию одним сообщением (через пробел).\n"
                "Пример: Иван Иванов"
            ),
        )
        REG_STATE[user_id] = {"state": "waiting_for_fullname"}

    # ====== /admin ======
    @dp.message_created(Command("admin"))
    async def cmd_admin(event: MessageCreated):
        chat_id, user_id = event.get_ids()
        if chat_id is None or user_id is None:
            return
        if not is_admin(user_id):
            await bot.send_message(chat_id=chat_id, text="Нет доступа")
            return
        await bot.send_message(chat_id=chat_id, text="⚙️ Панель администратора", attachments=[admin_keyboard_payload()])

    # ====== Callback: stats ======
    @dp.message_callback()
    async def on_callback(event: MessageCallback):
        chat_id, user_id = event.get_ids()
        payload = (event.callback.payload or "").strip()

        # Подтверждаем callback (аналог callback.answer() в TG)
        try:
            await event.answer(notification=None)
        except Exception:
            pass

        if chat_id is None:
            # если исходного сообщения нет, всё равно можем написать пользователю в ЛС по его id
            chat_id = user_id

        if payload == "stats":
            await _send_stats(bot, chat_id, user_id)

    # ====== Любые сообщения ======
    @dp.message_created()
    async def on_message(event: MessageCreated):
        chat_id, user_id = event.get_ids()
        if chat_id is None or user_id is None:
            return

        text = (event.message.body.text or "").strip()

        # 1) Если ожидаем данные регистрации — обрабатываем
        st = REG_STATE.get(user_id, None)
        if st:
            if st.get("state") == "waiting_for_fullname":
                parts = [p for p in text.split() if p]
                if len(parts) < 2:
                    await bot.send_message(
                        chat_id=chat_id,
                        text="❌ Нужно ввести Имя и Фамилию через пробел.\nПример: Иван Иванов",
                    )
                    return

                first_name = parts[0]
                last_parts = parts[1:]

                # Валидация: только русские буквы (как в TG версии)
                if not _ru_token.fullmatch(first_name) or any(not _ru_token.fullmatch(p) for p in last_parts):
                    await bot.send_message(
                        chat_id=chat_id,
                        text=(
                            "❌ Имя и фамилия должны быть написаны только русскими буквами.\n"
                            "Можно использовать дефис.\n"
                            "Пример: Иван Иванов / Анна-Мария Петрова"
                        ),
                    )
                    return

                st["first_name"] = first_name
                st["last_name"] = " ".join(last_parts)
                st["state"] = "waiting_for_age"
                await bot.send_message(chat_id=chat_id, text="Сколько вам лет?")
                return

            if st.get("state") == "waiting_for_age":
                try:
                    age = int(text)
                except Exception:
                    await bot.send_message(chat_id=chat_id, text="Возраст должен быть числом. Попробуйте ещё раз.")
                    return

                if age < 3 or age > 100:
                    await bot.send_message(chat_id=chat_id, text="Возраст должен быть от 3 до 100. Попробуйте ещё раз.")
                    return

                first_name = st.get("first_name", "")
                last_name = st.get("last_name", "")

                await register_user(user_id, first_name, last_name, age)
                REG_STATE.pop(user_id, None)

                await bot.send_message(
                    chat_id=chat_id,
                    text=f"Регистрация пройдена, {first_name}! Нажми кнопку ниже, чтобы начать испытание.",
                    attachments=[game_keyboard_payload()],
                )
                return

        # 2) Пытаемся распознать payload от игры, если он пришёл текстом (JSON)
        if _looks_like_json_webapp_payload(text):
            try:
                payload = json.loads(text)
            except Exception:
                payload = None
            if isinstance(payload, dict):
                await _handle_web_payload(bot, chat_id, user_id, payload)
                return

        # 3) Ненавязчивый хелп
        if text.lower() in {"старт", "начать"}:
            await bot.send_message(chat_id=chat_id, text="Отправь команду /start")
            return

    # Поднимаем мини-веб-приложение (игра + админ-панель) вместе с polling.
    web_task = asyncio.create_task(run_web_server())

    print("MAX-бот запущен...")
    try:
        # На всякий случай убираем webhook-подписки (см. доки maxapi)
        try:
            await bot.delete_webhook()
        except Exception:
            pass
        await dp.start_polling(bot)
    finally:
        web_task.cancel()
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("MAX-бот выключен")
