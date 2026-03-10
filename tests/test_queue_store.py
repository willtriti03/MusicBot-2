import tempfile
import unittest
from pathlib import Path

from musicbot.queue_store import QueueStore


class FakeEntry:
    def __init__(
        self,
        title,
        url,
        playback_mode="download",
        filename="",
        downloaded=False,
        start_time=0.0,
        playback_speed=1.0,
    ):
        self.title = title
        self.url = url
        self.playback_mode = type("Mode", (), {"value": playback_mode})()
        self.filename = filename
        self.is_downloaded = downloaded
        self.start_time = start_time
        self.playback_speed = playback_speed


class FakePlaylist:
    def __init__(self, entries):
        self.entries = entries


class FakePlayer:
    def __init__(self):
        self.current_entry = FakeEntry("Current", "https://example.com/current")
        self.playlist = FakePlaylist(
            [
                FakeEntry(
                    "Queued",
                    "https://example.com/queued",
                    playback_mode="stream",
                    filename="/tmp/song",
                    downloaded=True,
                    start_time=5.0,
                    playback_speed=1.1,
                )
            ]
        )

    def serialize(self, **kwargs):
        del kwargs
        return '{"legacy": true}'


class FakeBot:
    class Config:
        def __init__(self, data_path):
            self.data_path = Path(data_path)
            self.persistent_queue = True

    def __init__(self, data_path):
        self.config = self.Config(data_path)
        self.aiolocks = {}


class QueueStoreTest(unittest.TestCase):
    def test_build_snapshot_contains_current_and_queued_entries(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store = QueueStore(FakeBot(tmpdir))
            snapshot = store.build_snapshot(42, FakePlayer())

            self.assertEqual(snapshot.guild_id, 42)
            self.assertEqual(snapshot.current_entry.title, "Current")
            self.assertEqual(snapshot.entries[0].playback_mode, "stream")
            self.assertEqual(snapshot.entries[0].filename, "/tmp/song")
            self.assertEqual(snapshot.legacy_player_json, '{"legacy": true}')


if __name__ == "__main__":
    unittest.main()
