import test from "node:test";
import assert from "node:assert/strict";

const {
  createMissingCommandError,
  normalizeCommandError
} = await import("../dist/media.js");

test("createMissingCommandError includes install guidance and env override", () => {
  assert.match(
    createMissingCommandError("yt-dlp").message,
    /MUSICBOT_YTDLP_PATH/
  );
  assert.match(
    createMissingCommandError("ffmpeg").message,
    /MUSICBOT_FFMPEG_PATH/
  );
});

test("normalizeCommandError strips yt-dlp deprecation noise and surfaces unavailable videos cleanly", () => {
  const error = normalizeCommandError(
    "yt-dlp",
    1,
    [
      "Deprecated Feature: The following options have been deprecated: --no-call-home",
      "Please remove them from your command/configuration to avoid future errors.",
      "ERROR: [youtube] abc123: Video unavailable"
    ].join("\n")
  );

  assert.equal(
    error.message,
    "The requested video is unavailable and cannot be played."
  );
});
