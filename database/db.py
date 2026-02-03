import os
import time
from pathlib import Path

# Поддерживаем ДВА режима:
# 1) PostgreSQL (рекомендуется) — если задана переменная окружения DATABASE_URL.
#    Это даёт сохранность данных между полными перезапусками (в т.ч. на хостинге с эфемерной FS).
# 2) SQLite (fallback) — если DATABASE_URL не задана. Нужен для локальной разработки/совместимости.

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
_using_postgres = DATABASE_URL.lower().startswith(("postgres://", "postgresql://"))

# -------------------------
# SQLite (fallback)
# -------------------------
if not _using_postgres:
    import aiosqlite  # type: ignore

    def _compute_db_path() -> str:
        """Возвращает стабильный путь к SQLite-БД (fallback)."""
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
            pass

        return str(target)

    DB_NAME = _compute_db_path()

    _db: aiosqlite.Connection | None = None

    async def get_db() -> aiosqlite.Connection:
        global _db
        if _db is None:
            _db = await aiosqlite.connect(DB_NAME)
            await _db.execute("PRAGMA journal_mode=WAL;")
            await _db.execute("PRAGMA synchronous=NORMAL;")
            await _db.execute("PRAGMA foreign_keys=ON;")
        return _db

    async def close_db() -> None:
        global _db
        if _db is not None:
            await _db.close()
            _db = None

    async def create_table():
        db = await get_db()

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
            async with db.execute("PRAGMA table_info(users)") as cur:
                cols = [row[1] for row in await cur.fetchall()]
            if "aptitude_top" not in cols:
                await db.execute("ALTER TABLE users ADD COLUMN aptitude_top TEXT")
        except Exception:
            pass

        await db.execute(
            '''
            CREATE TABLE IF NOT EXISTS levels (
                level_key TEXT PRIMARY KEY,
                is_active INTEGER NOT NULL DEFAULT 1
            )
            '''
        )

        default_levels = [
            "puzzle-2x2",
            "puzzle-3x3",
            "puzzle-4x4",
            "jumper",
            "factory-2048",
            "quiz",
        ]
        for key in default_levels:
            await db.execute(
                "INSERT OR IGNORE INTO levels (level_key, is_active) VALUES (?, 1)",
                (key,),
            )

        
        # Глобальная "метка сброса" (нужна, чтобы WebApp мог понять, что админ сбросил статистику,
        # и очистить localStorage со старыми очками/рекомендациями).
        await db.execute(
            '''
            CREATE TABLE IF NOT EXISTS app_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            '''
        )
        await db.execute(
            "INSERT OR IGNORE INTO app_meta(key, value) VALUES('stats_reset_token', '0')"
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
            "SELECT first_name, last_name, score FROM users ORDER BY score DESC LIMIT 10"
        ) as cursor:
            return await cursor.fetchall()

    async def get_user(tg_id: int):
        db = await get_db()
        async with db.execute(
            "SELECT telegram_id, first_name, last_name, age, score FROM users WHERE telegram_id = ?",
            (tg_id,),
        ) as cursor:
            return await cursor.fetchone()

    async def get_user_profile(tg_id: int):
        """Расширенные данные пользователя для webapp (в т.ч. результат профтеста)."""
        db = await get_db()
        async with db.execute(
            "SELECT telegram_id, first_name, last_name, age, score, aptitude_top FROM users WHERE telegram_id = ?",
            (tg_id,),
        ) as cursor:
            return await cursor.fetchone()

    async def get_stats_reset_token() -> str:
        db = await get_db()
        try:
            async with db.execute(
                "SELECT value FROM app_meta WHERE key = ?",
                ("stats_reset_token",),
            ) as cur:
                row = await cur.fetchone()
            return str(row[0]) if row and row[0] is not None else "0"
        except Exception:
            return "0"



    async def reset_all_scores():
        db = await get_db()
        # Сбрасываем общие очки и результат профтеста (игра "Что тебе больше подходит").
        # Иначе после сброса статистики в админке у пользователя может оставаться aptitude_top.
        await db.execute("UPDATE users SET score = 0, aptitude_top = NULL")
        # обновляем глобальную метку сброса
        await db.execute("UPDATE app_meta SET value = ? WHERE key = 'stats_reset_token'", (str(int(time.time())),))
        await db.commit()

    async def delete_all_users():
        db = await get_db()
        await db.execute("DELETE FROM users")
        await db.commit()

    # Admin helpers
    async def get_all_users(limit: int = 200):
        db = await get_db()
        async with db.execute(
            "SELECT telegram_id, first_name, last_name, age, score FROM users ORDER BY telegram_id ASC LIMIT ?",
            (limit,),
        ) as cursor:
            return await cursor.fetchall()

    async def delete_user(tg_id: int) -> None:
        db = await get_db()
        await db.execute("DELETE FROM users WHERE telegram_id = ?", (tg_id,))
        await db.commit()

    async def get_levels():
        db = await get_db()
        async with db.execute(
            "SELECT level_key, is_active FROM levels ORDER BY level_key ASC"
        ) as cursor:
            rows = await cursor.fetchall()
        return {k: bool(v) for (k, v) in rows}

    async def set_level_active(level_key: str, is_active: bool) -> None:
        db = await get_db()
        await db.execute(
            "INSERT INTO levels (level_key, is_active) VALUES (?, ?) "
            "ON CONFLICT(level_key) DO UPDATE SET is_active = excluded.is_active",
            (level_key, 1 if is_active else 0),
        )
        await db.commit()

    async def update_aptitude_top(tg_id: int, aptitude_top: str | None):
        db = await get_db()
        await db.execute(
            "UPDATE users SET aptitude_top = ? WHERE telegram_id = ?",
            (aptitude_top, tg_id),
        )
        await db.commit()

    async def get_top_users_stats(limit: int = 10):
        db = await get_db()
        async with db.execute(
            "SELECT telegram_id, first_name, last_name, score, aptitude_top "
            "FROM users ORDER BY score DESC LIMIT ?",
            (limit,),
        ) as cursor:
            return await cursor.fetchall()

