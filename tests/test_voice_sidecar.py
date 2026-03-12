import asyncio
import unittest

from musicbot.voice_sidecar import SidecarVoiceClient, VoiceSidecarSupervisor
from musicbot.voice_transport import (
    VOICE_TRANSPORT_DAVE_SIDECAR,
    VOICE_TRANSPORT_LEGACY,
    deferred_dave_feature_message,
    is_dave_sidecar_enabled,
)


class FakeBot:
    class Config:
        voice_transport = VOICE_TRANSPORT_DAVE_SIDECAR
        voice_sidecar_node_bin = ""
        auth = ("token",)

    def __init__(self):
        self.config = self.Config()
        self.loop = asyncio.new_event_loop()

    async def handle_voice_sidecar_exit(self, reason):
        del reason


class FakeEntry:
    title = "Title"
    url = "https://example.com/track"
    filename = "/tmp/track.webm"
    is_downloaded = True
    playback_mode = type("Mode", (), {"value": "download"})()
    start_time = 12.5
    playback_speed = 1.25
    boptions = "-ss 12.5"
    aoptions = "-af atempo=1.25 -vn"


class VoiceSidecarTest(unittest.TestCase):
    def test_voice_transport_mode_helpers(self):
        bot = FakeBot()
        self.addCleanup(bot.loop.close)
        self.assertTrue(is_dave_sidecar_enabled(bot.config))
        bot.config.voice_transport = VOICE_TRANSPORT_LEGACY
        self.assertFalse(is_dave_sidecar_enabled(bot.config))
        self.assertIn("DAVE transport", deferred_dave_feature_message("Seek"))

    def test_build_playback_payload_prefers_downloaded_file(self):
        bot = FakeBot()
        self.addCleanup(bot.loop.close)
        supervisor = VoiceSidecarSupervisor(bot)

        payload = supervisor.build_playback_payload(FakeEntry(), 0.4)

        self.assertEqual(payload["source"], "/tmp/track.webm")
        self.assertEqual(payload["source_kind"], "path")
        self.assertEqual(payload["start_time"], 12.5)
        self.assertEqual(payload["volume"], 0.4)

    def test_sidecar_client_dispatches_after_callback(self):
        bot = FakeBot()
        self.addCleanup(bot.loop.close)
        supervisor = VoiceSidecarSupervisor(bot)
        guild = type("Guild", (), {"id": 1})()
        channel = type("Channel", (), {"id": 2})()
        client = SidecarVoiceClient(supervisor, guild, channel)
        results = []

        client._after = lambda error: results.append(error)
        client._apply_playback_finished({})

        self.assertEqual(results, [None])


if __name__ == "__main__":
    unittest.main()
