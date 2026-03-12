import logging
from enum import Enum
from typing import TYPE_CHECKING, Optional

import discord

from .voice_transport import VoiceTransport, is_voice_transport

if TYPE_CHECKING:
    from .bot import MusicBot, VoiceableChannel
    from .player import MusicPlayer

log = logging.getLogger(__name__)


class PlaybackMode(str, Enum):
    DOWNLOAD = "download"
    STREAM = "stream"
    LOCAL = "local"


class GuildSession:
    def __init__(self, bot: "MusicBot", guild_id: int) -> None:
        self.bot: "MusicBot" = bot
        self.guild_id: int = guild_id
        self.player: Optional["MusicPlayer"] = None
        self.voice_client: Optional[VoiceTransport] = None
        self.channel_id: Optional[int] = None
        self.connect_generation: int = 0
        self.connecting: bool = False
        self.connect_reason: str = ""
        self.last_disconnect_reason: str = ""
        self.resume_pending: bool = False

    @property
    def guild(self) -> Optional[discord.Guild]:
        return self.bot.get_guild(self.guild_id)

    def sync_state(self) -> None:
        guild = self.guild
        player = self.bot.players.get(self.guild_id)
        voice_client: Optional[VoiceTransport] = None

        if guild is not None:
            for candidate in self.bot._collect_guild_voice_clients(guild):
                if is_voice_transport(candidate) and candidate.is_connected():
                    voice_client = candidate
                    break

            managed_voice_client = self.bot._get_managed_voice_client(guild)
            if voice_client is None and is_voice_transport(managed_voice_client):
                voice_client = managed_voice_client

        if voice_client is None and guild is not None and is_voice_transport(guild.voice_client):
            voice_client = guild.voice_client

        if (
            voice_client is None
            and player is not None
            and is_voice_transport(player.voice_client)
        ):
            voice_client = player.voice_client

        self.player = player
        self.voice_client = voice_client

        if voice_client and getattr(voice_client, "channel", None) is not None:
            self.channel_id = voice_client.channel.id

        if player and voice_client and player.voice_client is not voice_client:
            log.debug(
                "Syncing MusicPlayer voice client reference for guild %s.",
                self.guild_id,
            )
            player.voice_client = voice_client

    async def ensure_connected(
        self,
        channel: "VoiceableChannel",
        *,
        reason: str,
        allow_move: bool = True,
    ) -> VoiceTransport:
        self.sync_state()
        voice_client = await self.bot._connect_voice_client(
            channel,
            session=self,
            reason=reason,
            allow_move=allow_move,
        )
        self.voice_client = voice_client
        self.channel_id = channel.id
        self.connect_generation += 1
        return voice_client

    async def ensure_player(
        self,
        channel: "VoiceableChannel",
        *,
        create: bool,
        deserialize: bool,
        reason: str,
    ) -> "MusicPlayer":
        self.sync_state()
        player = await self.bot._ensure_player(
            channel,
            create=create,
            deserialize=deserialize,
            reason=reason,
            session=self,
        )
        self.player = player
        self.resume_pending = deserialize
        self.sync_state()
        return player

    async def teardown(self, *, reason: str, force: bool = True) -> None:
        guild = self.guild
        self.last_disconnect_reason = reason
        self.resume_pending = False
        if guild is None:
            self.player = None
            self.voice_client = None
            return

        await self.bot._disconnect_voice_client(
            guild,
            session=self,
            reason=reason,
            force=force,
        )
        self.sync_state()


GuildPlaybackSession = GuildSession