# -------------------------
# PostgreSQL (persistent)
# -------------------------
else:
    import asyncpg  # type: ignore
    import ssl
    import urllib.parse
    import certifi

    _pool: asyncpg.Pool | None = None

    def _parse_sslmode(dsn: str) -> str:
        """Возвращает sslmode из DSN (как в libpq) либо пустую строку."""
        try:
            u = urllib.parse.urlparse(dsn)
            q = urllib.parse.parse_qs(u.query)
            return (q.get("sslmode", [""])[0] or "").lower()
        except Exception:
            return ""

    def _make_ssl_ctx(dsn: str):
        """Создаёт SSL context для asyncpg с поведением, похожим на libpq.

        - sslmode=require  -> TLS без проверки сертификата (иначе Supabase pooler на некоторых средах падает)
        - sslmode=verify-* -> TLS с проверкой (используем CA из certifi)
        - если sslmode не задан, но хост удалённый -> включаем TLS (без проверки)
        """
        try:
            u = urllib.parse.urlparse(dsn)
            host = (u.hostname or "").lower()
        except Exception:
            host = ""

        sslmode = _parse_sslmode(dsn)
        if sslmode in {"verify-ca", "verify-full"}:
            return ssl.create_default_context(cafile=certifi.where())

        # 'require' и дефолт для удалённых хостов — TLS без verify.
        if sslmode == "require" or (sslmode == "" and host and host not in {"localhost", "127.0.0.1"}):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx

        return None

    async def get_db() -> asyncpg.Pool:
        global _pool
        if _pool is None:
            ssl_ctx = _make_ssl_ctx(DATABASE_URL)
            _pool = await asyncpg.create_pool(
                dsn=DATABASE_URL,
                ssl=ssl_ctx,
                min_size=1,
                max_size=5,
            )
        return _pool

    async def close_db() -> None:
        global _pool
        if _pool is not None:
            await _pool.close()
            _pool = None

    async def create_table():
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS users (
                    telegram_id BIGINT PRIMARY KEY,
                    first_name TEXT,
                    last_name TEXT,
                    age INTEGER,
                    score INTEGER DEFAULT 0,
                    aptitude_top TEXT
                );
                '''
            )
            await conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS levels (
                    level_key TEXT PRIMARY KEY,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE
                );
                '''
            )

            
            # Глобальная "метка сброса" (нужна, чтобы WebApp мог понять, что админ сбросил статистику,
            # и очистить localStorage со старыми очками/рекомендациями).
            await conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS app_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
                '''
            )
            await conn.execute(
                "INSERT INTO app_meta(key, value) VALUES('stats_reset_token', '0') ON CONFLICT (key) DO NOTHING"
            )

            default_levels = [
                "puzzle-2x2",
                "puzzle-3x3",
                "puzzle-4x4",
                "jumper",
                "factory-2048",
                "quiz",
            ]
            for key in default_levels:
                await conn.execute(
                    "INSERT INTO levels (level_key, is_active) VALUES ($1, TRUE) "
                    "ON CONFLICT (level_key) DO NOTHING",
                    key,
                )

    async def register_user(tg_id, f_name, l_name, age):
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                '''
                INSERT INTO users (telegram_id, first_name, last_name, age)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (telegram_id) DO NOTHING
                ''',
                int(tg_id), f_name, l_name, age,
            )

    async def update_score(tg_id, new_score):
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE users SET score = $1 WHERE telegram_id = $2 AND score < $1",
                int(new_score), int(tg_id),
            )

    async def get_top_users():
        pool = await get_db()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT first_name, last_name, score FROM users ORDER BY score DESC LIMIT 10"
            )
        return [(r["first_name"], r["last_name"], r["score"]) for r in rows]

    async def get_user(tg_id: int):
        pool = await get_db()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT telegram_id, first_name, last_name, age, score FROM users WHERE telegram_id = $1",
                int(tg_id),
            )
        if row is None:
            return None
        return (row["telegram_id"], row["first_name"], row["last_name"], row["age"], row["score"])

    async def get_user_profile(tg_id: int):
        """Расширенные данные пользователя для webapp (в т.ч. результат профтеста)."""
        pool = await get_db()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT telegram_id, first_name, last_name, age, score, aptitude_top FROM users WHERE telegram_id = $1",
                int(tg_id),
            )
        if row is None:
            return None
        return (
            row["telegram_id"],
            row["first_name"],
            row["last_name"],
            row["age"],
            row["score"],
            row.get("aptitude_top"),
        )

    async def get_stats_reset_token() -> str:
        pool = await get_db()
        async with pool.acquire() as conn:
            # На старых БД таблицы app_meta может не быть. Делаем функцию устойчивой,
            # чтобы админка не падала 500-ой.
            try:
                row = await conn.fetchrow("SELECT value FROM app_meta WHERE key = 'stats_reset_token'")
            except Exception:
                await conn.execute(
                    "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);"
                )
                await conn.execute(
                    "INSERT INTO app_meta(key, value) VALUES('stats_reset_token', '0') ON CONFLICT (key) DO NOTHING"
                )
                row = await conn.fetchrow("SELECT value FROM app_meta WHERE key = 'stats_reset_token'")
        return str(row["value"]) if row and row["value"] is not None else "0"


    async def reset_all_scores():
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute("UPDATE users SET score = 0, aptitude_top = NULL")
            # Таблица app_meta может отсутствовать (если проект обновляли поверх старой БД)
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);"
            )
            await conn.execute(
                "INSERT INTO app_meta(key, value) VALUES('stats_reset_token', '0') ON CONFLICT (key) DO NOTHING"
            )
            await conn.execute(
                "UPDATE app_meta SET value = $1 WHERE key = 'stats_reset_token'",
                str(int(time.time())),
            )

    async def delete_all_users():
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM users")

    async def get_all_users(limit: int = 200):
        pool = await get_db()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT telegram_id, first_name, last_name, age, score "
                "FROM users ORDER BY telegram_id ASC LIMIT $1",
                int(limit),
            )
        return [(r["telegram_id"], r["first_name"], r["last_name"], r["age"], r["score"]) for r in rows]

    async def delete_user(tg_id: int) -> None:
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM users WHERE telegram_id = $1", int(tg_id))

    async def get_levels():
        pool = await get_db()
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT level_key, is_active FROM levels ORDER BY level_key ASC")
        return {r["level_key"]: bool(r["is_active"]) for r in rows}

    async def set_level_active(level_key: str, is_active: bool) -> None:
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO levels (level_key, is_active) VALUES ($1, $2) "
                "ON CONFLICT (level_key) DO UPDATE SET is_active = EXCLUDED.is_active",
                level_key, bool(is_active),
            )

    async def update_aptitude_top(tg_id: int, aptitude_top: str | None):
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE users SET aptitude_top = $1 WHERE telegram_id = $2",
                aptitude_top, int(tg_id),
            )

    async def get_top_users_stats(limit: int = 10):
        pool = await get_db()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT telegram_id, first_name, last_name, score, aptitude_top "
                "FROM users ORDER BY score DESC LIMIT $1",
                int(limit),
            )
        return [
            (r["telegram_id"], r["first_name"], r["last_name"], r["score"], r["aptitude_top"])
            for r in rows
        ]
