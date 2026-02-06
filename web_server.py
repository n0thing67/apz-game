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
    get_user_profile,
    delete_user,
    reset_all_scores,
    get_stats_reset_token,
    get_user_deleted_token,
)


WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")

# Шаблоны грамот/дипломов (вариант A: PNG + наложение текста)
CERT_TEMPLATES_DIR = os.path.join(WEBAPP_DIR, "assets", "cert_templates")


def _resolve_font_paths(font_key: str):
    """Возвращает (regular_path, bold_path) с безопасным фолбэком.

    В админке доступен выбор нескольких шрифтов. Здесь оставляем только те,
    которые гарантированно умеют кириллицу и часто присутствуют в Linux-окружении.
    Если конкретного шрифта нет в системе — используем DejaVu Sans как фолбэк.
    """

    base = "/usr/share/fonts/truetype"

    # В проекте оставляем только DejaVu Sans / DejaVu Serif.
    # Все остальные ключи безопасно фолбэкаются в DejaVu Sans.
    font_map = {
        "dejavu_sans": (
            f"{base}/dejavu/DejaVuSans.ttf",
            f"{base}/dejavu/DejaVuSans-Bold.ttf",
        ),
        "dejavu_serif": (
            f"{base}/dejavu/DejaVuSerif.ttf",
            f"{base}/dejavu/DejaVuSerif-Bold.ttf",
        ),
        # Совместимость со старым ключом
        "sans": (
            f"{base}/dejavu/DejaVuSans.ttf",
            f"{base}/dejavu/DejaVuSans-Bold.ttf",
        ),
        "serif": (
            f"{base}/dejavu/DejaVuSerif.ttf",
            f"{base}/dejavu/DejaVuSerif-Bold.ttf",
        ),
    }

    key = str(font_key or "dejavu_sans").lower()
    regular, bold = font_map.get(key, font_map["dejavu_sans"])

    # если bold отсутствует — используем regular
    if not os.path.exists(regular):
        regular, bold = font_map["dejavu_sans"]
    if not os.path.exists(bold):
        bold = regular

    return (regular, bold)


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


def _render_award_png(template_filename: str, full_name: str, event_name: str, event_date: str, score: int | None = None, font_key: str = "sans") -> bytes:
    template_path = os.path.join(CERT_TEMPLATES_DIR, template_filename)
    img = Image.open(template_path).convert("RGBA")
    w, h = img.size
    draw = ImageDraw.Draw(img)

    regular_font_path, bold_font_path = _resolve_font_paths(font_key)

    # Блоки текста (относительно размера шаблона)
    # Требования:
    # 1) название мероприятия — чуть ниже "Сертификат за участие" и крупное (как ФИО)
    # 2) ФИО сразу под мероприятием
    # 3) Очки сразу под ФИО
    # 4) Дата на уровне "верхушки кубка" (примерно 70% высоты, с защитой от наложения)
    max_text_width = int(w * 0.78)
    gap = max(10, int(h * 0.02))
    top_shift = 100  # сдвиг верхнего блока текста вниз (в пикселях)

    # Мероприятие (крупно, как ФИО)
    event_text = (event_name or "").strip()
    # Мероприятие всегда в кавычках «...»
    if event_text and not (event_text.startswith("«") and event_text.endswith("»")):
        event_text = f"«{event_text}»"
    event_font = _fit_font(draw, event_text, bold_font_path, max_text_width, start_size=int(h * 0.05), min_size=26)
    event_bbox = draw.textbbox((0, 0), event_text, font=event_font)
    event_w = event_bbox[2] - event_bbox[0]
    event_h = event_bbox[3] - event_bbox[1]
    event_y = int(h * 0.30) + top_shift
    draw.text(((w - event_w) / 2, event_y), event_text, font=event_font, fill=(20, 30, 45, 255))

    # Имя участника — крупно, сразу под мероприятием
    name_font = _fit_font(draw, full_name, bold_font_path, max_text_width, start_size=int(h * 0.05), min_size=28)
    name_bbox = draw.textbbox((0, 0), full_name, font=name_font)
    name_w = name_bbox[2] - name_bbox[0]
    name_h = name_bbox[3] - name_bbox[1]
    name_y = event_y + event_h + gap
    draw.text(((w - name_w) / 2, name_y), full_name, font=name_font, fill=(20, 30, 45, 255))

    # Очки участника — сразу под ФИО
    try:
        score_val = int(score) if score is not None else 0
    except Exception:
        score_val = 0
    score_text = f"Очки: {score_val}"
    score_font = _fit_font(draw, score_text, regular_font_path, max_text_width, start_size=int(h * 0.035), min_size=18)
    score_bbox = draw.textbbox((0, 0), score_text, font=score_font)
    score_w = score_bbox[2] - score_bbox[0]
    score_h = score_bbox[3] - score_bbox[1]
    score_y = name_y + name_h + gap
    draw.text(((w - score_w) / 2, score_y), score_text, font=score_font, fill=(25, 45, 70, 255))

    # Дата — на уровне верхушки кубка слева (примерно), ниже очков если нужно
    date_text = f"Дата: {event_date}".strip()
    date_font = _fit_font(draw, date_text, regular_font_path, max_text_width, start_size=int(h * 0.03), min_size=18)
    date_bbox = draw.textbbox((0, 0), date_text, font=date_font)
    date_w = date_bbox[2] - date_bbox[0]
    date_h = date_bbox[3] - date_bbox[1]
    date_y_target = int(h * 0.70)
    date_y = max(date_y_target, score_y + score_h + gap)
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
    # Важно: WebApp шлёт initData в кастомном заголовке.
    # Если его не разрешить в CORS, браузер/WebView блокирует запросы (особенно /api/me),
    # и локальный localStorage потом «оживляет» старые очки/рекомендации после админского сброса.
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-InitData"
    return resp


