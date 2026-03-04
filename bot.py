import asyncio
import logging
import os

from aiogram import Bot, Dispatcher
from dotenv import load_dotenv

from database.db import close_db, create_table
from handlers import user_reg
from max_bot import start_max_bot
from web_server import run_web_server

load_dotenv()

async def start_telegram_bot() -> None:
    """Запускает Telegram-бота (polling) если задан BOT_TOKEN."""
    token = (os.getenv("BOT_TOKEN") or "").strip()
    if not token:
        logging.getLogger(__name__).info("BOT_TOKEN is empty: Telegram bot is disabled")
        return

    bot = Bot(token=token)
    dp = Dispatcher()
    dp.include_router(user_reg.router)
    await dp.start_polling(bot)


async def main():
    logging.basicConfig(level=logging.INFO)

    await create_table()

    # WebApp + Admin + MAX webhook
    web_task = asyncio.create_task(run_web_server())

    # MAX bot service (subscription/webhook handled by web_server; this task keeps helpers alive)
    max_task = asyncio.create_task(start_max_bot())

    # Telegram polling
    tg_task = asyncio.create_task(start_telegram_bot())

    try:
        await asyncio.gather(web_task, max_task, tg_task)
    finally:
        for t in (web_task, max_task, tg_task):
            if not t.done():
                t.cancel()
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот выключен")
