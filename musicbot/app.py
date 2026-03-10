from __future__ import annotations

from typing import Any

from .bot import MusicBot


def create_bot(*, use_certifi: bool = False, **kwargs: Any) -> MusicBot:
    return MusicBot(use_certifi=use_certifi, **kwargs)


async def run_bot(bot: MusicBot) -> None:
    await bot.run_musicbot()
