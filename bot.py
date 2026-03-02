import asyncio
import os
import logging
from aiogram import Bot, Dispatcher
from dotenv import load_dotenv
from database.db import create_table, close_db

from web_server import run_web_server

load_dotenv()

from handlers import user_reg

TOKEN = os.getenv("BOT_TOKEN")
MAX_TOKEN = os.getenv("MAX_BOT_TOKEN")


async def _init_db_forever() -> None:
    """Инициализация БД с ретраями.
    Важно: не валим весь процесс, если Postgres/Supabase временно недоступен."""
    backoff = 2
    while True:
        try:
            await create_table()
            logging.info("DB is ready")
            return
        except Exception as e:
            logging.exception("DB init failed, will retry: %s", e)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def main():
    logging.basicConfig(level=logging.INFO)

    # 1) Всегда поднимаем веб-сервер (webapp + webhook-и). Render должен увидеть открытый порт.
    web_task = asyncio.create_task(run_web_server())

    # 2) Инициализацию БД делаем в фоне, чтобы не падать при временной недоступности Supabase.
    db_task = asyncio.create_task(_init_db_forever())

    # 3) Telegram polling запускаем только если задан BOT_TOKEN.
    tg_task = None
    if TOKEN:
        bot = Bot(token=TOKEN)
        dp = Dispatcher()
        dp.include_router(user_reg.router)
        tg_task = asyncio.create_task(dp.start_polling(bot))
        logging.info("Telegram polling started")
    else:
        logging.info("BOT_TOKEN not set -> Telegram disabled")

    # 4) Живём, пока жив веб-сервер (или tg_task, если он есть).
    try:
        if tg_task:
            await tg_task
        else:
            await web_task
    finally:
        for t in (tg_task, db_task, web_task):
            if t and not t.done():
                t.cancel()
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот выключен")
