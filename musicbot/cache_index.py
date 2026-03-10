from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict

if TYPE_CHECKING:
    from .filecache import AudioFileCache


class CacheIndex:
    def __init__(self, filecache: "AudioFileCache") -> None:
        self.filecache = filecache

    def has_cache_data(self) -> bool:
        return self.filecache.has_cache_data()

    def cleanup_startup(self) -> bool:
        return self.filecache.cleanup_startup_cache()

    def purge(self) -> bool:
        return self.filecache.purge_audio_cache()

    def enforce_limits(self) -> bool:
        return self.filecache.delete_old_audiocache()

    def snapshot(self) -> Dict[str, Any]:
        size_bytes, file_count = self.filecache.scan_audio_cache()
        return {
            "path": str(self.filecache.folder),
            "size_bytes": size_bytes,
            "file_count": file_count,
            "cachemap_entries": len(self.filecache.auto_playlist_cachemap),
        }
