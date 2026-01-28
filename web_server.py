import asyncio
import hashlib
import hmac
import json
import logging
import os
from io import BytesIO
from urllib.parse import parse_qsl

from aiohttp import web

from aiogram import Bot
from aiogram.types import BufferedInputFile
from PIL import Image, ImageDraw, ImageFont

from database.db import (
    get_levels,
    set_level_active,
    get_top_users,
    get_all_users,
    get_user,
    delete_user,
    reset_all_scores,
)


WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")

# Шаблоны грамот/дипломов (вариант A: PNG + наложение текста)
CERT_TEMPLATES_DIR = os.path.join(WEBAPP_DIR, "assets", "cert_templates")


def _font_path() -> str:
    # В контейнере обычно есть DejaVu с кириллицей.
    return "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _font_path_bold() -> str:
    return "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _fit_font(draw: ImageDraw.ImageDraw, text: str, font_path: str, max_width: int, start_size: int, min_size: int = 18):
    size = start_size
    while size >= min_size:
        font = ImageFont.truetype(font_path, size)
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        if w <= max_width:
            return font
        size -= 2
    return ImageFont.truetype(font_path, min_size)


def _render_award_png(template_filename: str, full_name: str, event_name: str, event_date: str) -> bytes:
    template_path = os.path.join(CERT_TEMPLATES_DIR, template_filename)
    img = Image.open(template_path).convert("RGBA")
    w, h = img.size
    draw = ImageDraw.Draw(img)

    # Блоки текста (относительно размера шаблона)
    name_y = int(h * 0.48)
    event_y = int(h * 0.58)
    date_y = int(h * 0.63)
    max_text_width = int(w * 0.78)

    # Имя участника — самое крупное
    name_font = _fit_font(draw, full_name, _font_path_bold(), max_text_width, start_size=int(h * 0.05), min_size=28)
    name_bbox = draw.textbbox((0, 0), full_name, font=name_font)
    name_w = name_bbox[2] - name_bbox[0]
    draw.text(((w - name_w) / 2, name_y), full_name, font=name_font, fill=(20, 30, 45, 255))

    # Мероприятие
    event_text = f"Мероприятие: {event_name}".strip()
    event_font = _fit_font(draw, event_text, _font_path(), max_text_width, start_size=int(h * 0.03), min_size=18)
    event_bbox = draw.textbbox((0, 0), event_text, font=event_font)
    event_w = event_bbox[2] - event_bbox[0]
    draw.text(((w - event_w) / 2, event_y), event_text, font=event_font, fill=(25, 45, 70, 255))

    # Дата
    date_text = f"Дата: {event_date}".strip()
    date_font = _fit_font(draw, date_text, _font_path(), max_text_width, start_size=int(h * 0.03), min_size=18)
    date_bbox = draw.textbbox((0, 0), date_text, font=date_font)
    date_w = date_bbox[2] - date_bbox[0]
    draw.text(((w - date_w) / 2, date_y), date_text, font=date_font, fill=(25, 45, 70, 255))

    out = BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


def _verify_telegram_webapp_init_data(init_data: str, bot_token: str) -> dict | None:
    """Проверка initData из Telegram WebApp (HMAC SHA-256).

    Возвращает распарсенный dict параметров initData при успехе, иначе None.
    """
    if not init_data or not bot_token:
        return None

    try:
        params = dict(parse_qsl(init_data, strict_parsing=True))
    except Exception:
        return None

    their_hash = params.pop("hash", None)
    if not their_hash:
        return None

    # data_check_string: key=value\n... отсортировано по ключу
    data_check_string = "\n".join(f"{k}={params[k]}" for k in sorted(params.keys()))

    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calc_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calc_hash, their_hash):
        return None

    return params


def _extract_user_id(verified_params: dict) -> int | None:
    # user={"id":..., ...}
    raw_user = verified_params.get("user")
    if not raw_user:
        return None
    try:
        u = json.loads(raw_user)
        uid = u.get("id")
        return int(uid) if uid is not None else None
    except Exception:
        return None


def _get_admin_ids() -> set[int]:
    raw_admins = os.getenv("ADMIN_IDS", "")
    return {int(x.strip()) for x in raw_admins.split(",") if x.strip().isdigit()}


@web.middleware
async def cors_middleware(request: web.Request, handler):
    # Чтобы WebApp нормально делал fetch() из WebView.
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        resp = await handler(request)

    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


async def handle_levels(request: web.Request) -> web.Response:
    levels = await get_levels()
    return web.json_response({"ok": True, "levels": levels})


