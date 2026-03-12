from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable, Optional, Protocol, TypeGuard, runtime_checkable

if TYPE_CHECKING:
    from .entry import BasePlaylistEntry

    PlaybackAfterCallback = Callable[[Optional[Exception]], None]
else:
    PlaybackAfterCallback = Callable[[Optional[Exception]], None]


VOICE_TRANSPORT_LEGACY = "legacy"
VOICE_TRANSPORT_DAVE_SIDECAR = "dave-sidecar"
DAVE_SIDECAR_DEFERRED_MESSAGE = "DAVE transport 마이그레이션 1차 범위 제외."


@runtime_checkable
class VoiceTransport(Protocol):
    guild: Any
    channel: Any
    latency: float
    average_latency: float

    def is_connected(self) -> bool:
        ...

    async def disconnect(self, *, force: bool = False) -> None:
        ...

    async def move_to(self, channel: Any) -> None:
        ...

    def pause(self) -> None:
        ...

    def resume(self) -> None:
        ...

    def stop(self) -> None:
        ...


@runtime_checkable
class SidecarPlayableTransport(VoiceTransport, Protocol):
    async def play_entry(
        self,
        entry: "BasePlaylistEntry",
        *,
        volume: float,
        after: PlaybackAfterCallback,
    ) -> None:
        ...

    def set_volume(self, value: float) -> None:
        ...


def is_voice_transport(value: Any) -> TypeGuard[VoiceTransport]:
    if value is None:
        return False

    required_attrs = ("guild", "channel", "latency", "average_latency")
    required_methods = (
        "is_connected",
        "disconnect",
        "move_to",
        "pause",
        "resume",
        "stop",
    )
    return all(hasattr(value, attr) for attr in required_attrs) and all(
        callable(getattr(value, method, None)) for method in required_methods
    )


def supports_sidecar_playback(value: Any) -> TypeGuard[SidecarPlayableTransport]:
    return is_voice_transport(value) and callable(getattr(value, "play_entry", None))


def voice_transport_mode_enabled(config: Any, mode: str) -> bool:
    return str(getattr(config, "voice_transport", VOICE_TRANSPORT_LEGACY)).strip().lower() == mode


def is_dave_sidecar_enabled(config: Any) -> bool:
    return voice_transport_mode_enabled(config, VOICE_TRANSPORT_DAVE_SIDECAR)


def deferred_dave_feature_message(feature_name: str) -> str:
    return f"{feature_name} is unavailable: {DAVE_SIDECAR_DEFERRED_MESSAGE}"
