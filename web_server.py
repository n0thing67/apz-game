import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime
from io import BytesIO
from urllib.parse import parse_qsl
from aiohttp import web
import aiohttp
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
    delete_all_users,
    reset_all_scores,
    reset_user_scores,
    get_stats_reset_token,
    get_user_deleted_token,
    get_user_reset_token,
    update_score,
    update_aptitude_top,
)
WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")
# Шаблоны грамот/дипломов (вариант A: PNG + наложение текста)
CERT_TEMPLATES_DIR = os.path.join(WEBAPP_DIR, "assets", "cert_templates")
# -------------------------
# MAX bot webhook integration
# -------------------------
async def handle_max_webhook(request: web.Request) -> web.Response:
    """Webhook endpoint for MAX Bot API.
    Если MAX не настроен (нет MAX_BOT_TOKEN) — просто возвращаем 200 OK.
    Если задан MAX_WEBHOOK_SECRET — проверяем заголовок X-Max-Bot-Api-Secret.
    """
    token = (request.app.get("max_token") or "").strip()
    if not token:
        return web.json_response({"ok": True})
    secret = (request.app.get("max_secret") or "").strip()
    if secret:
        their = (request.headers.get("X-Max-Bot-Api-Secret") or "").strip()
        if their != secret:
            return web.Response(status=401, text="bad secret")
    try:
        update = await request.json()
    except Exception:
        return web.Response(status=400, text="bad json")
    try:
        from max_bot import handle_update
        await handle_update(request.app, update)
    except Exception as e:
        logging.getLogger(__name__).exception("MAX webhook handler error: %s", e)
        # Важно вернуть 200, чтобы MAX не делал ретраи из-за наших внутренних исключений.
        return web.json_response({"ok": True})
    return web.json_response({"ok": True})
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
    # Для дипломов (1/2/3 место) по ТЗ опускаем блоки ниже на 100px,
    # сертификат оставляем без изменений.
    offset_y = 100 if template_filename in {"1mesto.png", "2mesto.png", "3mesto.png"} else 0
    # Мероприятие (крупно, как ФИО)
    event_text = (event_name or "").strip()
    event_font = _fit_font(draw, event_text, bold_font_path, max_text_width, start_size=int(h * 0.05), min_size=26)
    event_bbox = draw.textbbox((0, 0), event_text, font=event_font)
    event_w = event_bbox[2] - event_bbox[0]
    event_h = event_bbox[3] - event_bbox[1]
    event_y = int(h * 0.30) + offset_y
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
def _verify_max_webapp_init_data(init_data: str, bot_token: str) -> dict | None:
    """Проверка initData из MAX WebApp (HMAC SHA-256)."""
    if not init_data or not bot_token:
        return None
    try:
        from urllib.parse import unquote_plus
        parts = [item for item in str(init_data).split("&") if item]
        pairs: list[tuple[str, str]] = []
        their_hash = None
        for part in parts:
            if "=" in part:
                key, value = part.split("=", 1)
            else:
                key, value = part, ""
            key = key.strip()
            if not key:
                continue
            if key == "hash":
                their_hash = value
                continue
            pairs.append((key, unquote_plus(value)))
        if not their_hash:
            return None
        # data_check_string: key=value\n... отсортировано по ключу
        launch_params = "\n".join(f"{k}={v}" for k, v in sorted(pairs, key=lambda kv: kv[0]))
        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calc_hash = hmac.new(secret_key, launch_params.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc_hash, their_hash):
            return None
        return {k: v for k, v in pairs}
    except Exception:
        return None
def _extract_max_user_id(verified_params: dict) -> int | None:
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
    return {int(x.strip()) for x in raw_admins.split(",") if x.strip().lstrip("-").isdigit()}
def _get_admin_auth_secret() -> str:
    return (
        (os.getenv("ADMIN_AUTH_SECRET") or "").strip()
        or (os.getenv("MAX_BOT_TOKEN") or "").strip()
        or (os.getenv("BOT_TOKEN") or "").strip()
    )
def _max_user_id_from_db_id(db_user_id: int) -> int:
    return abs(int(db_user_id))
