import hashlib
import hmac
import json
import logging
import os
import asyncio
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import aiohttp


log = logging.getLogger("max_bot")


MAX_API_BASE = "https://platform-api.max.ru"


def is_max_enabled() -> bool:
    return bool((os.getenv("MAX_BOT_TOKEN") or "").strip())


def _sign(uid: int, secret: str) -> str:
    # hex digest is safe for URL and simple to validate
    return hmac.new(secret.encode("utf-8"), str(uid).encode("utf-8"), hashlib.sha256).hexdigest()


def build_max_game_url(uid: int) -> str:
    """Добавляет к GAME_URL параметры для MAX, чтобы WebApp мог сохранить статистику.

    Telegram получает user id через initData, а в MAX (внешний браузер) — нет.
    Поэтому передаем uid + sig в query.
    """
    base = (os.getenv("GAME_URL") or "").strip()
    if not base:
        return ""

    secret = (os.getenv("MAX_WEBHOOK_SECRET") or "").strip()
    if not secret:
        # без секрета тоже работаем, но менее безопасно
        sig = ""
    else:
        sig = _sign(uid, secret)

    u = urlparse(base)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    q.update({"platform": "max", "uid": str(uid)})
    if sig:
        q["sig"] = sig
    new_u = u._replace(query=urlencode(q))
    return urlunparse(new_u)


class MaxApi:
    def __init__(self, token: str, session: aiohttp.ClientSession):
        self.token = token
        self.session = session

    @property
    def headers(self) -> dict:
        return {"Authorization": self.token, "Content-Type": "application/json"}

    async def send_message(self, user_id: int, text: str, keyboard: list | None = None) -> None:
        payload: dict = {"user_id": user_id, "text": text}
        if keyboard:
            payload["attachments"] = [{"type": "inline_keyboard", "keyboard": keyboard}]
        async with self.session.post(f"{MAX_API_BASE}/messages", headers=self.headers, data=json.dumps(payload)) as r:
            if r.status >= 300:
                body = await r.text()
                log.warning("MAX send_message failed: %s %s", r.status, body[:300])

    async def answer_callback(self, callback_id: str, text: str | None = None) -> None:
        payload: dict = {"callback_id": callback_id}
        if text:
            payload["text"] = text
        async with self.session.post(f"{MAX_API_BASE}/answers", headers=self.headers, data=json.dumps(payload)) as r:
            if r.status >= 300:
                body = await r.text()
                log.warning("MAX answer_callback failed: %s %s", r.status, body[:300])


def _keyboard_main(uid: int) -> list:
    url = build_max_game_url(uid)
    return [
        [
            {"text": "Зайти на завод", "type": "link", "url": url},
            {"text": "Статистика", "type": "callback", "callback_data": "stats"},
        ]
    ]


async def handle_max_update(app, update: dict) -> None:
    """Обрабатывает входящее событие MAX.

    Поддерживаем минимум: /start, текстовые команды, callback "stats".
    """
    token = (os.getenv("MAX_BOT_TOKEN") or "").strip()
    if not token:
        return

    api: MaxApi = app["max_api"]

    utype = update.get("type") or update.get("update_type")
    data = update.get("data") or update

    # message_created
    if utype == "message_created":
        msg = data.get("message") or data
        text = (msg.get("text") or "").strip()
        user = msg.get("from") or msg.get("user") or {}
        uid = int(user.get("user_id") or user.get("id") or msg.get("user_id") or 0)
        if not uid:
            return

        if text.startswith("/start") or text.lower() in ("start", "привет", "начать"):
            await api.send_message(uid, "Привет! Нажми «Зайти на завод», чтобы начать.", _keyboard_main(uid))
            return

        if text.lower() in ("статистика", "/stats"):
            # пусть пользователь жмет кнопку; но ответим тоже
            await api.send_message(uid, "Нажми «Статистика».", _keyboard_main(uid))
            return

        return

    # message_callback
    if utype == "message_callback":
        cb = data.get("callback") or data
        callback_id = cb.get("callback_id") or cb.get("id")
        cb_data = cb.get("callback_data") or cb.get("data")
        user = cb.get("from") or cb.get("user") or {}
        uid = int(user.get("user_id") or user.get("id") or cb.get("user_id") or 0)
        if not uid:
            return

        # обработка статистики (по максимуму похоже на TG)
        if cb_data == "stats":
            # Читаем из общей БД (MAX uid хранится как отрицательный)
            from database.db import get_user_profile

            db_uid = -uid
            prof = await get_user_profile(db_uid)
            if not prof:
                await api.answer_callback(callback_id, "Сначала напиши /start и пройди регистрацию")
                return

            # profile tuple: (id, first, last, age, score, aptitude_top)
            _, first_name, last_name, age, score, aptitude_top = prof
            full_name = f"{first_name or ''} {last_name or ''}".strip()
            txt = (
                f"📊 Статистика\n"
                f"👤 {full_name or 'Игрок'} ({age} лет)\n"
                f"⭐ Лучший счёт: {score or 0}\n"
            )
            if aptitude_top:
                txt += f"🧠 Профиль: {aptitude_top}\n"

            await api.answer_callback(callback_id, "Ок")
            await api.send_message(uid, txt, _keyboard_main(uid))
            return

        await api.answer_callback(callback_id, "Ок")
        return


async def start_max_bot() -> None:
    """Фоновая задача. В webhook-схеме MAX не требует отдельного polling.

    Но мы держим задачу живой, чтобы приложение работало одинаково в одном процессе.
    """
    if not is_max_enabled():
        log.info("MAX_BOT_TOKEN is empty: MAX bot is disabled")
        # никогда не завершаться, чтобы gather не падал
        while True:
            await asyncio.sleep(3600)

    while True:
        await asyncio.sleep(3600)
