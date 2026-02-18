"""Unified entrypoint.

Why:
* On hosting (e.g., Render) it's easy to accidentally run the Telegram entrypoint
  while only MAX_BOT_TOKEN is configured, or vice-versa.
* This file chooses the correct bot at runtime based on environment variables.

It does NOT change any game logic.
"""

import asyncio
import os


def _has_value(name: str) -> bool:
    return bool((os.getenv(name) or "").strip())


def main() -> None:
    # Prefer MAX if both tokens are present.
    if _has_value("MAX_BOT_TOKEN"):
        from max_bot import main as max_main  # noqa: WPS433

        asyncio.run(max_main())
        return

    if _has_value("BOT_TOKEN"):
        from bot import main as tg_main  # noqa: WPS433

        asyncio.run(tg_main())
        return

    raise RuntimeError(
        "No bot token found. Set MAX_BOT_TOKEN for MAX or BOT_TOKEN for Telegram."
    )


if __name__ == "__main__":
    main()