async def _require_admin(request: web.Request) -> int:
    """Проверка admin по initData (передаётся в заголовке X-Telegram-InitData или ?initData=...)."""
    bot_token = os.getenv("BOT_TOKEN", "")
    init_data = request.headers.get("X-Telegram-InitData") or request.query.get("initData") or ""

    verified = _verify_telegram_webapp_init_data(init_data, bot_token)
    if not verified:
        raise web.HTTPUnauthorized(text="Bad initData")

    user_id = _extract_user_id(verified)
    if not user_id:
        raise web.HTTPUnauthorized(text="No user")

    if user_id not in _get_admin_ids():
        raise web.HTTPForbidden(text="Not admin")
    return user_id


async def admin_get_stats(request: web.Request) -> web.Response:
    await _require_admin(request)
    top = await get_top_users()
    users = await get_all_users(limit=500)
    return web.json_response(
        {
            "ok": True,
            "top": [
                {"first_name": f, "last_name": l, "score": s}
                for (f, l, s) in top
            ],
            "users": [
                {
                    "telegram_id": tid,
                    "first_name": fn,
                    "last_name": ln,
                    "age": age,
                    "score": score,
                }
                for (tid, fn, ln, age, score) in users
            ],
        }
    )


async def admin_reset_scores(request: web.Request) -> web.Response:
    await _require_admin(request)
    await reset_all_scores()
    return web.json_response({"ok": True})


async def admin_delete_user(request: web.Request) -> web.Response:
    await _require_admin(request)
    payload = await request.json()
    tg_id = int(payload.get("telegram_id"))
    await delete_user(tg_id)
    return web.json_response({"ok": True})


async def admin_set_level(request: web.Request) -> web.Response:
    await _require_admin(request)
    payload = await request.json()
    level_key = str(payload.get("level_key"))
    is_active = bool(payload.get("is_active"))
    await set_level_active(level_key, is_active)
    return web.json_response({"ok": True})


async def admin_send_award(request: web.Request) -> web.Response:
    await _require_admin(request)
    payload = await request.json()

    tg_id = int(payload.get("telegram_id"))
    template_key = str(payload.get("template_key") or "participation")
    event_name = str(payload.get("event_name") or "").strip()
    event_date = str(payload.get("event_date") or "").strip()

    if not tg_id:
        raise web.HTTPBadRequest(text="telegram_id required")
    if not event_name:
        raise web.HTTPBadRequest(text="event_name required")
    if not event_date:
        raise web.HTTPBadRequest(text="event_date required")

    # Берём ФИО из статистики/БД
    user = await get_user(tg_id)
    if not user:
        raise web.HTTPNotFound(text="User not found")
    _, first_name, last_name, _, _ = user
    full_name = f"{first_name or ''} {last_name or ''}".strip() or str(tg_id)

    template_map = {
        "participation": "sertificat.png",
        "1": "1mesto.png",
        "2": "2mesto.png",
        "3": "3mesto.png",
    }
    if template_key not in template_map:
        raise web.HTTPBadRequest(text="Bad template_key")

    png_bytes = _render_award_png(
        template_filename=template_map[template_key],
        full_name=full_name,
        event_name=event_name,
        event_date=event_date,
    )

    bot: Bot = request.app["bot"]
    filename = f"award_{template_key}_{tg_id}.png"
    file = BufferedInputFile(png_bytes, filename=filename)

    caption = (
        "Сертификат за участие" if template_key == "participation" else f"Диплом за {template_key} место"
    )
    caption = f"{caption}\n{event_name} — {event_date}"

    try:
        await bot.send_document(chat_id=tg_id, document=file, caption=caption)
    except Exception as e:
        # например, пользователь не писал боту/заблокировал
        raise web.HTTPBadRequest(text=f"Send failed: {e}")

    return web.json_response({"ok": True, "sent_to": tg_id})


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])

    # Bot instance для отправки грамот из админ-панели
    token = os.getenv("BOT_TOKEN", "")
    app["bot"] = Bot(token=token) if token else Bot(token="0")

    async def _close_bot(app_: web.Application):
        try:
            await app_["bot"].session.close()
        except Exception:
            pass

    app.on_cleanup.append(_close_bot)

    # API
    app.router.add_get("/api/levels", handle_levels)

    app.router.add_get("/api/admin/stats", admin_get_stats)
    app.router.add_post("/api/admin/reset_scores", admin_reset_scores)
    app.router.add_post("/api/admin/delete_user", admin_delete_user)
    app.router.add_post("/api/admin/set_level", admin_set_level)
    app.router.add_post("/api/admin/send_award", admin_send_award)

    # Static webapp
    app.router.add_static("/", WEBAPP_DIR, show_index=True)
    return app


async def run_web_server() -> None:
    host = os.getenv("WEB_HOST", "0.0.0.0")
    port = int(os.getenv("WEB_PORT", os.getenv("PORT", "8080")))

    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=host, port=port)
    logging.getLogger(__name__).info("Web server starting on http://%s:%s", host, port)
    await site.start()

    # держим задачу живой
    while True:
        await asyncio.sleep(3600)
