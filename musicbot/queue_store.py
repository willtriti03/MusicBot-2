from __future__ import annotations

import json
import logging
import time
from typing import TYPE_CHECKING, Any, List, Optional

from .constants import DATA_GUILD_FILE_QUEUE
from .models import QueueEntrySnapshot, QueueSnapshot

if TYPE_CHECKING:
    import discord

    from .player import MusicPlayer
    from .playlist import Playlist

log = logging.getLogger(__name__)


class QueueStore:
    SNAPSHOT_VERSION = 1

    def __init__(self, bot: Any) -> None:
        self.bot = bot

    def _path_for_guild(self, guild_id: int):
        return self.bot.config.data_path.joinpath(str(guild_id), DATA_GUILD_FILE_QUEUE)

    def _entry_snapshot(self, entry: Any) -> QueueEntrySnapshot:
        playback_mode = getattr(getattr(entry, "playback_mode", None), "value", "download")
        playback_speed = getattr(entry, "playback_speed", 1.0)
        return QueueEntrySnapshot(
            title=str(getattr(entry, "title", "")),
            url=str(getattr(entry, "url", "")),
            playback_mode=str(playback_mode),
            filename=str(getattr(entry, "filename", "")),
            downloaded=bool(getattr(entry, "is_downloaded", False)),
            start_time=float(getattr(entry, "start_time", 0.0) or 0.0),
            playback_speed=float(playback_speed or 1.0),
        )

    def build_snapshot(self, guild_id: int, player: "MusicPlayer") -> QueueSnapshot:
        current_entry = player.current_entry
        entries: List[QueueEntrySnapshot] = [
            self._entry_snapshot(entry) for entry in player.playlist.entries
        ]
        return QueueSnapshot(
            version=self.SNAPSHOT_VERSION,
            guild_id=guild_id,
            serialized_at=time.time(),
            current_entry=self._entry_snapshot(current_entry) if current_entry else None,
            entries=entries,
            legacy_player_json=player.serialize(sort_keys=True),
        )

    async def save(self, guild: "discord.Guild", player: Optional["MusicPlayer"]) -> None:
        if not self.bot.config.persistent_queue or not player:
            return

        path = self._path_for_guild(guild.id)
        snapshot = self.build_snapshot(guild.id, player)
        async with self.bot.aiolocks["queue_serialization:" + str(guild.id)]:
            with open(path, "w", encoding="utf8") as fh:
                json.dump(snapshot.to_dict(), fh, ensure_ascii=True, sort_keys=True)

    async def load(
        self,
        guild: "discord.Guild",
        voice_client: Any,
        playlist: Optional["Playlist"] = None,
    ) -> Optional["MusicPlayer"]:
        if not self.bot.config.persistent_queue:
            return None

        path = self._path_for_guild(guild.id)
        async with self.bot.aiolocks["queue_serialization:" + str(guild.id)]:
            if not path.is_file():
                return None

            with open(path, "r", encoding="utf8") as fh:
                raw_data = fh.read()

        try:
            decoded = json.loads(raw_data)
        except json.JSONDecodeError:
            decoded = None

        if isinstance(decoded, dict) and "legacy_player_json" in decoded:
            snapshot = QueueSnapshot.from_dict(decoded)
            raw_player_json = snapshot.legacy_player_json
        else:
            raw_player_json = raw_data

        from .player import MusicPlayer
        from .playlist import Playlist

        if playlist is None:
            playlist = Playlist(self.bot)

        player = MusicPlayer.from_json(raw_player_json, self.bot, voice_client, playlist)
        if player is None:
            log.warning("QueueStore could not deserialize player for guild %s", guild.id)
        return player
