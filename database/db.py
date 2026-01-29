import aiosqlite
import os
from pathlib import Path

# ==========================================
# ВАЖНО: путь к БД должен быть стабильным
#
# Если использовать относительный путь ("factory.db"), то при разных
# рабочих директориях (например, на хостинге, при запуске web_server)
# SQLite может создать *новый* файл БД, из‑за чего кажется, что бот
# "забыл" пользователей.
#
# 1) Можно явно задать путь через переменную окружения DB_PATH.
# 2) Иначе используем путь относительно корня проекта.
# ==========================================

def _compute_db_path() -> str:
    """Возвращает стабильный путь к БД.

    Цель: чтобы пользователь "не терялся" после полного перезапуска бота.

    - DB_PATH позволяет явно указать место хранения.
    - На Render (и похожих хостингах) часто есть переменная RENDER_DISK_PATH
      для примонтированного диска: если она задана — кладём БД туда.
    - Иначе используем папку data/ в корне проекта, чтобы не зависеть
      от текущей рабочей директории и не путать с "factory.db" из репозитория.

    Важно: мы НИКОГДА не перезаписываем существующую БД.
    Если раньше БД лежала рядом с кодом (./factory.db) и новая ещё не создана,
    то один раз переносим её в data/factory.db.
    """

    env_path = os.getenv("DB_PATH")
    if env_path:
        return env_path

    project_root = Path(__file__).resolve().parents[1]

    # Render persistent disk (если подключён)
    render_disk = os.getenv("RENDER_DISK_PATH")
    if render_disk:
        db_dir = Path(render_disk)
        db_dir.mkdir(parents=True, exist_ok=True)
        return str(db_dir / "factory.db")

    # Локальный/обычный вариант: отдельная папка data/
    db_dir = project_root / "data"
    db_dir.mkdir(parents=True, exist_ok=True)
    target = db_dir / "factory.db"

    # Мягкий перенос со старого места (./factory.db) — только если нужно
    legacy = project_root / "factory.db"
    try:
        if not target.exists() and legacy.exists():
            legacy.replace(target)
    except Exception:
        # Не валим запуск, если перенос не удался (права/FS)
        pass

    return str(target)


DB_NAME = _compute_db_path()

# ==========================================
# PERF: одна shared-connection вместо открытия SQLite на каждый запрос
# ==========================================

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(DB_NAME)
        # чуть более дружелюбные настройки конкурентности
        await _db.execute('PRAGMA journal_mode=WAL;')
        await _db.execute('PRAGMA synchronous=NORMAL;')
        await _db.execute('PRAGMA foreign_keys=ON;')
    return _db


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def create_table():
    """Создаёт таблицы (idempotent) и выполняет мягкую миграцию колонок."""
    db = await get_db()

    # users
    await db.execute(
        '''
        CREATE TABLE IF NOT EXISTS users (
            telegram_id INTEGER PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            age INTEGER,
            score INTEGER DEFAULT 0,
            aptitude_top TEXT
        )
        '''
    )

    # Миграция: если база была создана раньше без aptitude_top — добавим колонку.
    try:
        async with db.execute('PRAGMA table_info(users)') as cur:
            cols = [row[1] for row in await cur.fetchall()]
        if 'aptitude_top' not in cols:
            await db.execute('ALTER TABLE users ADD COLUMN aptitude_top TEXT')
    except Exception:
        # Не валим бота из-за миграции
        pass

    # levels (вкл/выкл)
    await db.execute(
        '''
        CREATE TABLE IF NOT EXISTS levels (
            level_key TEXT PRIMARY KEY,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        '''
    )

    # Инициализация дефолтных уровней (idempotent)
    default_levels = [
        'puzzle-2x2',
        'puzzle-3x3',
        'puzzle-4x4',
        'jumper',
        'factory-2048',
        'quiz',
    ]
    for key in default_levels:
        await db.execute(
            'INSERT OR IGNORE INTO levels (level_key, is_active) VALUES (?, 1)',
            (key,),
        )

    await db.commit()


async def register_user(tg_id, f_name, l_name, age):
    db = await get_db()
    await db.execute(
        '''
        INSERT OR IGNORE INTO users (telegram_id, first_name, last_name, age)
        VALUES (?, ?, ?, ?)
        ''',
        (tg_id, f_name, l_name, age),
    )
    await db.commit()


async def update_score(tg_id, new_score):
    db = await get_db()
    # Обновляем очки, только если новый результат лучше старого
    await db.execute(
        '''
        UPDATE users SET score = ? WHERE telegram_id = ? AND score < ?
        ''',
        (new_score, tg_id, new_score),
    )
    await db.commit()


async def get_top_users():
    db = await get_db()
    async with db.execute(
        'SELECT first_name, last_name, score FROM users ORDER BY score DESC LIMIT 10'
    ) as cursor:
        return await cursor.fetchall()


async def get_user(tg_id: int):
    db = await get_db()
    # Важно: сохраняем прежний формат (5 полей), чтобы не ломать существующую логику.
    async with db.execute(
        'SELECT telegram_id, first_name, last_name, age, score FROM users WHERE telegram_id = ?',
        (tg_id,),
    ) as cursor:
        return await cursor.fetchone()


async def reset_all_scores():
    db = await get_db()
    await db.execute('UPDATE users SET score = 0')
    await db.commit()


async def delete_all_users():
    db = await get_db()
    await db.execute('DELETE FROM users')
    await db.commit()


# =====================
# Admin helpers
# =====================


async def get_all_users(limit: int = 200):
    db = await get_db()
    async with db.execute(
        'SELECT telegram_id, first_name, last_name, age, score FROM users ORDER BY telegram_id ASC LIMIT ?',
        (limit,),
    ) as cursor:
        return await cursor.fetchall()


async def delete_user(tg_id: int) -> None:
    db = await get_db()
    await db.execute('DELETE FROM users WHERE telegram_id = ?', (tg_id,))
    await db.commit()


async def get_levels():
    db = await get_db()
    async with db.execute(
        'SELECT level_key, is_active FROM levels ORDER BY level_key ASC'
    ) as cursor:
        rows = await cursor.fetchall()
    return {k: bool(v) for (k, v) in rows}


async def set_level_active(level_key: str, is_active: bool) -> None:
    db = await get_db()
    await db.execute(
        'INSERT INTO levels (level_key, is_active) VALUES (?, ?) '
        'ON CONFLICT(level_key) DO UPDATE SET is_active = excluded.is_active',
        (level_key, 1 if is_active else 0),
    )
    await db.commit()


async def update_aptitude_top(tg_id: int, aptitude_top: str | None):
    db = await get_db()
    await db.execute(
        'UPDATE users SET aptitude_top = ? WHERE telegram_id = ?',
        (aptitude_top, tg_id),
    )
    await db.commit()


async def get_top_users_stats(limit: int = 10):
    """ТОП для команды /stats: возвращаем также ведущее направление aptitude_top."""
    db = await get_db()
    async with db.execute(
        'SELECT telegram_id, first_name, last_name, score, aptitude_top '
        'FROM users ORDER BY score DESC LIMIT ?',
        (limit,),
    ) as cursor:
        return await cursor.fetchall()
