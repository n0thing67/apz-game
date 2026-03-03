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

async def main():
    logging.basicConfig(level=logging.INFO)

    await create_table()

    # Telegram бот запускаем только если задан BOT_TOKEN.
    bot = None
    dp = None
    if TOKEN:
        bot = Bot(token=TOKEN)
        dp = Dispatcher()
        dp.include_router(user_reg.router)

    # Поднимаем мини-веб-приложение (игра + админ-панель) вместе с polling.
    # Внешний URL нужно прокинуть в .env (WEBAPP_URL), а порт - WEB_PORT/PORT.
    web_task = asyncio.create_task(run_web_server())

    print("Сервис запущен...")
    try:
        # Если Telegram включён — работаем как раньше (polling).
        # MAX работает через webhook внутри web_server.py (если задан MAX_BOT_TOKEN).
        if dp and bot:
            await dp.start_polling(bot)
        else:
            # Только web_server (webapp + MAX webhook)
            while True:
                await asyncio.sleep(3600)
    finally:
        web_task.cancel()
        # Закрываем shared-соединение с SQLite
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот выключен")
