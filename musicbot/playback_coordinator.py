from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from .models import PlaybackRequest
from .playback import PlaybackMode
from .player_engine import PlayerEngine

if TYPE_CHECKING:
    import discord


class PlaybackCoordinator:
    def __init__(self, bot: Any, voice_connection: Any, media_resolver: Any) -> None:
        self.bot = bot
        self.voice_connection = voice_connection
        self.media_resolver = media_resolver

    def get_engine(self, player: Any) -> PlayerEngine:
        return PlayerEngine(player)

    async def enqueue_request(
        self,
        request: PlaybackRequest,
        *,
        channel: Any,
        guild: "discord.Guild",
        author: "discord.Member",
        permissions: Any,
    ) -> Any:
        if request.playback_mode == PlaybackMode.STREAM:
            return await self.bot.cmd_stream(
                self.bot.get_player_in(guild),
                channel,
                guild,
                author,
                permissions,
                None,
                request.query,
            )

        return await self.bot.cmd_play(
            None,
            self.bot.get_player_in(guild),
            channel,
            guild,
            author,
            permissions,
            [],
            request.query,
        )

    async def summon(self, guild: "discord.Guild", author: "discord.Member") -> Any:
        return await self.bot.cmd_summon(guild, author, None)

    async def disconnect(self, guild: "discord.Guild") -> Any:
        return await self.bot.cmd_disconnect(guild)

    async def ensure_member_player(
        self,
        member: "discord.Member",
        *,
        create: bool = False,
        deserialize: bool = False,
        reason: str,
    ) -> Any:
        if not member.voice or not member.voice.channel:
            raise RuntimeError("Member is not connected to a voice channel.")
        return await self.voice_connection.ensure_player(
            member.voice.channel,
            create=create,
            deserialize=deserialize,
            reason=reason,
        )

    async def start_if_needed(self, player: Any) -> None:
        if player.is_dead:
            return
        if player.playlist.entries and (not player.current_entry or player.is_stopped):
            self.get_engine(player).play(continue_playback=not player.is_stopped)

    async def autoplaylist(self, guild: "discord.Guild", author: "discord.Member", option: str, value: str = "") -> Any:
        return await self.bot.cmd_autoplaylist(
            guild,
            author,
            self.bot.get_player_in(guild),
            option,
            value,
        )

    async def autosimilar(self, guild: "discord.Guild", value: str = "") -> Any:
        return await self.bot.cmd_autosimilar(guild, value)