def _parse_boolish(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    s = str(value or "").strip().lower()
    if s in {"1", "true", "yes", "on", "y"}:
        return True
    if s in {"0", "false", "no", "off", "n", ""}:
        return False
    return bool(value)
async def _max_upload_file(app: web.Application, content: bytes, filename: str, content_type: str = "application/octet-stream") -> dict:
    token = (app.get("max_token") or "").strip()
    session: aiohttp.ClientSession = app["max_session"]
    if not token:
        raise RuntimeError("MAX bot token is not configured")
    headers = {"Authorization": token}
    async with session.post(f"{(os.getenv('MAX_API_BASE', 'https://platform-api.max.ru').rstrip('/'))}/uploads", headers=headers, params={"type": "file"}) as resp:
        body = await resp.text()
        if resp.status >= 400:
            raise RuntimeError(f"MAX upload init failed: {resp.status} {body}")
        try:
            init_data = json.loads(body) if body else {}
        except Exception:
            init_data = {}
    upload_url = str(init_data.get("url") or "").strip()
    if not upload_url:
        raise RuntimeError("MAX upload init did not return url")
    form = aiohttp.FormData()
    form.add_field("data", content, filename=filename, content_type=content_type)
    async with session.post(upload_url, headers=headers, data=form) as resp:
        body = await resp.text()
        if resp.status >= 400:
            raise RuntimeError(f"MAX file upload failed: {resp.status} {body}")
        try:
            uploaded = json.loads(body) if body else {}
        except Exception:
            uploaded = {}
    if not uploaded.get("token"):
        raise RuntimeError("MAX upload did not return token")
    return uploaded
async def _send_document_to_max_user(app: web.Application, *, max_user_id: int, content: bytes, filename: str, caption: str) -> None:
    from max_bot import send_message
    uploaded = await _max_upload_file(app, content, filename, content_type="image/png")
    token = app.get("max_token") or ""
    session: aiohttp.ClientSession = app["max_session"]
    attachments = [{"type": "file", "payload": uploaded}]
    retry_delays = (0.0, 1.0, 2.0)
    last_error = None
    for delay in retry_delays:
        if delay:
            await asyncio.sleep(delay)
        try:
            await send_message(session, token, user_id=int(max_user_id), text=caption, attachments=attachments)
            return
        except Exception as e:
            last_error = e
            msg = str(e)
            if "attachment.not.ready" not in msg and "not.processed" not in msg:
                raise
    if last_error:
        raise last_error
def _verify_admin_token(raw_token: str) -> int | None:
    token = (raw_token or "").strip()
    if not token:
        return None
    try:
        uid_raw, exp_raw, sig = token.split(".", 2)
        uid = int(uid_raw)
        exp = int(exp_raw)
    except Exception:
        return None
    if exp < int(time.time()):
        return None
    secret = _get_admin_auth_secret()
    if not secret:
        return None
    payload = f"{uid}:{exp}"
    expected = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    if uid not in _get_admin_ids():
        return None
    return uid
async def _send_admin_log(app: web.Application, text: str) -> None:
    """Отправляет запись в канал админки (если настроен ADMIN_CHANNEL_ID).
    Логирование не должно ломать основной функционал: любые ошибки проглатываем.
    """
    admin_channel_id_raw = (os.getenv("ADMIN_CHANNEL_ID") or "").strip()
    if not admin_channel_id_raw:
        return
    try:
        admin_channel_id = int(admin_channel_id_raw)
    except Exception:
        return
    try:
        bot: Bot = app["bot"]
        await bot.send_message(chat_id=admin_channel_id, text=text)
    except Exception:
        # Канал может быть недоступен/бот не добавлен/нет прав — не блокируем админ-операции.
        return
async def _format_actor(admin_id: int) -> str:
    """Человеко-читаемое представление админа по tg_id."""
    try:
        row = await get_user(int(admin_id))
        if row:
            _, first_name, last_name, *_rest = row
            full_name = f"{first_name or ''} {last_name or ''}".strip()
            if full_name:
                return f"{full_name} (ID: {admin_id})"
    except Exception:
        pass
    return f"ID: {admin_id}"
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
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-InitData, X-Max-InitData, X-Max-User-Token, X-Admin-Token"
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
    user_reset_token = "0"
    if uid_raw:
        try:
            uid = int(uid_raw)
            user = await get_user(uid)
            user_exists = bool(user)
            if not user_exists:
                user_deleted_token = await get_user_deleted_token(uid)
            else:
                user_reset_token = await get_user_reset_token(uid)
        except Exception:
            user_exists = None
            user_deleted_token = "0"
            user_reset_token = "0"
    resp = web.json_response(
        {
            "ok": True,
            "levels": levels,
            "reset_token": reset_token,
            "user_exists": user_exists,
            "user_deleted_token": str(user_deleted_token or "0"),
            "user_reset_token": str(user_reset_token or "0"),
        }
    )
    # Внешний браузер/MAX WebView может кешировать ответ /api/levels и показывать
    # старый статус уровней даже после успешного переключения в админке.
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp
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
                "user_reset_token": "0",
            }
        )
    try:
        user_obj = json.loads(user_raw) if isinstance(user_raw, str) else user_raw
        tg_id = int(user_obj.get("id"))
    except Exception:
        return web.json_response({"ok": False, "error": "bad_user"}, status=400)
    # Метка удаления пользователя (если админ удалил его в панели) — нужна, чтобы очистить localStorage в WebApp.
    user_deleted_token = await get_user_deleted_token(tg_id)
    # Метка сброса статистики пользователя (если админ очистил только его).
    user_reset_token = await get_user_reset_token(tg_id)
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
                "user_reset_token": user_reset_token,
            }
        )
    telegram_id, first_name, last_name, age, city, score, aptitude_top = row
    return web.json_response(
        {
            "ok": True,
            "reset_token": reset_token,
            "exists": True,
            "user_exists": True,
            "user_deleted_token": user_deleted_token,
            "user_reset_token": user_reset_token,
            "user": {
                "telegram_id": telegram_id,
                "first_name": first_name,
                "last_name": last_name,
                "age": age,
                "city": city,
                "score": score,
                "aptitude_top": aptitude_top,
            },
        }
    )
