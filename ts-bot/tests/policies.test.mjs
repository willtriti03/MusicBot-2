import test from "node:test";
import assert from "node:assert/strict";

const {
  buildAutosimilarQuery,
  chooseAutosimilarEntry,
  chooseNextAutoplayEntry,
  isEquivalentTrack,
  shuffleEntries
} = await import("../dist/policies.js");

test("chooseNextAutoplayEntry prefers a different source when possible", () => {
  const entries = [
    { source: "a" },
    { source: "b" }
  ];
  assert.equal(chooseNextAutoplayEntry(entries, "a").source, "b");
  assert.equal(chooseNextAutoplayEntry(entries, "missing").source, "a");
});

test("chooseNextAutoplayEntry stops when the only autoplay candidate matches the last track", () => {
  assert.equal(chooseNextAutoplayEntry([{ source: "a" }], "a"), null);
  assert.equal(
    chooseNextAutoplayEntry([{ source: "https://example.com/track" }], {
      originalUrl: "https://example.com/track"
    }),
    null
  );
});

test("isEquivalentTrack matches by URL or by normalized title and artist", () => {
  assert.equal(
    isEquivalentTrack(
      { originalUrl: "https://example.com/a" },
      { webpageUrl: "https://example.com/a" }
    ),
    true
  );
  assert.equal(
    isEquivalentTrack(
      { title: "Song Name", artist: "Artist" },
      { title: " song name ", artist: "artist" }
    ),
    true
  );
  assert.equal(
    isEquivalentTrack(
      { title: "Song Name", artist: "Artist A" },
      { title: "Song Name", artist: "Artist B" }
    ),
    false
  );
});

test("chooseAutosimilarEntry skips the same song and picks the next distinct result", () => {
  const lastEntry = {
    originalUrl: "https://example.com/original",
    title: "Song Name",
    artist: "Artist"
  };
  const results = [
    {
      webpageUrl: "https://example.com/original",
      title: "Song Name",
      artist: "Artist"
    },
    {
      webpageUrl: "https://example.com/next",
      title: "Another Song",
      artist: "Artist"
    }
  ];

  assert.equal(chooseAutosimilarEntry(results, lastEntry).webpageUrl, "https://example.com/next");
  assert.equal(chooseAutosimilarEntry([results[0]], lastEntry), null);
});

test("buildAutosimilarQuery derives a reasonable YouTube search query", () => {
  assert.equal(
    buildAutosimilarQuery({ title: "Song", artist: "Artist" }),
    "Artist Song audio"
  );
  assert.equal(buildAutosimilarQuery(null), null);
});

test("shuffleEntries preserves the original item set", () => {
  const values = [1, 2, 3, 4, 5];
  const shuffled = shuffleEntries(values);
  assert.deepEqual([...shuffled].sort(), values);
  assert.notEqual(shuffled, values);
});
