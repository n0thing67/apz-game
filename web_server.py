import asyncio
import hashlib
import hmac
import json
import logging
import os
from urllib.parse import parse_qsl

from aiohttp import web

from database.db import (
    get_levels,
    set_level_active,
    get_top_users,
    get_all_users,
    delete_user,
    reset_all_scores,
)


WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")


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


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])

    # API
    app.router.add_get("/api/levels", handle_levels)

    app.router.add_get("/api/admin/stats", admin_get_stats)
    app.router.add_post("/api/admin/reset_scores", admin_reset_scores)
    app.router.add_post("/api/admin/delete_user", admin_delete_user)
    app.router.add_post("/api/admin/set_level", admin_set_level)

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
