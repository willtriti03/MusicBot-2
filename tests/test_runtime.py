import unittest

from musicbot.runtime import (
    LOCKED_RUNTIME,
    collect_runtime_diagnostics,
    format_runtime_diagnostics,
    get_voice_runtime_issue,
    has_detectable_dave_support,
)


class RuntimeTest(unittest.TestCase):
    def test_collect_runtime_diagnostics_has_expected_keys(self):
        diagnostics = collect_runtime_diagnostics()
        self.assertIn("python", diagnostics)
        self.assertIn("python_executable", diagnostics)
        for package_name in LOCKED_RUNTIME:
            if package_name == "python":
                continue
            self.assertIn(package_name, diagnostics)

    def test_format_runtime_diagnostics_contains_supported_python(self):
        report = format_runtime_diagnostics()
        self.assertIn("Python: supported", report)

    def test_detects_missing_dave_support(self):
        class FakeConnectable:
            async def connect(self, *, timeout, reconnect):
                return None

        class FakeVoiceClient:
            supported_modes = ("aead_xchacha20_poly1305_rtpsize",)

            async def connect(self, *, timeout, reconnect):
                return None

        class FakeDiscord:
            __version__ = "2.7.1"

            class abc:
                Connectable = FakeConnectable

            class voice_client:
                VoiceClient = FakeVoiceClient

            class gateway:
                class DiscordVoiceWebSocket:
                    pass

        self.assertFalse(has_detectable_dave_support(FakeDiscord))
        self.assertIsNone(
            get_voice_runtime_issue(FakeDiscord, requires_dave=False)
        )
        self.assertIn(
            "Discord enforced DAVE",
            get_voice_runtime_issue(FakeDiscord, requires_dave=True) or "",
        )

    def test_detects_dave_signature_support(self):
        class FakeConnectable:
            async def connect(
                self,
                *,
                timeout,
                reconnect,
                max_dave_protocol_version=None,
            ):
                return None

        class FakeVoiceClient:
            supported_modes = ("aead_xchacha20_poly1305_rtpsize",)

        class FakeDiscord:
            __version__ = "future"

            class abc:
                Connectable = FakeConnectable

            class voice_client:
                VoiceClient = FakeVoiceClient

            class gateway:
                class DiscordVoiceWebSocket:
                    pass

        self.assertTrue(has_detectable_dave_support(FakeDiscord))
        self.assertIsNone(
            get_voice_runtime_issue(FakeDiscord, requires_dave=True)
        )


if __name__ == "__main__":
    unittest.main()
