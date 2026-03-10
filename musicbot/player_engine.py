from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .player import MusicPlayer


class PlayerEngine:
    def __init__(self, player: "MusicPlayer") -> None:
        self.player = player

    def play(self, *, continue_playback: bool = False) -> None:
        if continue_playback:
            self.player.play(_continue=True)
            return
        self.player.play()

    def pause(self) -> None:
        self.player.pause()

    def resume(self) -> None:
        self.player.resume()

    def stop(self) -> None:
        self.player.stop()

    def skip(self) -> None:
        self.player.skip()
