import json
import os

from aiogram import Router, F, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton,
    WebAppInfo,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)

from database.db import (
    register_user,
    update_score,
    update_aptitude_top,
    get_top_users,
    get_top_users_stats,
    get_user,
    get_db,
)

router = Router()

# --- Админы ---
raw_admins = os.getenv("ADMIN_IDS", "")
ADMIN_IDS = {int(x.strip()) for x in raw_admins.split(",") if x.strip().isdigit()}


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


# --- FSM регистрация ---
class RegState(StatesGroup):
    waiting_for_fullname = State()
    waiting_for_age = State()


# --- URL'ы ---
GAME_URL = os.getenv("GAME_URL", "https://n0thing67.github.io/APZ-games/").rstrip("/")
ADMIN_URL = os.getenv("ADMIN_URL", os.getenv("WEBAPP_URL", "")).rstrip("/")


def game_keyboard() -> ReplyKeyboardMarkup:
    # Если игра лежит на GitHub Pages, а API (уровни/админка) на Render,
    # передаем базовый URL API параметром ?api=... чтобы механика вкл/выкл игр работала.
    try:
        from urllib.parse import quote
        api_part = f"?api={quote(ADMIN_URL, safe='')}" if ADMIN_URL else ""
    except Exception:
        api_part = f"?api={ADMIN_URL}" if ADMIN_URL else ""

    return ReplyKeyboardMarkup(
        keyboard=[
            [
                KeyboardButton(
                    text="🏭 Зайти на завод (Играть)",
                    web_app=WebAppInfo(url=f"{GAME_URL}/" + api_part),
                )
            ]
        ],
        resize_keyboard=True,
    )


def admin_inline_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🛠 Админ-панель",
                    web_app=WebAppInfo(url=f"{ADMIN_URL}/admin.html"),
                )
            ]
        ]
    )


@router.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()

    user = await get_user(message.from_user.id)
    if user:
        _, first_name, last_name, age, score = user
        await message.answer(
            f"С возвращением, {first_name}! Нажми кнопку ниже, чтобы начать испытание.",
            reply_markup=game_keyboard(),
        )
        return

    await message.answer(
        "Добро пожаловать на АПЗ! Для начала работы, пожалуйста, представьтесь.\n"
        "✍️ Введите *Имя и Фамилию* одним сообщением (через пробел).\n"
        "Пример: Иван Иванов",
        parse_mode="Markdown",
    )
    await state.set_state(RegState.waiting_for_fullname)


@router.message(RegState.waiting_for_fullname)
async def process_fullname(message: types.Message, state: FSMContext):
    text = (message.text or "").strip()
    parts = [p for p in text.split() if p]

    if len(parts) < 2:
        await message.answer(
            "❌ Нужно ввести *Имя и Фамилию* через пробел.\n"
            "Пример: Иван Иванов",
            parse_mode="Markdown",
        )
        return

    first_name = parts[0]
    last_name = " ".join(parts[1:])

    await state.update_data(first_name=first_name, last_name=last_name)
    await message.answer("Сколько вам лет?")
    await state.set_state(RegState.waiting_for_age)


@router.message(RegState.waiting_for_age)
async def process_age(message: types.Message, state: FSMContext):
    if not (message.text or "").isdigit():
        await message.answer("Возраст должен быть числом. Попробуйте еще раз.")
        return

    data = await state.get_data()
    user_id = message.from_user.id
    name = data["first_name"]
    surname = data["last_name"]
    age = int(message.text)

    await register_user(user_id, name, surname, age)
    await state.clear()

    await message.answer(
        f"Регистрация пройдена, {name}! Нажми кнопку ниже, чтобы начать испытание.",
        reply_markup=game_keyboard(),
    )


