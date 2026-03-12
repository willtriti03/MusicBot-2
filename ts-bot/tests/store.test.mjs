import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { SqliteStore } = await import("../dist/store.js");

test("SqliteStore round-trips guild settings, queue snapshots, and autoplaylist entries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-store-"));
  const databasePath = path.join(tempRoot, "musicbot.sqlite");
  const store = new SqliteStore({ databasePath });

  store.saveGuildSettings("1", { defaultVolume: 0.5, autoplayEnabled: true });
  store.saveQueueSnapshot("1", {
    queue: [{ title: "Song A" }],
    currentEntry: { title: "Current" },
    progressSeconds: 12
  });
  store.saveAutoplaylist("1", [
    { source: "https://example.com/a", title: "A" },
    { source: "https://example.com/b", title: "B" }
  ]);

  assert.deepEqual(store.getGuildSettings("1", {}), {
    defaultVolume: 0.5,
    autoplayEnabled: true
  });
  assert.equal(store.getQueueSnapshot("1").currentEntry.title, "Current");
  assert.equal(store.getAutoplaylist("1").length, 2);
  assert.equal(store.removeAutoplaylistEntry("1", "https://example.com/a"), true);
  assert.equal(store.getAutoplaylist("1").length, 1);

  store.close();
});
