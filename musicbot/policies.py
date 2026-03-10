from __future__ import annotations

import logging
import random
import re
from typing import TYPE_CHECKING, Any, List, Optional, Set

import yt_dlp as youtube_dl  # type: ignore[import-untyped]

from . import exceptions

if TYPE_CHECKING:
    from .playlist import EntryTypes

log = logging.getLogger(__name__)


class QueueEmptyPolicyService:
    def __init__(self, bot: Any, download_manager: Any, coordinator: Any) -> None:
        self.bot = bot
        self.download_manager = download_manager
        self.coordinator = coordinator

    async def handle(self, player: Any, entry: "EntryTypes") -> None:
        guild = player.voice_client.guild
        server_state = self.bot.server_data[guild.id]

        if player.is_dead:
            return

        if player.playlist.entries and (not player.current_entry or player.is_stopped):
            await self.coordinator.start_if_needed(player)
            return

        if player.playlist.entries or player.current_entry:
            return

        if self.bot.config.leave_after_queue_empty:
            log.info("Queue-empty policy is leave-first. Disconnecting from guild %s", guild.id)
            await self.bot.disconnect_voice_client(guild)
            return

        if self.bot.config.auto_playlist:
            await self._refill_from_autoplay(player)

        if (
            not player.playlist.entries
            and not player.current_entry
            and entry
            and getattr(entry, "url", None)
            and server_state.auto_similar_enabled
            and self.bot.config.auto_similar
        ):
            await self._refill_from_autosimilar(player, entry)

        await self.bot.serialize_queue(guild)

        if player.playlist.entries and (not player.current_entry or player.is_stopped):
            await self.coordinator.start_if_needed(player)
            return

        if not player.playlist.entries and not player.current_entry:
            log.info("Queue is empty after queue-empty policies. Playback stays stopped in guild %s", guild.id)

    async def _refill_from_autoplay(self, player: Any) -> None:
        guild = player.voice_client.guild
        if not player.autoplaylist:
            if not self.bot.server_data[guild.id].autoplaylist:
                log.warning("No playable songs in the guild autoplaylist, disabling.")
                self.bot.config.auto_playlist = False
                return
            player.autoplaylist = list(self.bot.server_data[guild.id].autoplaylist)

        while player.autoplaylist:
            if self.bot.config.auto_playlist_random:
                random.shuffle(player.autoplaylist)
                song_url = random.choice(player.autoplaylist)
            else:
                song_url = player.autoplaylist[0]
            player.autoplaylist.remove(song_url)

            if (
                self.bot.config.song_blocklist_enabled
                and self.bot.config.song_blocklist.is_blocked(song_url)
            ):
                if self.bot.config.auto_playlist_remove_on_block:
                    await self.bot.server_data[guild.id].autoplaylist.remove_track(
                        song_url,
                        ex=UserWarning("Found in song block list."),
                        delete_from_ap=True,
                    )
                continue

            try:
                info = await self.download_manager.extract_info(
                    song_url,
                    download=False,
                    process=True,
                )
            except youtube_dl.utils.DownloadError as exc:
                log.error('Error while downloading song "%s": %s', song_url, exc)
                await self.bot.server_data[guild.id].autoplaylist.remove_track(
                    song_url,
                    ex=exc,
                    delete_from_ap=self.bot.config.remove_ap,
                )
                continue
            except (exceptions.ExtractionError, youtube_dl.utils.YoutubeDLError) as exc:
                log.error('Error extracting song "%s": %s', song_url, exc, exc_info=True)
                await self.bot.server_data[guild.id].autoplaylist.remove_track(
                    song_url,
                    ex=exc,
                    delete_from_ap=self.bot.config.remove_ap,
                )
                continue
            except exceptions.MusicbotException:
                log.exception("MusicBot needs to stop autoplaylist extraction and bail.")
                return
            except Exception:
                log.exception("MusicBot got an unhandled exception in autoplay queue policy.")
                return

            if info.has_entries:
                entries = info.get_entries_objects()
                player.autoplaylist = [playlist_entry.url for playlist_entry in entries] + player.autoplaylist
                continue

            try:
                await player.playlist.add_entry_from_info(
                    info,
                    channel=None,
                    author=None,
                    head=False,
                )
            except (exceptions.ExtractionError, exceptions.WrongEntryTypeError) as exc:
                log.error("Error adding song from autoplaylist: %s", exc)
                log.debug("Exception data for above error:", exc_info=True)
                continue
            break

        if not self.bot.server_data[guild.id].autoplaylist:
            log.warning("No playable songs in the autoplaylist, disabling.")
            self.bot.config.auto_playlist = False

    async def _refill_from_autosimilar(self, player: Any, entry: "EntryTypes") -> None:
        guild = player.voice_client.guild
        server_state = self.bot.server_data[guild.id]
        video_id = self._extract_youtube_video_id(getattr(entry, "url", ""))
        if not video_id:
            log.debug("Could not extract video ID from URL: %s", getattr(entry, "url", ""))
            return

        mix_url = f"https://www.youtube.com/watch?v={video_id}&list=RD{video_id}"
        log.info("Fetching similar songs from YouTube Mix: %s", mix_url)

        try:
            info = await self.download_manager.extract_info(mix_url, download=False, process=True)
        except Exception as exc:
            log.error("Error fetching similar songs from YouTube Mix: %s", exc)
            log.debug("Exception details:", exc_info=True)
            return

        if not info.has_entries:
            log.warning("YouTube Mix returned no entries")
            return

        entries = info.get_entries_objects()
        original_language = self._detect_language(getattr(entry, "title", "") or "")
        seen_url_keys: Set[str] = set()
        seen_video_ids: Set[str] = set()

        def register_url(url: Optional[str]) -> None:
            if isinstance(url, str) and url:
                seen_url_keys.add(url.lower())

        def register_info(info_obj: Any) -> None:
            if not info_obj:
                return
            register_url(getattr(info_obj, "url", None))
            register_url(getattr(info_obj, "webpage_url", None))
            register_url(getattr(info_obj, "original_url", None))
            video = getattr(info_obj, "video_id", None)
            if video:
                seen_video_ids.add(video.lower())

        register_url(getattr(entry, "url", None))
        register_info(getattr(entry, "info", None))
        for queued_entry in player.playlist.entries:
            register_url(getattr(queued_entry, "url", None))
            register_info(getattr(queued_entry, "info", None))
        if player.current_entry:
            register_url(getattr(player.current_entry, "url", None))
            register_info(getattr(player.current_entry, "info", None))
        register_url(server_state.last_played_song_subject)
        register_url(server_state.current_playing_url)
        for history_item in server_state.auto_similar_history:
            register_url(history_item)

        same_language_entries = []
        other_language_entries = []
        for similar_entry in entries:
            candidate_language = self._detect_language(getattr(similar_entry, "title", "") or "")
            if original_language in {"korean", "japanese", "chinese"}:
                if candidate_language == original_language:
                    same_language_entries.append(similar_entry)
                else:
                    other_language_entries.append(similar_entry)
            else:
                same_language_entries.append(similar_entry)

        random.shuffle(same_language_entries)
        random.shuffle(other_language_entries)
        prioritized_entries = (
            same_language_entries + other_language_entries[:3]
            if len(same_language_entries) >= 7
            else same_language_entries + other_language_entries
        )

        added_count = 0
        for similar_entry in prioritized_entries:
            if added_count >= 10:
                break

            candidate_url = similar_entry.get_playable_url()
            candidate_video_id = similar_entry.video_id.lower() if similar_entry.video_id else ""
            candidate_urls = {
                candidate_url,
                similar_entry.url,
                similar_entry.webpage_url,
                similar_entry.original_url,
            }

            if candidate_video_id and candidate_video_id in seen_video_ids:
                continue
            if any(
                isinstance(url, str) and url and url.lower() in seen_url_keys
                for url in candidate_urls
            ):
                continue

            try:
                if not hasattr(similar_entry, "data"):
                    similar_entry.data = {}
                similar_entry.data["__from_autosimilar"] = True
                await player.playlist.add_entry_from_info(
                    similar_entry,
                    channel=None,
                    author=None,
                    head=False,
                )
            except Exception as exc:
                log.warning("Failed to add similar song: %s", exc)
                continue

            history_key = candidate_video_id or candidate_url or similar_entry.title or ""
            if history_key:
                server_state.auto_similar_history.append(history_key)
            if candidate_video_id:
                seen_video_ids.add(candidate_video_id)
            for url in candidate_urls:
                if isinstance(url, str) and url:
                    seen_url_keys.add(url.lower())
            added_count += 1

        if added_count and getattr(self.bot, "guild_state_store", None):
            await self.bot.guild_state_store.save(server_state)

        log.info("Added %d similar songs to the queue", added_count)

    def _extract_youtube_video_id(self, url: str) -> Optional[str]:
        if "youtube.com/watch?v=" in url:
            return url.split("watch?v=")[1].split("&")[0]
        if "youtu.be/" in url:
            return url.split("youtu.be/")[1].split("?")[0]
        return None

    def _detect_language(self, text: str) -> str:
        has_korean = bool(re.search(r"[가-힣]", text))
        has_japanese = bool(re.search(r"[ぁ-んァ-ン]", text))
        has_chinese = bool(re.search(r"[\u4e00-\u9fff]", text))
        if has_korean:
            return "korean"
        if has_japanese:
            return "japanese"
        if has_chinese:
            return "chinese"
        return "other"
