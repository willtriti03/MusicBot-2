import test from "node:test";
import assert from "node:assert/strict";

const {
  createMissingCommandError
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
