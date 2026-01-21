import aiosqlite

DB_NAME = 'factory.db'

# ==========================================
# PERF: одна shared-connection вместо открытия SQLite на каждый запрос
#
# На мобильных/слабых VPS частое открытие/закрытие соединения к SQLite
# создаёт лишнюю задержку и повышает риск "database is locked".
#
# Механику не меняем: интерфейс функций остаётся тем же.
# ==========================================

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(DB_NAME)
        # Чуть более дружелюбные настройки конкурентности
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
    db = await get_db()
    await db.execute('''
        CREATE TABLE IF NOT EXISTS users (
            telegram_id INTEGER PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            age INTEGER,
            score INTEGER DEFAULT 0,
            aptitude_top TEXT
        )
    ''')

# Миграция: если база создана ранее — добавим колонку aptitude_top (ведущее направление теста)
try:
    async with db.execute("PRAGMA table_info(users)") as cur:
        cols = [row[1] for row in await cur.fetchall()]
    if "aptitude_top" not in cols:
        await db.execute("ALTER TABLE users ADD COLUMN aptitude_top TEXT")
except Exception:
    # Не падаем: если ALTER невозможен по какой-то причине — просто пропустим
    pass


    # Уровни (вкл/выкл). Храним флаги доступности, чтобы админ мог временно отключать уровни.
    await db.execute('''
        CREATE TABLE IF NOT EXISTS levels (
            level_key TEXT PRIMARY KEY,
            is_active INTEGER NOT NULL DEFAULT 1
        )
    ''')

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
    await db.execute('''
        INSERT OR IGNORE INTO users (telegram_id, first_name, last_name, age)
        VALUES (?, ?, ?, ?)
    ''', (tg_id, f_name, l_name, age))
    await db.commit()


async def update_score(tg_id, new_score):
    db = await get_db()
    # Обновляем очки, только если новый результат лучше старого
    await db.execute('''
        UPDATE users SET score = ? WHERE telegram_id = ? AND score < ?
    ''', (new_score, tg_id, new_score))
    await db.commit()


async def get_top_users():
    db = await get_db()
    async with db.execute(
        'SELECT first_name, last_name, score FROM users ORDER BY score DESC LIMIT 10'
    ) as cursor:
        return await cursor.fetchall()


async def get_user(tg_id: int):
    db = await get_db()
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
    # нормализуем в dict
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
    await db.execute('UPDATE users SET aptitude_top = ? WHERE telegram_id = ?', (aptitude_top, tg_id))
    await db.commit()


async def get_top_users_stats(limit: int = 10):
    """ТОП для команды /stats: возвращаем также ведущее направление aptitude_top."""
    db = await get_db()
    async with db.execute(
        'SELECT telegram_id, first_name, last_name, score, aptitude_top FROM users ORDER BY score DESC LIMIT ?',
        (limit,),
    ) as cursor:
        return await cursor.fetchall()