async def handle_levels(request: web.Request) -> web.Response:
    # ВАЖНО: сброс статистики в WebApp должен работать так же надёжно,
    # как и отключение уровней. /api/levels вызывается без кастомных заголовков
    # (значит, без CORS-preflight), поэтому сюда также добавляем reset_token.
    #
    # Также сюда же (по uid в query) добавляем признак существования пользователя и метку удаления:
    # при удалении пользователя в админке WebApp должен очистить localStorage при следующем входе
    # так же надёжно, как и подхватываются отключённые уровни.
    levels = await get_levels()
    reset_token = await get_stats_reset_token()

    uid_raw = request.query.get("uid")
    user_exists = None
    user_deleted_token = "0"
    if uid_raw:
        try:
            uid = int(uid_raw)
            user = await get_user(uid)
            user_exists = bool(user)
            if not user_exists:
                user_deleted_token = await get_user_deleted_token(uid)
        except Exception:
            user_exists = None
            user_deleted_token = "0"

    return web.json_response(
        {
            "ok": True,
            "levels": levels,
            "reset_token": reset_token,
            "user_exists": user_exists,
            "user_deleted_token": str(user_deleted_token or "0"),
        }
    )



async def handle_me(request: web.Request) -> web.Response:
    """Возвращает состояние пользователя для WebApp.

    Нужно, чтобы при удалении/сбросе пользователя в админке
    локальная статистика (localStorage) не «оживляла» старые результаты
    после повторной регистрации.
    """
    # Сначала получаем текущий reset_token (он нужен даже если пользователя ещё нет в БД)
    reset_token = await get_stats_reset_token()

    init_data = request.headers.get("X-Telegram-InitData", "")
    token = os.getenv("BOT_TOKEN", "")
    parsed = _verify_telegram_webapp_init_data(init_data, token)
    if not parsed:
        return web.json_response({"ok": False, "error": "bad_init_data"}, status=401)

    user_raw = parsed.get("user")
    if not user_raw:
        return web.json_response(
            {
                "ok": True,
                "exists": False,
                "user_exists": False,
                "user": None,
                "reset_token": reset_token,
                "user_deleted_token": "0",
            }
        )

    try:
        user_obj = json.loads(user_raw) if isinstance(user_raw, str) else user_raw
        tg_id = int(user_obj.get("id"))
    except Exception:
        return web.json_response({"ok": False, "error": "bad_user"}, status=400)

    # Метка удаления пользователя (если админ удалил его в панели) — нужна, чтобы очистить localStorage в WebApp.
    user_deleted_token = await get_user_deleted_token(tg_id)

    row = await get_user_profile(tg_id)
    if not row:
        return web.json_response(
            {
                "ok": True,
                "exists": False,
                "user_exists": False,
                "user": None,
                "reset_token": reset_token,
                "user_deleted_token": user_deleted_token,
            }
        )

    telegram_id, first_name, last_name, age, score, aptitude_top = row
    return web.json_response(
        {
            "ok": True,
            "reset_token": reset_token,
            "exists": True,
            "user_exists": True,
            "user_deleted_token": user_deleted_token,
            "user": {
                "telegram_id": telegram_id,
                "first_name": first_name,
                "last_name": last_name,
                "age": age,
                "score": score,
                "aptitude_top": aptitude_top,
            },
        }
    )

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
    reset_token = await get_stats_reset_token()
    top = await get_top_users()
    users = await get_all_users(limit=500)
    return web.json_response(
        {
            "ok": True,
            "reset_token": reset_token,
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
    font_key = str(payload.get("font_key") or "sans").strip()

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
    _, first_name, last_name, _, score = user
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
        score=score,
        font_key=font_key,
    )

    bot: Bot = request.app["bot"]
    filename = f"award_{template_key}_{tg_id}.png"
    file = BufferedInputFile(png_bytes, filename=filename)

    caption = (
        "Сертификат за участие" if template_key == "participation" else f"Диплом за {template_key} место"
    )
    caption = f"{caption}\n{event_name} — {event_date}\nОчки: {score if score is not None else 0}"

    try:
        await bot.send_document(chat_id=tg_id, document=file, caption=caption)

        # Дублируем админу в закрытый канал (если задано)
        admin_channel_id_raw = (os.getenv("ADMIN_CHANNEL_ID") or "").strip()
        if admin_channel_id_raw:
            try:
                admin_channel_id = int(admin_channel_id_raw)
                admin_caption = (
                    f"🗂 Копия: {caption}\n"
                    f"Пользователь: {full_name}\n"
                    f"Telegram ID: {tg_id}"
                )
                # BufferedInputFile нельзя надёжно переиспользовать — создаём новый объект из тех же bytes
                file2 = BufferedInputFile(png_bytes, filename=filename)
                await bot.send_document(chat_id=admin_channel_id, document=file2, caption=admin_caption)
            except Exception:
                # Не блокируем отправку пользователю, если канал недоступен/не настроен
                pass
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
    app.router.add_get("/api/me", handle_me)

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
