"use strict";

const REQUEST_COMMANDS = new Set([
  "open_session",
  "voice_state_update",
  "voice_server_update",
  "move",
  "disconnect",
  "play",
  "pause",
  "resume",
  "stop",
  "set_volume",
  "shutdown",
]);

const EVENT_NAMES = new Set([
  "session_ready",
  "session_closed",
  "playback_started",
  "playback_finished",
  "playback_error",
  "latency_update",
  "log",
]);

function splitOptionString(value) {
  if (!value || !String(value).trim()) {
    return [];
  }

  const tokens = String(value).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return tokens.map((token) => token.replace(/^"(.*)"$/, "$1"));
}

function isKnownRequestCommand(command) {
  return REQUEST_COMMANDS.has(command);
}

function isKnownEventName(eventName) {
  return EVENT_NAMES.has(eventName);
}

module.exports = {
  EVENT_NAMES,
  REQUEST_COMMANDS,
  isKnownEventName,
  isKnownRequestCommand,
  splitOptionString,
};
