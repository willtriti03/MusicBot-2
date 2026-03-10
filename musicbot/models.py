from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class PlaybackRequest:
    query: str
    playback_mode: Any
    guild_id: int
    channel_id: int
    author_id: int
    head: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["playback_mode"] = getattr(self.playback_mode, "value", str(self.playback_mode))
        return data


@dataclass(frozen=True)
class VoiceIntent:
    command: str
    args: str = ""
    confidence: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class QueueEntrySnapshot:
    title: str
    url: str
    playback_mode: str
    filename: str = ""
    downloaded: bool = False
    start_time: float = 0.0
    playback_speed: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class QueueSnapshot:
    version: int
    guild_id: int
    serialized_at: float
    current_entry: Optional[QueueEntrySnapshot]
    entries: List[QueueEntrySnapshot]
    legacy_player_json: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "guild_id": self.guild_id,
            "serialized_at": self.serialized_at,
            "current_entry": (
                self.current_entry.to_dict() if self.current_entry else None
            ),
            "entries": [entry.to_dict() for entry in self.entries],
            "legacy_player_json": self.legacy_player_json,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QueueSnapshot":
        current = data.get("current_entry")
        entries = [
            QueueEntrySnapshot(**entry_data) for entry_data in data.get("entries", [])
        ]
        return cls(
            version=int(data.get("version", 1)),
            guild_id=int(data.get("guild_id", 0)),
            serialized_at=float(data.get("serialized_at", 0.0)),
            current_entry=QueueEntrySnapshot(**current) if isinstance(current, dict) else None,
            entries=entries,
            legacy_player_json=str(data.get("legacy_player_json", "")),
        )
