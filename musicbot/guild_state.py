from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any, Dict, Optional

from .constants import DATA_GUILD_FILE_OPTIONS

if TYPE_CHECKING:
    import discord

    from .constructs import GuildSpecificData

log = logging.getLogger(__name__)


class GuildStateStore:
    SNAPSHOT_VERSION = 1

    def __init__(self, bot: Any) -> None:
        self.bot = bot

    def get_path(self, guild_id: int):
        return self.bot.config.data_path.joinpath(str(guild_id), DATA_GUILD_FILE_OPTIONS)

    async def load(self, guild_data: "GuildSpecificData") -> None:
        if guild_data._loading_lock.locked():
            return

        async with guild_data._loading_lock:
            if guild_data._guild_id == 0:
                guild_data._guild_id = guild_data._lookup_guild_id()
                if guild_data._guild_id == 0:
                    log.error("Cannot load data for guild with ID 0.")
                    return

            opt_file = self.get_path(guild_data._guild_id)
            if not opt_file.is_file():
                guild_data._is_file_loaded = True
                return

            async with guild_data._file_lock:
                try:
                    with open(opt_file, "r", encoding="utf8") as fh:
                        options: Dict[str, Any] = json.load(fh)
                except OSError:
                    log.exception("Could not read guild state file: %s", opt_file)
                    return
                except json.JSONDecodeError:
                    log.exception("Could not decode guild state file: %s", opt_file)
                    return

            guild_data._is_file_loaded = True

            guild_prefix = options.get("command_prefix", None)
            if guild_prefix:
                guild_data._command_prefix = str(guild_prefix)

            guild_playlist = options.get("auto_playlist", None)
            if guild_playlist:
                guild_data.autoplaylist = self.bot.playlist_mgr.get_playlist(str(guild_playlist))
                await guild_data.autoplaylist.load()

            auto_similar_enabled = options.get("auto_similar_enabled", None)
            if isinstance(auto_similar_enabled, bool):
                guild_data.auto_similar_enabled = auto_similar_enabled

            guild = self.bot.get_guild(guild_data._guild_id)
            if guild is None:
                return

            follow_user_id = options.get("follow_user_id", None)
            if follow_user_id:
                guild_data.follow_user = guild.get_member(int(follow_user_id))

            auto_join_channel_id = options.get("auto_join_channel_id", None)
            if auto_join_channel_id:
                channel = self.bot.get_channel(int(auto_join_channel_id))
                if channel is not None:
                    guild_data.auto_join_channel = channel

    async def save(self, guild_data: "GuildSpecificData") -> None:
        if guild_data._guild_id == 0:
            log.error("Cannot save data for guild with ID 0.")
            return

        opt_file = self.get_path(guild_data._guild_id)
        auto_playlist = None
        if guild_data.autoplaylist is not None:
            auto_playlist = guild_data.autoplaylist.filename

        follow_user_id: Optional[int] = None
        if guild_data.follow_user is not None:
            follow_user_id = guild_data.follow_user.id

        auto_join_channel_id: Optional[int] = None
        if guild_data.auto_join_channel is not None:
            auto_join_channel_id = guild_data.auto_join_channel.id

        opt_dict = {
            "version": self.SNAPSHOT_VERSION,
            "command_prefix": guild_data._command_prefix,
            "auto_playlist": auto_playlist,
            "auto_similar_enabled": guild_data.auto_similar_enabled,
            "follow_user_id": follow_user_id,
            "auto_join_channel_id": auto_join_channel_id,
        }

        async with guild_data._file_lock:
            try:
                with open(opt_file, "w", encoding="utf8") as fh:
                    json.dump(opt_dict, fh)
            except OSError:
                log.exception("Could not save guild state to: %s", opt_file)