@router.message(F.web_app_data)
async def handle_web_app_data(message: types.Message):
    try:
        data = json.loads(message.web_app_data.data)
    except Exception:
        await message.answer("⚠️ Не удалось прочитать данные из WebApp.")
        return

    user_id = message.from_user.id

    # 1) Очки за игру (старый формат)
    score_raw = data.get("score", None)
    score = 0
    if score_raw is not None:
        try:
            score = int(score_raw or 0)
        except Exception:
            score = 0

    # 2) Ведущее направление профориентационного теста
    aptitude_top = data.get("aptitude_top") or data.get("aptitudeTop") or None
    if isinstance(aptitude_top, str):
        aptitude_top = aptitude_top.strip() or None

    if aptitude_top is not None:
        await update_aptitude_top(user_id, aptitude_top)

    if score_raw is not None:
        await update_score(user_id, score)

    # Ответ пользователю — без изменения общей механики
    APT_LABEL = {
        "TECH": "🔧 Техническое мышление",
        "LOGIC": "🧩 Логическое мышление",
        "CREATIVE": "🎨 Творческое мышление",
        "HUMAN": "📖 Гуманитарное мышление",
        "SOCIAL": "🤝 Командное мышление",
    }

    if score_raw is not None and aptitude_top is not None:
        await message.answer(
            f"🚀 Результат получен! Твой счёт: {score}.\n"
            f"🧠 Профиль сохранён: {APT_LABEL.get(aptitude_top, aptitude_top)}.\n"
            f"Используй /stats, чтобы посмотреть таблицу лидеров."
        )
    elif score_raw is not None:
        await message.answer(
            f"🚀 Результат получен! Твой счёт: {score}.\n"
            f"Используй /stats, чтобы посмотреть таблицу лидеров."
        )
    elif aptitude_top is not None:
        await message.answer(
            f"🧠 Результат теста сохранён: {APT_LABEL.get(aptitude_top, aptitude_top)}.\n"
            f"Используй /stats, чтобы посмотреть таблицу лидеров."
        )
    else:
        await message.answer("✅ Данные получены.")


# --- Админ-панель ---
@router.message(Command("admin"))
async def cmd_admin(message: types.Message):
    if not is_admin(message.from_user.id):
        await message.answer("⛔️ Нет доступа.")
        return

    if not ADMIN_URL:
        await message.answer(
            "⚠️ Админка не настроена.\n"
            "В Render добавь переменную окружения ADMIN_URL (домен Render)."
        )
        return

    await message.answer(
        "🛠 Открываю админ-панель.\n"
        "Там можно смотреть статистику, удалять пользователей и включать/выключать уровни.",
        reply_markup=admin_inline_keyboard(),
    )


@router.message(Command("stats"))
async def cmd_stats(message: types.Message):
    # Пользователь должен видеть ТОЛЬКО свою статистику.
    tg_id = message.from_user.id

    user = await get_user(tg_id)
    if not user:
        await message.answer(
            "Похоже, ты ещё не зарегистрирован(а).\n"
            "Нажми /start и пройди регистрацию, а потом снова введи /stats."
        )
        return

    _tid, fname, lname, _age, score = user

    # aptitude_top не входит в get_user (сохранён старый формат), поэтому аккуратно читаем отдельно.
    aptitude_top = None
    rank = None
    total = None
    try:
        db = await get_db()
        async with db.execute(
            'SELECT aptitude_top FROM users WHERE telegram_id = ?',
            (tg_id,),
        ) as cur:
            row = await cur.fetchone()
            aptitude_top = row[0] if row else None

        # Место в общем рейтинге (не показываем других пользователей, только позицию)
        async with db.execute(
            'SELECT COUNT(*) FROM users WHERE score > ?',
            (score,),
        ) as cur:
            higher = (await cur.fetchone() or (0,))[0]
        rank = int(higher) + 1

        async with db.execute('SELECT COUNT(*) FROM users') as cur:
            total = (await cur.fetchone() or (0,))[0]
    except Exception:
        # Не ломаем бота, если что-то с БД/миграцией.
        pass

    APT_LABEL = {
        "TECH": "🔧 Техническое мышление",
        "LOGIC": "🧩 Логическое мышление",
        "CREATIVE": "🎨 Творческое мышление",
        "HUMAN": "📖 Гуманитарное мышление",
        "SOCIAL": "🤝 Командное мышление",
    }

    lines = ["📊 **Твоя статистика:**"]
    lines.append(f"👤 {fname} {lname}")
    lines.append(f"⭐ Очки: **{score}**")
    if rank is not None and total is not None and total:
        lines.append(f"🏁 Место в рейтинге: **{rank}** из **{total}**")
    if aptitude_top:
        lines.append(f"🧠 Ведущее направление: **{APT_LABEL.get(aptitude_top, aptitude_top)}**")

    await message.answer("\n".join(lines), parse_mode="Markdown")
