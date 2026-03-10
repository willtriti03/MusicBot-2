import unittest

from musicbot.models import PlaybackRequest, QueueEntrySnapshot, QueueSnapshot, VoiceIntent


class ModelsTest(unittest.TestCase):
    def test_playback_request_serializes_mode(self):
        request = PlaybackRequest(
            query="test query",
            playback_mode="stream",
            guild_id=1,
            channel_id=2,
            author_id=3,
        )

        self.assertEqual(
            request.to_dict(),
            {
                "query": "test query",
                "playback_mode": "stream",
                "guild_id": 1,
                "channel_id": 2,
                "author_id": 3,
                "head": False,
                "metadata": {},
            },
        )

    def test_queue_snapshot_roundtrip(self):
        current = QueueEntrySnapshot(
            title="Now Playing",
            url="https://example.com/now",
            playback_mode="download",
        )
        queued = QueueEntrySnapshot(
            title="Queued",
            url="https://example.com/queued",
            playback_mode="stream",
            filename="/tmp/file",
            downloaded=True,
            start_time=12.5,
            playback_speed=1.25,
        )
        snapshot = QueueSnapshot(
            version=1,
            guild_id=123,
            serialized_at=10.0,
            current_entry=current,
            entries=[queued],
            legacy_player_json='{"legacy": true}',
        )

        restored = QueueSnapshot.from_dict(snapshot.to_dict())

        self.assertEqual(restored.version, 1)
        self.assertEqual(restored.guild_id, 123)
        self.assertEqual(restored.current_entry.title, "Now Playing")
        self.assertEqual(restored.entries[0].url, "https://example.com/queued")
        self.assertEqual(restored.legacy_player_json, '{"legacy": true}')

    def test_voice_intent_dict(self):
        intent = VoiceIntent(command="play", args="song", confidence=0.8)
        self.assertEqual(
            intent.to_dict(),
            {"command": "play", "args": "song", "confidence": 0.8},
        )


if __name__ == "__main__":
    unittest.main()