async def _require_admin(request: web.Request) -> int:
    """Проверка admin: либо Telegram initData, либо подписанный admin_token для MAX/внешнего браузера."""
    admin_token = request.headers.get("X-Admin-Token") or request.query.get("admin_token") or ""
    token_user_id = _verify_admin_token(admin_token)
    if token_user_id is not None:
        return token_user_id
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
async def _require_user(request: web.Request) -> int:
    """Проверка пользователя по initData (Telegram WebApp). Возвращает telegram_id."""
    bot_token = os.getenv("BOT_TOKEN", "")
    init_data = request.headers.get("X-Telegram-InitData") or request.query.get("initData") or ""
    verified = _verify_telegram_webapp_init_data(init_data, bot_token)
    if not verified:
        raise web.HTTPUnauthorized(text="Bad initData")
    user_id = _extract_user_id(verified)
    if not user_id:
        raise web.HTTPUnauthorized(text="No user")
    return int(user_id)
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
                    "city": city,
                    "score": score,
                }
                for (tid, fn, ln, age, city, score) in users
            ],
        }
    )
async def admin_reset_scores(request: web.Request) -> web.Response:
    admin_id = await _require_admin(request)
    await reset_all_scores()
    actor = await _format_actor(admin_id)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await _send_admin_log(
        request.app,
        f"🧹 Очистка статистики (ВСЕ пользователи)\nАдмин: {actor}\nВремя: {ts}",
    )
    return web.json_response({"ok": True})
async def admin_reset_user_scores(request: web.Request) -> web.Response:
    """Сброс статистики одного пользователя (очки + профтест)."""
    admin_id = await _require_admin(request)
    payload = await request.json()
    tg_id = int(payload.get("telegram_id"))
    # Для красивого лога попробуем получить ФИО до сброса.
    user_label = str(tg_id)
    try:
        user = await get_user(tg_id)
        if user:
            _, fn, ln, _, city, _ = user
            full_name = f"{fn or ''} {ln or ''}".strip()
            if full_name:
                user_label = f"{full_name} (ID: {tg_id})"
            if city:
                user_label += f"; город: {city}"
    except Exception:
        pass
    await reset_user_scores(tg_id)
    actor = await _format_actor(admin_id)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await _send_admin_log(
        request.app,
        f"🧹 Очистка статистики (1 пользователь)\nПользователь: {user_label}\nАдмин: {actor}\nВремя: {ts}",
    )
    return web.json_response({"ok": True, "telegram_id": tg_id})
