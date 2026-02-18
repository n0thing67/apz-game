import asyncio
import os
import logging
from aiogram import Bot, Dispatcher
from dotenv import load_dotenv
from database.db import create_table, close_db

from web_server import run_web_server

load_dotenv()

from handlers import user_reg

# Токен бота берём из переменной окружения MAX_BOT_TOKEN.
# Оставляем обратную совместимость с прежним BOT_TOKEN (если он ещё используется в окружении).
TOKEN = (os.getenv("MAX_BOT_TOKEN") or os.getenv("BOT_TOKEN"))

async def main():
    logging.basicConfig(level=logging.INFO)

    await create_table()

    bot = Bot(token=TOKEN)
    dp = Dispatcher()

    dp.include_router(user_reg.router)

    # Поднимаем мини-веб-приложение (игра + админ-панель) вместе с polling.
    # Внешний URL нужно прокинуть в .env (WEBAPP_URL), а порт - WEB_PORT/PORT.
    web_task = asyncio.create_task(run_web_server())

    print("Бот запущен...")
    try:
        await dp.start_polling(bot)
    finally:
        web_task.cancel()
        # Закрываем shared-соединение с SQLite
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот выключен")
