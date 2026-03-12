import test from "node:test";
import assert from "node:assert/strict";

const {
  buildAutosimilarQuery,
  chooseNextAutoplayEntry,
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