async def admin_delete_user(request: web.Request) -> web.Response:
    admin_id = await _require_admin(request)
    payload = await request.json()
    tg_id = int(payload.get("telegram_id"))
    user_label = str(tg_id)
    try:
        user = await get_user(tg_id)
        if user:
            _, fn, ln, _, city, score = user
            full_name = f"{fn or ''} {ln or ''}".strip()
            if full_name:
                user_label = f"{full_name} (ID: {tg_id})"
            if city:
                user_label += f"; город: {city}"
            if score is not None:
                user_label += f"; лучший счёт: {int(score)}"
    except Exception:
        pass
    await delete_user(tg_id)
    actor = await _format_actor(admin_id)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await _send_admin_log(
        request.app,
        f"🗑 Удаление пользователя\nПользователь: {user_label}\nАдмин: {actor}\nВремя: {ts}",
    )
    return web.json_response({"ok": True})
async def admin_delete_all_users(request: web.Request) -> web.Response:
    """Полная очистка таблицы users (все пользователи + их статистика)."""
    admin_id = await _require_admin(request)
    await delete_all_users()
    actor = await _format_actor(admin_id)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await _send_admin_log(
        request.app,
        f"🗑 Удаление ВСЕХ пользователей\nАдмин: {actor}\nВремя: {ts}",
    )
    return web.json_response({"ok": True})
async def admin_set_level(request: web.Request) -> web.Response:
    admin_id = await _require_admin(request)
    payload = {}
    if request.method == "POST":
        try:
            payload = await request.json()
        except Exception:
            try:
                payload = dict(await request.post())
            except Exception:
                payload = {}
    else:
        payload = dict(request.query)
    level_key = str(payload.get("level_key") or "").strip()
    if not level_key:
        raise web.HTTPBadRequest(text="level_key required")
    is_active = _parse_boolish(payload.get("is_active"))
    await set_level_active(level_key, is_active)
    actor = await _format_actor(admin_id)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    state = "включил(а)" if is_active else "отключил(а)"
    await _send_admin_log(
        request.app,
        f"🎮 {state} игру/уровень\nУровень: {level_key}\nАдмин: {actor}\nВремя: {ts}",
    )
    return web.json_response({"ok": True})
async def admin_send_award(request: web.Request) -> web.Response:
    admin_id = await _require_admin(request)
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
    _, first_name, last_name, _, _city, score = user
    full_name = f"{first_name or ''} {last_name or ''}".strip() or str(tg_id)
    template_map = {
        "participation": "sertificat.png",
    }
    if template_key not in template_map:
        raise web.HTTPBadRequest(text="Only participation certificate is allowed")
    png_bytes = _render_award_png(
        template_filename=template_map[template_key],
        full_name=full_name,
        event_name=event_name,
        event_date=event_date,
        score=score,
        font_key=font_key,
    )
    filename = f"award_{template_key}_{abs(tg_id)}.png"
    caption = (
        "Сертификат за участие" if template_key == "participation" else f"Диплом за {template_key} место"
    )
    caption = f"{caption}\n{event_name} — {event_date}\nОчки: {score if score is not None else 0}"
    try:
        if int(tg_id) < 0:
            # MAX-пользователи в общей БД хранятся как отрицательные ID.
            # Telegram Bot API не умеет отправлять документы таким пользователям,
            # поэтому отправляем файл через MAX Bot API.
            await _send_document_to_max_user(
                request.app,
                max_user_id=_max_user_id_from_db_id(int(tg_id)),
                content=png_bytes,
                filename=filename,
                caption=caption,
            )
        else:
            bot: Bot = request.app["bot"]
            file = BufferedInputFile(png_bytes, filename=filename)
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
        # например, пользователь не писал боту/заблокировал или MAX upload/message завершились ошибкой
        raise web.HTTPBadRequest(text=f"Send failed: {e}")
    actor = await _format_actor(admin_id)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user_platform = "MAX" if int(tg_id) < 0 else "Telegram"
    await _send_admin_log(
        request.app,
        f"🏅 Отправка сертификата\nПользователь: {full_name} (ID: {tg_id}; платформа: {user_platform})\nАдмин: {actor}\nВремя: {ts}",
    )
    return web.json_response({"ok": True, "sent_to": tg_id})
