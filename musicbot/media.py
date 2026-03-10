from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

from .models import PlaybackRequest, VoiceIntent
from .playback import PlaybackMode

if TYPE_CHECKING:
    from .downloader import Downloader, YtdlpResponseDict


class DownloadManager:
    def __init__(self, downloader: "Downloader") -> None:
        self.downloader = downloader

    async def extract_info(self, song_subject: str, *args: Any, **kwargs: Any) -> "YtdlpResponseDict":
        return await self.downloader.extract_info(song_subject, *args, **kwargs)

    async def get_url_headers(self, url: str) -> Dict[str, str]:
        return await self.downloader.get_url_headers(url)

    def get_url_or_none(self, url: str) -> Optional[str]:
        return self.downloader.get_url_or_none(url)


class MediaResolver:
    def __init__(self, download_manager: DownloadManager) -> None:
        self.download_manager = download_manager

    def build_request(
        self,
        query: str,
        *,
        playback_mode: PlaybackMode,
        guild_id: int,
        channel_id: int,
        author_id: int,
        head: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> PlaybackRequest:
        return PlaybackRequest(
            query=query.strip(),
            playback_mode=playback_mode,
            guild_id=guild_id,
            channel_id=channel_id,
            author_id=author_id,
            head=head,
            metadata=metadata or {},
        )

    def build_voice_intent(self, command: str, args: str = "", *, confidence: float = 1.0) -> VoiceIntent:
        return VoiceIntent(command=command.strip().lower(), args=args.strip(), confidence=confidence)
