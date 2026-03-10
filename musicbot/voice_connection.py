from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import discord


class VoiceConnectionService:
    def __init__(self, bot: Any) -> None:
        self.bot = bot

    def get_session(self, guild: "discord.Guild") -> Any:
        return self.bot.get_playback_session(guild)

    def sync_state(self, guild: "discord.Guild") -> Any:
        session = self.get_session(guild)
        session.sync_state()
        return session

    async def ensure_connected(
        self,
        channel: Any,
        *,
        reason: str,
        allow_move: bool = True,
    ) -> Any:
        session = self.get_session(channel.guild)
        return await session.ensure_connected(
            channel,
            reason=reason,
            allow_move=allow_move,
        )

    async def ensure_player(
        self,
        channel: Any,
        *,
        create: bool,
        deserialize: bool,
        reason: str,
    ) -> Any:
        session = self.get_session(channel.guild)
        return await session.ensure_player(
            channel,
            create=create,
            deserialize=deserialize,
            reason=reason,
        )

    async def disconnect(
        self,
        guild: "discord.Guild",
        *,
        reason: str,
        force: bool = True,
    ) -> None:
        await self.get_session(guild).teardown(reason=reason, force=force)

    def is_connecting(self, guild: "discord.Guild") -> bool:
        return bool(self.get_session(guild).connecting)