def _max_auth_secret() -> str:
    return (
        (os.getenv("ADMIN_AUTH_SECRET") or "").strip()
        or (os.getenv("MAX_BOT_TOKEN") or "").strip()
        or (os.getenv("BOT_TOKEN") or "").strip()
    )


def _verify_max_signed_token(token: str) -> int | None:
    token = str(token or "").strip()
    if not token:
        return None
    secret = _max_auth_secret()
    if not secret:
        return None
    try:
        padded = token + ("=" * ((4 - len(token) % 4) % 4))
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        uid_s, exp_s, sig = raw.split('.', 2)
        uid = int(uid_s)
        exp = int(exp_s)
        if exp < int(time.time()):
            return None
        payload = f"max:{uid}:{exp}"
        calc = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, sig):
            return None
        return uid
    except Exception:
        return None


async def _read_request_payload(request: web.Request) -> dict:
    data: dict = {}
    try:
        if request.can_read_body:
            ctype = (request.content_type or '').lower()
            if 'application/json' in ctype:
                raw_json = await request.json()
                if isinstance(raw_json, dict):
                    data = raw_json
            elif ctype in {'application/x-www-form-urlencoded', 'multipart/form-data'}:
                post_data = await request.post()
                data = dict(post_data)
            else:
                raw_body = (await request.text()).strip()
                if raw_body:
                    try:
                        parsed = json.loads(raw_body)
                        if isinstance(parsed, dict):
                            data = parsed
                        else:
                            data = dict(parse_qsl(raw_body, keep_blank_values=True))
                    except Exception:
                        data = dict(parse_qsl(raw_body, keep_blank_values=True))
    except Exception:
        data = {}
    return data


