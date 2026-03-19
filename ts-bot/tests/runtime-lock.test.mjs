import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { acquireRuntimeLock } = await import("../dist/runtime-lock.js");

test("acquireRuntimeLock creates and releases the lock file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-runtime-lock-"));
  const lockPath = path.join(tempRoot, "musicbot.lock");

  const lock = acquireRuntimeLock({
    instanceLockPath: lockPath,
    configPath: path.join(tempRoot, "config.json")
  });

  assert.equal(fs.existsSync(lockPath), true);
  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
});

test("acquireRuntimeLock rejects when another live process owns the lock", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-runtime-lock-live-"));
  const lockPath = path.join(tempRoot, "musicbot.lock");
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({
      instanceId: "other-instance",
      pid: process.pid,
      createdAt: "2026-03-19T00:00:00.000Z"
    })}\n`
  );

  assert.throws(
    () =>
      acquireRuntimeLock({
        instanceLockPath: lockPath,
        configPath: path.join(tempRoot, "config.json")
      }),
    /Another MusicBot instance is already running/
  );
});

test("acquireRuntimeLock clears a stale lock file and takes ownership", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-runtime-lock-stale-"));
  const lockPath = path.join(tempRoot, "musicbot.lock");
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({
      instanceId: "stale-instance",
      pid: 999999,
      createdAt: "2026-03-19T00:00:00.000Z"
    })}\n`
  );

  const lock = acquireRuntimeLock({
    instanceLockPath: lockPath,
    configPath: path.join(tempRoot, "config.json")
  });

  const stored = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(stored.pid, process.pid);
  assert.notEqual(stored.instanceId, "stale-instance");

  lock.release();
  assert.equal(fs.existsSync(lockPath), false);
});
