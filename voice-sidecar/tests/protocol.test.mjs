import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_NAMES,
  REQUEST_COMMANDS,
  isKnownEventName,
  isKnownRequestCommand,
  splitOptionString,
} from "../dist/protocol.js";

test("known request commands stay registered", () => {
  assert.equal(isKnownRequestCommand("open_session"), true);
  assert.equal(isKnownRequestCommand("shutdown"), true);
  assert.equal(REQUEST_COMMANDS.has("play"), true);
});

test("known event names stay registered", () => {
  assert.equal(isKnownEventName("session_ready"), true);
  assert.equal(isKnownEventName("playback_error"), true);
  assert.equal(EVENT_NAMES.has("latency_update"), true);
});

test("splitOptionString preserves quoted chunks", () => {
  assert.deepEqual(splitOptionString('-ss 10 -af "atempo=1.25,volume=0.8"'), [
    "-ss",
    "10",
    "-af",
    "atempo=1.25,volume=0.8",
  ]);
});