async def save_webapp_stats(request: web.Request) -> web.Response:
    """Прямое сохранение статистики из WebApp в БД.

    Поддерживает:
    - Telegram WebApp (X-Telegram-InitData / initData)
    - MAX Mini App / внешний браузер (max_init_data / mx_token)
    """
    data = await _read_request_payload(request)

    # 1) Telegram WebApp
    tg_init_data = (
        (request.headers.get("X-Telegram-InitData") or "").strip()
        or (request.query.get("initData") or "").strip()
        or str(data.get("initData") or data.get("telegram_init_data") or "").strip()
    )
    if tg_init_data:
        tg_token = os.getenv("BOT_TOKEN", "").strip()
        verified = _verify_telegram_webapp_init_data(tg_init_data, tg_token)
        if not verified:
            return web.json_response({"ok": False, "error": "bad_init_data"}, status=401)
        tg_user_id = _extract_user_id(verified)
        if not tg_user_id:
            return web.json_response({"ok": False, "error": "bad_user"}, status=400)

        user = await get_user(int(tg_user_id))
        if not user:
            return web.json_response({"ok": False, "error": "user_not_found"}, status=404)

        score_raw = data.get("score", None)
        score = 0
        if score_raw is not None:
            try:
                score = int(score_raw or 0)
            except Exception:
                score = 0

        aptitude_top = data.get("aptitude_top") or data.get("aptitudeTop") or None
        if isinstance(aptitude_top, str):
            aptitude_top = aptitude_top.strip() or None

        if aptitude_top is not None:
            await update_aptitude_top(int(tg_user_id), aptitude_top)
        if score_raw is not None:
            await update_score(int(tg_user_id), score)

        logging.getLogger(__name__).info(
            "WebApp save_stats ok (telegram): user_id=%s score=%s aptitude_top=%s",
            tg_user_id, score, aptitude_top,
        )
        return web.json_response({"ok": True, "platform": "telegram", "user_id": int(tg_user_id)})

    # 2) MAX Mini App / внешний браузер
    bot_token = (request.app.get("max_token") or "").strip()
    if not bot_token:
        return web.json_response({"ok": False, "error": "auth_required"}, status=401)

    max_init_data = (
        (request.headers.get("X-Max-InitData") or "").strip()
        or (request.query.get("max_init_data") or "").strip()
        or str(data.get("max_init_data") or "").strip()
    )
    max_user_id = None
    if max_init_data:
        verified = _verify_max_webapp_init_data(max_init_data, bot_token)
        if verified:
            max_user_id = _extract_max_user_id(verified)

    if max_user_id is None:
        signed_token = (
            (request.headers.get("X-Max-User-Token") or "").strip()
            or (request.query.get("mx_token") or "").strip()
            or str(data.get("mx_token") or data.get("max_user_token") or "").strip()
        )
        max_user_id = _verify_max_signed_token(signed_token)

    if max_user_id is None:
        logging.getLogger(__name__).warning(
            "WebApp save_stats auth failed: has_tg=%s has_max_init=%s has_max_token=%s",
            bool(tg_init_data),
            bool(max_init_data),
            bool((request.headers.get("X-Max-User-Token") or request.query.get("mx_token") or data.get("mx_token") or data.get("max_user_token"))),
        )
        return web.json_response({"ok": False, "error": "bad_webapp_auth"}, status=401)

    db_id = -int(max_user_id)
    user = await get_user(db_id)
    if not user:
        logging.getLogger(__name__).warning("WebApp save_stats user not found: max_user_id=%s db_id=%s", max_user_id, db_id)
        return web.json_response({"ok": False, "error": "user_not_found"}, status=404)

    score_raw = data.get("score", None)
    score = 0
    if score_raw is not None:
        try:
            score = int(score_raw or 0)
        except Exception:
            score = 0

    aptitude_top = data.get("aptitude_top") or data.get("aptitudeTop") or None
    if isinstance(aptitude_top, str):
        aptitude_top = aptitude_top.strip() or None

    if aptitude_top is not None:
        await update_aptitude_top(db_id, aptitude_top)
    if score_raw is not None:
        await update_score(db_id, score)

    logging.getLogger(__name__).info(
        "WebApp save_stats ok (max): max_user_id=%s db_id=%s score=%s aptitude_top=%s",
        max_user_id, db_id, score, aptitude_top,
    )

    # После успешного сохранения сразу отправляем статистику в чат MAX.
    # Тогда фронтенду не нужно открывать deep link после await/fetch,
    # что в мобильных WebView часто блокируется как переход без пользовательского жеста.
    try:
        from max_bot import _send_stats_max
        await _send_stats_max(request.app, max_user_id=int(max_user_id))
    except Exception as e:
        logging.getLogger(__name__).exception(
            "WebApp save_stats post-send failed: max_user_id=%s err=%s",
            max_user_id,
            e,
        )

    return web.json_response({"ok": True, "platform": "max", "max_user_id": int(max_user_id), "user_id": db_id})


async def save_max_stats(request: web.Request) -> web.Response:
    """Совместимость со старым MAX endpoint: делегируем в общий обработчик."""
    return await save_webapp_stats(request)

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
    # --- MAX bot ---
    # Токен MAX бота (для webhook / отправки сообщений)
    app["max_token"] = (os.getenv("MAX_BOT_TOKEN") or "").strip()
    app["max_secret"] = (os.getenv("MAX_WEBHOOK_SECRET") or "").strip()
    app["max_state"] = {}  # простой in-memory FSM для регистрации
    app["max_session"] = aiohttp.ClientSession()  # общий session для MAX API
    async def _close_max(app_: web.Application):
        try:
            await app_["max_session"].close()
        except Exception:
            pass
    app.on_cleanup.append(_close_max)
    # API
    app.router.add_get("/api/levels", handle_levels)
    app.router.add_get("/api/me", handle_me)
    app.router.add_post("/api/save_stats", save_webapp_stats)
    app.router.add_post("/api/max/save_stats", save_max_stats)
    app.router.add_get("/api/admin/stats", admin_get_stats)
    app.router.add_post("/api/admin/reset_scores", admin_reset_scores)
    app.router.add_post("/api/admin/reset_user_scores", admin_reset_user_scores)
    app.router.add_post("/api/admin/delete_user", admin_delete_user)
    app.router.add_post("/api/admin/delete_all_users", admin_delete_all_users)
    app.router.add_get("/api/admin/set_level", admin_set_level)
    app.router.add_post("/api/admin/set_level", admin_set_level)
    app.router.add_post("/api/admin/send_award", admin_send_award)
    # MAX webhook
    app.router.add_post("/max/webhook", handle_max_webhook)
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
