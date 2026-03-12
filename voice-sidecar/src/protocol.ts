export const REQUEST_COMMANDS = new Set([
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

export const EVENT_NAMES = new Set([
  "session_ready",
  "session_closed",
  "playback_started",
  "playback_finished",
  "playback_error",
  "latency_update",
  "log",
]);

export function splitOptionString(value: string): string[] {
  if (!value || !String(value).trim()) {
    return [];
  }

  const tokens = String(value).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return tokens.map((token) => token.replace(/^"(.*)"$/, "$1"));
}

export function isKnownRequestCommand(command: string): boolean {
  return REQUEST_COMMANDS.has(command);
}

export function isKnownEventName(eventName: string): boolean {
  return EVENT_NAMES.has(eventName);
}
