import os
import re
import json
import logging
from urllib.parse import quote

import aiohttp

from database.db import (
    register_user,
    get_user,
    get_user_profile,
)


MAX_API_BASE = os.getenv("MAX_API_BASE", "https://platform-api.max.ru").rstrip("/")


def _max_to_db_id(max_user_id: int) -> int:
    """MAX user_id -> внутренний id в общей БД.

    БД исторически использует telegram_id (INTEGER PRIMARY KEY). Чтобы не менять схему
    и исключить коллизии с Telegram ID, MAX пользователей сохраняем как отрицательные числа.
    """
    return -int(max_user_id)


def _get_admin_ids() -> set[int]:
    raw = os.getenv("ADMIN_IDS", "")
    return {int(x.strip()) for x in raw.split(",") if x.strip().lstrip("-").isdigit()}


def _is_admin(db_user_id: int) -> bool:
    return int(db_user_id) in _get_admin_ids()


def _game_url() -> str:
    game_url = os.getenv("GAME_URL", "https://n0thing67.github.io/APZ-games/").rstrip("/")
    admin_url = os.getenv("ADMIN_URL", os.getenv("WEBAPP_URL", "")).rstrip("/")
    api_part = f"?api={quote(admin_url, safe='')}" if admin_url else ""
    return f"{game_url}/" + api_part


def _admin_url() -> str:
    return (os.getenv("ADMIN_URL", os.getenv("WEBAPP_URL", "")) or "").rstrip("/")


def _inline_keyboard(buttons: list[list[dict]]) -> list[dict]:
    return [{"type": "inline_keyboard", "payload": {"buttons": buttons}}]


async def _max_api_post(
    session: aiohttp.ClientSession,
    token: str,
    path: str,
    *,
    params: dict | None = None,
    json_body: dict | None = None,
):
    url = f"{MAX_API_BASE}{path}"
    headers = {"Authorization": token, "Content-Type": "application/json"}
    async with session.post(url, headers=headers, params=params, json=json_body) as resp:
        text = await resp.text()
        if resp.status >= 400:
            raise RuntimeError(f"MAX API {path} failed: {resp.status} {text}")
        try:
            return json.loads(text) if text else {}
        except Exception:
            return {}


async def send_message(
    session: aiohttp.ClientSession,
    token: str,
    *,
    user_id: int,
    text: str,
    attachments: list[dict] | None = None,
    fmt: str | None = None,
):
    body: dict = {"text": text}
    if attachments is not None:
        body["attachments"] = attachments
    if fmt:
        body["format"] = fmt
    return await _max_api_post(session, token, "/messages", params={"user_id": int(user_id)}, json_body=body)


async def answer_callback(
    session: aiohttp.ClientSession,
    token: str,
    *,
    callback_id: str,
    message: dict | None = None,
    notification: str | None = None,
):
    body: dict = {}
    if message is not None:
        body["message"] = message
    if notification is not None:
        body["notification"] = notification
    return await _max_api_post(session, token, "/answers", params={"callback_id": callback_id}, json_body=body)


def _apt_label(value: str | None) -> str | None:
    if not value:
        return None
    m = {
        "PEOPLE": "🤝 Работа с людьми",
        "RESEARCH": "🔬 Исследовательская деятельность",
        "PRODUCTION": "🏭 Работа на производстве",
        "AESTHETIC": "🎨 Эстетические виды деятельности",
        "EXTREME": "🧗 Экстремальные виды деятельности",
        "PLAN_ECON": "📊 Планово‑экономические виды деятельности",
    }
    return m.get(value, str(value))


async def _send_stats_max(app, *, max_user_id: int):
    token = app.get("max_token") or ""
    session: aiohttp.ClientSession = app["max_session"]

    db_id = _max_to_db_id(max_user_id)
    user = await get_user(db_id)
    if not user:
        await send_message(session, token, user_id=max_user_id, text="📊 Статистика пока недоступна.")
        return

    profile = None
    try:
        profile = await get_user_profile(db_id)
    except Exception:
        profile = None

    _tid, fname, lname, _age, score = user
    aptitude_top = profile[5] if profile and len(profile) >= 6 else None

    lines = [
        "📊 Твоя статистика:",
        f"👤 {fname} {lname}",
        f"⭐️ Лучший счёт: {score}",
    ]
    a = _apt_label(aptitude_top)
    if a:
        lines.append(a)

    await send_message(session, token, user_id=max_user_id, text="\n".join(lines))


