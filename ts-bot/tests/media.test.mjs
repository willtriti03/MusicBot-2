import test from "node:test";
import assert from "node:assert/strict";

const {
  isSpotifyUrl,
  isUrl,
  parseSpotifyUrl
} = await import("../dist/media.js");

test("URL helpers distinguish Spotify URLs from plain URLs", () => {
  assert.equal(isUrl("https://example.com"), true);
  assert.equal(isSpotifyUrl("https://open.spotify.com/track/abc123"), true);
  assert.equal(isSpotifyUrl("https://example.com/track/abc123"), false);
});

test("parseSpotifyUrl extracts the Spotify resource type and ID", () => {
  assert.deepEqual(
    parseSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"),
    {
      type: "playlist",
      id: "37i9dQZF1DXcBWIGoYBM5M"
    }
  );
  assert.equal(parseSpotifyUrl("https://example.com/not-spotify"), null);
});
