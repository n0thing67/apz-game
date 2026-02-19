import os
import json
import time
import hmac
import hashlib
import logging
from pathlib import Path
from urllib.parse import parse_qsl

import asyncio
from aiohttp import web

from database.db import (
    get_user_profile,
    get_all_users,
    get_levels,
    set_level_active,
    reset_all_scores,
    reset_user_scores,
    delete_user,
    delete_all_users,
    get_stats_reset_token,
    get_user_reset_token,
    get_user_deleted_token,
)

# =========================
# Telegram WebApp initData
# =========================

def _parse_init_data(init_data: str) -> dict:
    init_data = (init_data or "").strip()
    if init_data.startswith("?"):
        init_data = init_data[1:]
    # НЕ strict_parsing: Telegram WebView иногда отдаёт пустые значения/особые символы
    pairs = parse_qsl(init_data, keep_blank_values=True)
    return {k: v for k, v in pairs}

def _verify_telegram_webapp_init_data(init_data: str, bot_token: str) -> tuple[bool, dict]:
    """
    Returns (ok, parsed_dict). Проверка по алгоритму Telegram WebApp.
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    try:
        data = _parse_init_data(init_data)
        given_hash = data.get("hash", "")
        if not given_hash:
            return False, data

        check_pairs = []
        for k, v in data.items():
            if k == "hash":
                continue
            check_pairs.append(f"{k}={v}")
        check_pairs.sort()
        data_check_string = "\n".join(check_pairs)

        secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
        calc_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(calc_hash, given_hash):
            return False, data

        return True, data
    except Exception:
        return False, {}

def _extract_user_id(parsed_init: dict) -> int | None:
    try:
        user_json = parsed_init.get("user")
        if not user_json:
            return None
        user = json.loads(user_json)
        uid = user.get("id")
        return int(uid) if uid is not None else None
    except Exception:
        return None

def _get_init_data_from_request(request: web.Request) -> str:
    # 1) header (как в админке)
    init_data = request.headers.get("X-Telegram-InitData", "")
    if init_data:
        return init_data

    # 2) query (старый клиент)
    init_data = request.query.get("initData", "") or request.query.get("init_data", "")
    if init_data:
        return init_data

    return ""

def _admin_ids() -> set[int]:
    raw = os.getenv("ADMIN_IDS", "")
    return {int(x.strip()) for x in raw.split(",") if x.strip().isdigit()}

def _is_admin(user_id: int) -> bool:
    return user_id in _admin_ids()

# =========================
# HTTP handlers
# =========================

async def handle_levels(request: web.Request) -> web.Response:
    levels = await get_levels()
    return web.json_response({"ok": True, "levels": levels})

async def handle_me(request: web.Request) -> web.Response:
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    init_data = _get_init_data_from_request(request)
    ok, parsed = _verify_telegram_webapp_init_data(init_data, bot_token) if bot_token else (False, {})
    if not ok:
        return web.json_response({"ok": False, "error": "bad_init_data"}, status=401)

    user_id = _extract_user_id(parsed)
    if not user_id:
        return web.json_response({"ok": False, "error": "no_user"}, status=401)

    row = await get_user_profile(int(user_id))
    if not row:
        # пользователь мог быть удалён админом — фронт сам покажет регистрацию/нулевые значения
        user = {"telegram_id": int(user_id), "first_name": "", "last_name": "", "age": None, "score": 0, "aptitude_top": None}
    else:
        telegram_id, first_name, last_name, age, score, aptitude_top = row
        user = {
            "telegram_id": telegram_id,
            "first_name": first_name or "",
            "last_name": last_name or "",
            "age": age,
            "score": int(score or 0),
            "aptitude_top": aptitude_top,
        }

    stats_reset_token = await get_stats_reset_token()
    user_reset_token = await get_user_reset_token(int(user_id))
    user_deleted_token = await get_user_deleted_token(int(user_id))

    return web.json_response({
        "ok": True,
        "user": user,
        "stats_reset_token": stats_reset_token,
        "user_reset_token": user_reset_token,
        "user_deleted_token": user_deleted_token,
        "is_admin": _is_admin(int(user_id)),
    })

async def handle_user_reset_scores(request: web.Request) -> web.Response:
    """
    Сброс статистики текущего пользователя (мини-веб).
    Делает ТО ЖЕ, что админская очистка статистики конкретного пользователя:
    database.db.reset_user_scores(user_id)
    """
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    init_data = _get_init_data_from_request(request)

    # дополнительно: если клиент отправил JSON body {initData: "..."} — подхватим
    if not init_data:
        try:
            body = await request.json()
            init_data = (body.get("initData") or body.get("init_data") or "").strip()
        except Exception:
            pass

    ok, parsed = _verify_telegram_webapp_init_data(init_data, bot_token) if bot_token else (False, {})
    if not ok:
        return web.json_response({"ok": False, "error": "bad_init_data"}, status=401)

    user_id = _extract_user_id(parsed)
    if not user_id:
        return web.json_response({"ok": False, "error": "no_user"}, status=401)

    await reset_user_scores(int(user_id))

    # отдадим токены, чтобы WebApp мог синхронизировать localStorage
    stats_reset_token = await get_stats_reset_token()
    user_reset_token = await get_user_reset_token(int(user_id))

    return web.json_response({"ok": True, "reset_token": stats_reset_token, "user_reset_token": user_reset_token})

# -------- Admin API --------

async def _require_admin(request: web.Request) -> int | None:
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    init_data = _get_init_data_from_request(request)
    ok, parsed = _verify_telegram_webapp_init_data(init_data, bot_token) if bot_token else (False, {})
    if not ok:
        return None
    uid = _extract_user_id(parsed)
    if not uid or not _is_admin(int(uid)):
        return None
    return int(uid)

async def handle_admin_stats(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)

    rows = await get_all_users(limit=200)
    users = []
    for telegram_id, first_name, last_name, age, score in rows:
        users.append({
            "telegram_id": telegram_id,
            "first_name": first_name or "",
            "last_name": last_name or "",
            "age": age,
            "score": int(score or 0),
        })
    return web.json_response({"ok": True, "users": users})

async def handle_admin_reset_all(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)
    await reset_all_scores()
    return web.json_response({"ok": True})

async def handle_admin_reset_user(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)
    try:
        body = await request.json()
    except Exception:
        body = {}
    tg_id = int(body.get("telegram_id") or 0)
    if not tg_id:
        return web.json_response({"ok": False, "error": "bad_request"}, status=400)
    await reset_user_scores(tg_id)
    return web.json_response({"ok": True})

async def handle_admin_delete_user(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)
    try:
        body = await request.json()
    except Exception:
        body = {}
    tg_id = int(body.get("telegram_id") or 0)
    if not tg_id:
        return web.json_response({"ok": False, "error": "bad_request"}, status=400)
    await delete_user(tg_id)
    return web.json_response({"ok": True})

async def handle_admin_delete_all_users(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)
    await delete_all_users()
    return web.json_response({"ok": True})

async def handle_admin_set_level(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)
    try:
        body = await request.json()
    except Exception:
        body = {}
    level_key = str(body.get("level_key") or "").strip()
    is_active = bool(body.get("is_active"))
    if not level_key:
        return web.json_response({"ok": False, "error": "bad_request"}, status=400)
    await set_level_active(level_key, is_active)
    return web.json_response({"ok": True})

# --- Awards (минимально рабочая реализация, без изменения остальных процессов) ---
from PIL import Image, ImageDraw, ImageFont  # Pillow in requirements
import aiohttp

_CERT_DIR = Path(__file__).resolve().parent / "webapp" / "assets" / "cert_templates"

def _font_by_key(font_key: str, size: int) -> ImageFont.FreeTypeFont:
    key = (font_key or "").strip().lower()
    # DejaVu доступен на большинстве linux-окружений
    if key == "dejavu_serif":
        path = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
    else:
        path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:
        return ImageFont.truetype(path, size=size)
    except Exception:
        return ImageFont.load_default()

def _center(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, y: int, img_w: int, fill=(0,0,0)):
    w = draw.textlength(text, font=font)
    x = int((img_w - w) / 2)
    draw.text((x, y), text, font=font, fill=fill)

async def handle_admin_send_award(request: web.Request) -> web.Response:
    if await _require_admin(request) is None:
        return web.json_response({"ok": False, "error": "forbidden"}, status=403)
    try:
        body = await request.json()
    except Exception:
        body = {}

    tg_id = int(body.get("telegram_id") or 0)
    template_key = str(body.get("template_key") or "participation")
    event_name = str(body.get("event_name") or "").strip()
    event_date = str(body.get("event_date") or "").strip()
    font_key = str(body.get("font_key") or "dejavu_sans")

    if not tg_id or not event_name or not event_date:
        return web.json_response({"ok": False, "error": "bad_request"}, status=400)

    # получаем имя/очки
    row = await get_user_profile(tg_id)
    first_name = last_name = ""
    score = 0
    if row:
        _, first_name, last_name, _, score, _ = row
    full_name = f"{last_name or ''} {first_name or ''}".strip() or str(tg_id)

    # выбираем шаблон
    if template_key == "1":
        tmpl = _CERT_DIR / "1mesto.png"
    elif template_key == "2":
        tmpl = _CERT_DIR / "2mesto.png"
    elif template_key == "3":
        tmpl = _CERT_DIR / "3mesto.png"
    else:
        tmpl = _CERT_DIR / "sertificat.png"

    if not tmpl.exists():
        return web.json_response({"ok": False, "error": "template_missing"}, status=500)

    img = Image.open(tmpl).convert("RGBA")
    draw = ImageDraw.Draw(img)
    W, H = img.size

    # Позиции: «дипломы» (1/2/3) у вас уже требовали опускать блоки на 100px.
    # Делаем это здесь, сертификат оставляем как есть.
    is_diploma = template_key in ("1","2","3")
    dy = 100 if is_diploma else 0

    font_event = _font_by_key(font_key, 40)
    font_name = _font_by_key(font_key, 52)
    font_score = _font_by_key(font_key, 36)
    font_date = _font_by_key(font_key, 30)

    # Центровка по ширине, базовые Y подобраны под ваши шаблоны (работают стабильно),
    # а для дипломов добавляем dy=100 как просили.
    _center(draw, event_name, font_event, y=520 + dy, img_w=W)
    _center(draw, full_name, font_name, y=640 + dy, img_w=W)
    _center(draw, f"Очки: {int(score or 0)}", font_score, y=760 + dy, img_w=W)
    _center(draw, event_date, font_date, y=980 + dy, img_w=W)

    out_dir = Path(os.getenv("RENDER_DISK_PATH") or Path(__file__).resolve().parent / "tmp")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"award_{tg_id}_{int(time.time()*1000)}.png"
    img.save(out_path, format="PNG")

    # Отправка файлом в Telegram
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    if not bot_token:
        return web.json_response({"ok": False, "error": "no_bot_token"}, status=500)

    api_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"

    async with aiohttp.ClientSession() as session:
        data = aiohttp.FormData()
        data.add_field("chat_id", str(tg_id))
        data.add_field("caption", "Документ сформирован ✅")
        data.add_field("document", out_path.read_bytes(), filename=out_path.name, content_type="image/png")
        async with session.post(api_url, data=data) as resp:
            if resp.status != 200:
                txt = await resp.text()
                logging.error("sendDocument failed: %s %s", resp.status, txt)
                return web.json_response({"ok": False, "error": "send_failed"}, status=502)

    return web.json_response({"ok": True})

# =========================
# App bootstrap
# =========================

@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        resp = await handler(request)

    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-InitData"
    return resp

async def run_web_server() -> None:
    port = int(os.getenv("WEB_PORT") or os.getenv("PORT") or "8080")

    app = web.Application(middlewares=[cors_middleware])

    # API
    app.router.add_get("/api/levels", handle_levels)
    app.router.add_get("/api/me", handle_me)
    app.router.add_post("/api/user/reset_scores", handle_user_reset_scores)

    app.router.add_get("/api/admin/stats", handle_admin_stats)
    app.router.add_post("/api/admin/reset_scores", handle_admin_reset_all)
    app.router.add_post("/api/admin/reset_user_scores", handle_admin_reset_user)
    app.router.add_post("/api/admin/delete_user", handle_admin_delete_user)
    app.router.add_post("/api/admin/delete_all_users", handle_admin_delete_all_users)
    app.router.add_post("/api/admin/set_level", handle_admin_set_level)
    app.router.add_post("/api/admin/send_award", handle_admin_send_award)

    # Static webapp
    base_dir = Path(__file__).resolve().parent / "webapp"
    app.router.add_get("/", lambda r: web.FileResponse(base_dir / "index.html"))
    app.router.add_get("/admin", lambda r: web.FileResponse(base_dir / "admin.html"))
    app.router.add_static("/", str(base_dir), show_index=False)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="0.0.0.0", port=port)
    await site.start()

    logging.info("Web server started on port %s", port)

    # Keep alive
    while True:
        await asyncio.sleep(3600)