async def handle_update(app, update: dict) -> None:
    """Единая обработка MAX Update (webhook)."""
    token = (app.get("max_token") or "").strip()
    if not token:
        return

    session: aiohttp.ClientSession = app["max_session"]
    state: dict = app["max_state"]

    utype = update.get("update_type")

    # bot_started
    if utype == "bot_started":
        user = update.get("user") or {}
        max_user_id = user.get("user_id")
        if max_user_id is None:
            return

        db_id = _max_to_db_id(int(max_user_id))
        existing = await get_user(db_id)
        if existing:
            fname = existing[1]
            kb = _inline_keyboard([
                [{"type": "link", "text": "🏭 Зайти на завод (Играть)", "url": _game_url()}]
            ])
            await send_message(session, token, user_id=int(max_user_id), text=f"С возвращением, {fname}! Нажми кнопку ниже, чтобы начать испытание.", attachments=kb)
            return

        await send_message(
            session,
            token,
            user_id=int(max_user_id),
            text=(
                "Добро пожаловать на АПЗ! Для начала работы, пожалуйста, представьтесь.\n"
                "✍️ Введите Имя и Фамилию одним сообщением (через пробел).\n"
                "Пример: Иван Иванов"
            ),
        )
        state[str(max_user_id)] = {"step": "waiting_for_fullname"}
        return

    # message_callback
    if utype == "message_callback":
        callback = update.get("callback") or {}
        callback_id = callback.get("callback_id") or update.get("callback_id")
        payload = callback.get("payload") or update.get("payload")
        user = callback.get("user") or update.get("user") or {}
        max_user_id = user.get("user_id")
        if not callback_id or max_user_id is None:
            return

        if str(payload) == "stats":
            try:
                await answer_callback(session, token, callback_id=str(callback_id), message={"text": "Открываю статистику…"})
            except Exception:
                pass
            await _send_stats_max(app, max_user_id=int(max_user_id))
            return

        try:
            await answer_callback(session, token, callback_id=str(callback_id), notification="✅")
        except Exception:
            return
        return

    # message_created
    if utype == "message_created":
        msg = update.get("message") or {}
        sender = msg.get("sender") or {}
        max_user_id = sender.get("user_id")
        if max_user_id is None:
            return

        body = msg.get("body") or {}
        text = (body.get("text") or "").strip()

        if text == "/start":
            await handle_update(app, {"update_type": "bot_started", "user": {"user_id": int(max_user_id)}})
            return

        if text == "/admin":
            if not _is_admin(_max_to_db_id(int(max_user_id))):
                await send_message(session, token, user_id=int(max_user_id), text="Нет доступа")
                return
            au = _admin_url()
            if not au:
                await send_message(session, token, user_id=int(max_user_id), text="Админ-панель не настроена (ADMIN_URL/WEBAPP_URL).")
                return
            kb = _inline_keyboard([
                [{"type": "link", "text": "Админ-панель", "url": f"{au}/admin.html"}]
            ])
            await send_message(session, token, user_id=int(max_user_id), text="⚙️ Панель администратора", attachments=kb)
            return

        # FSM регистрация
        st = state.get(str(max_user_id))
        if st and st.get("step") == "waiting_for_fullname":
            parts = [p for p in text.split() if p]
            if len(parts) < 2:
                await send_message(session, token, user_id=int(max_user_id), text="❌ Нужно ввести Имя и Фамилию через пробел.\nПример: Иван Иванов")
                return

            ru_token = re.compile(r"^[А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)*$")
            if not ru_token.fullmatch(parts[0]) or any(not ru_token.fullmatch(p) for p in parts[1:]):
                await send_message(session, token, user_id=int(max_user_id), text=(
                    "❌ Имя и фамилия должны быть написаны только русскими буквами.\n"
                    "Можно использовать дефис.\n"
                    "Пример: Иван Иванов / Анна-Мария Петрова"
                ))
                return

            st["first_name"] = parts[0]
            st["last_name"] = " ".join(parts[1:])
            st["step"] = "waiting_for_age"
            await send_message(session, token, user_id=int(max_user_id), text="Сколько вам лет?")
            return

        if st and st.get("step") == "waiting_for_age":
            try:
                age = int(text)
            except Exception:
                await send_message(session, token, user_id=int(max_user_id), text="Возраст должен быть числом. Попробуйте ещё раз.")
                return

            if age < 3 or age > 100:
                await send_message(session, token, user_id=int(max_user_id), text="Возраст должен быть от 3 до 100. Попробуйте ещё раз.")
                return

            db_id = _max_to_db_id(int(max_user_id))
            await register_user(db_id, st.get("first_name"), st.get("last_name"), age)
            state.pop(str(max_user_id), None)

            kb = _inline_keyboard([
                [{"type": "link", "text": "🏭 Зайти на завод (Играть)", "url": _game_url()}]
            ])
            await send_message(session, token, user_id=int(max_user_id), text=f"Регистрация пройдена, {st.get('first_name')}! Нажми кнопку ниже, чтобы начать испытание.", attachments=kb)
            return

        # зарегистрированным даём кнопку статистики и ссылку на игру
        if text.lower() in {"статистика", "/stats"}:
            kb = _inline_keyboard([
                [{"type": "callback", "text": "📊 Статистика", "payload": "stats"}]
            ])
            await send_message(session, token, user_id=int(max_user_id), text="Нажми кнопку ниже:", attachments=kb)
            return

        kb = _inline_keyboard([
            [{"type": "link", "text": "🏭 Зайти на завод (Играть)", "url": _game_url()}],
            [{"type": "callback", "text": "📊 Статистика", "payload": "stats"}],
        ])
        await send_message(session, token, user_id=int(max_user_id), text="Выбери действие:", attachments=kb)
        return

    return
