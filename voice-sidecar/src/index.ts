// @ts-nocheck

const { spawn } = require("node:child_process");
const readline = require("node:readline");
const process = require("node:process");
const {
  REQUEST_COMMANDS,
  isKnownRequestCommand,
  splitOptionString,
} = require("./protocol");

let Client;
let GatewayIntentBits;
let AudioPlayerStatus;
let NoSubscriberBehavior;
let StreamType;
let VoiceConnectionStatus;
let createAudioPlayer;
let createAudioResource;
let entersState;
let joinVoiceChannel;

try {
  const discordJs = require("discord.js");
  const voice = require("@discordjs/voice");
  require("@snazzah/davey");

  ({ Client, GatewayIntentBits } = discordJs);
  ({
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel,
  } = voice);
} catch (error) {
  process.stderr.write(
    `voice-sidecar dependency load failed: ${error && error.stack ? error.stack : String(error)}\n`,
  );
  process.exit(1);
}

const token = process.env.MUSICBOT_DISCORD_TOKEN || "";
if (!token) {
  process.stderr.write("voice-sidecar missing MUSICBOT_DISCORD_TOKEN\n");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const sessions = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResponse(id, ok, payload) {
  if (ok) {
    send({ op: "response", id, ok: true, data: payload || {} });
    return;
  }

  send({
    op: "response",
    id,
    ok: false,
    error: payload instanceof Error ? payload.message : String(payload),
  });
}

function sendEvent(event, data) {
  send({ op: "event", event, data: data || {} });
}

function logEvent(level, message, extra) {
  sendEvent("log", {
    level,
    message,
    ...(extra || {}),
  });
}

function getLatencyMs(connection) {
  const wsPing =
    connection && connection.ping && Number.isFinite(connection.ping.ws)
      ? connection.ping.ws
      : 0;
  return Number(wsPing || 0);
}

function buildFfmpegArgs(data) {
  const args = ["-hide_banner", "-loglevel", "warning", "-nostdin"];
  const beforeOptions = splitOptionString(data.before_options || "");
  const afterOptions = splitOptionString(data.after_options || "");
  const source = String(data.source || "");
  const sourceKind = String(data.source_kind || "path");

  args.push(...beforeOptions);
  if (sourceKind === "url" && !beforeOptions.includes("-reconnect")) {
    args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
  }
  args.push("-i", source);
  args.push(...afterOptions);
  args.push("-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1");
  return args;
}

async function resolveGuild(guildId) {
  const cached = client.guilds.cache.get(String(guildId));
  if (cached) {
    return cached;
  }
  return client.guilds.fetch(String(guildId));
}

async function resolveVoiceChannel(guildId, channelId) {
  const guild = await resolveGuild(guildId);
  const channel = guild.channels.cache.get(String(channelId))
    || (await guild.channels.fetch(String(channelId)));
  if (!channel || typeof channel.isVoiceBased !== "function" || !channel.isVoiceBased()) {
    throw new Error(`Channel ${channelId} is not voice-based.`);
  }
  return { guild, channel };
}

class Session {
  constructor(guildId) {
    this.guildId = Number(guildId);
    this.channelId = null;
    this.connection = null;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });
    this.ffmpeg = null;
    this.currentEntryId = null;
    this.volume = 1;
    this.selfDeaf = true;
    this._bindPlayerEvents();
  }

  _bindPlayerEvents() {
    this.player.on(AudioPlayerStatus.Playing, () => {
      sendEvent("playback_started", {
        guild_id: this.guildId,
        channel_id: this.channelId,
        entry_id: this.currentEntryId,
      });
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      const entryId = this.currentEntryId;
      this.currentEntryId = null;
      this._cleanupFfmpeg();
      if (entryId) {
        sendEvent("playback_finished", {
          guild_id: this.guildId,
          channel_id: this.channelId,
          entry_id: entryId,
        });
      }
    });

    this.player.on("error", (error) => {
      sendEvent("playback_error", {
        guild_id: this.guildId,
        channel_id: this.channelId,
        entry_id: this.currentEntryId,
        message: error && error.message ? error.message : String(error),
      });
      this.currentEntryId = null;
      this._cleanupFfmpeg();
    });
  }

  _cleanupFfmpeg() {
    if (!this.ffmpeg) {
      return;
    }
    this.ffmpeg.removeAllListeners();
    if (!this.ffmpeg.killed) {
      this.ffmpeg.kill("SIGKILL");
    }
    this.ffmpeg = null;
  }

  async open(data) {
    const { guild, channel } = await resolveVoiceChannel(data.guild_id, data.channel_id);
    this.selfDeaf = Boolean(data.self_deaf);

    if (this.connection) {
      this.connection.rejoin({
        channelId: String(channel.id),
        selfDeaf: this.selfDeaf,
      });
    } else {
      this.connection = joinVoiceChannel({
        guildId: String(guild.id),
        channelId: String(channel.id),
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: this.selfDeaf,
        selfMute: false,
      });
      this.connection.subscribe(this.player);
    }

    await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
    this.channelId = Number(channel.id);
    const latencyMs = getLatencyMs(this.connection);
    const payload = {
      guild_id: this.guildId,
      channel_id: this.channelId,
      latency_ms: latencyMs,
      average_latency_ms: latencyMs,
    };
    sendEvent("session_ready", payload);
    return payload;
  }

  async disconnect() {
    this.player.stop(true);
    this._cleanupFfmpeg();
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    const payload = {
      guild_id: this.guildId,
      channel_id: this.channelId,
    };
    sendEvent("session_closed", payload);
    return payload;
  }

  async play(data) {
    if (!this.connection) {
      throw new Error(`Guild ${this.guildId} has no open voice session.`);
    }

    this.player.stop(true);
    this._cleanupFfmpeg();

    const ffmpegArgs = buildFfmpegArgs(data);
    this.ffmpeg = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.ffmpeg.stderr.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) {
        logEvent("debug", `ffmpeg: ${text}`, { guild_id: this.guildId });
      }
    });
    this.ffmpeg.on("error", (error) => {
      sendEvent("playback_error", {
        guild_id: this.guildId,
        channel_id: this.channelId,
        entry_id: this.currentEntryId,
        message: error && error.message ? error.message : String(error),
      });
    });

    const resource = createAudioResource(this.ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });

    this.volume = Number(data.volume || this.volume || 1);
    if (resource.volume) {
      resource.volume.setVolume(this.volume);
    }

    this.currentEntryId = String(data.entry_id || "");
    this.player.play(resource);
    return {
      guild_id: this.guildId,
      channel_id: this.channelId,
      entry_id: this.currentEntryId,
    };
  }

  pause() {
    this.player.pause();
    return { guild_id: this.guildId };
  }

  resume() {
    this.player.unpause();
    return { guild_id: this.guildId };
  }

  stop() {
    this.player.stop(true);
    this._cleanupFfmpeg();
    return { guild_id: this.guildId };
  }

  setVolume(data) {
    this.volume = Number(data.volume || this.volume || 1);
    const resource = this.player.state && this.player.state.resource;
    if (resource && resource.volume) {
      resource.volume.setVolume(this.volume);
    }
    return { guild_id: this.guildId, volume: this.volume };
  }

  latencyPayload() {
    const latencyMs = getLatencyMs(this.connection);
    return {
      guild_id: this.guildId,
      channel_id: this.channelId,
      latency_ms: latencyMs,
      average_latency_ms: latencyMs,
    };
  }
}

function getSession(guildId) {
  const key = Number(guildId);
  if (!sessions.has(key)) {
    sessions.set(key, new Session(key));
  }
  return sessions.get(key);
}

async function handleRequest(message) {
  const command = String(message.command || "");
  const data = message.data || {};

  if (!REQUEST_COMMANDS.has(command) || !isKnownRequestCommand(command)) {
    throw new Error(`Unsupported voice-sidecar command: ${command}`);
  }

  if (command === "shutdown") {
    for (const session of sessions.values()) {
      await session.disconnect();
    }
    sessions.clear();
    await client.destroy();
    return { shutdown: true };
  }

  if (command === "voice_state_update" || command === "voice_server_update") {
    return { accepted: true };
  }

  const session = getSession(data.guild_id);
  switch (command) {
    case "open_session":
    case "move":
      return session.open(data);
    case "disconnect": {
      const payload = await session.disconnect();
      sessions.delete(Number(data.guild_id));
      return payload;
    }
    case "play":
      return session.play(data);
    case "pause":
      return session.pause();
    case "resume":
      return session.resume();
    case "stop":
      return session.stop();
    case "set_volume":
      return session.setVolume(data);
    default:
      throw new Error(`Unhandled voice-sidecar command: ${command}`);
  }
}

async function main() {
  const readyPromise = new Promise((resolve) => {
    client.once("ready", () => {
      logEvent("info", `voice-sidecar ready as ${client.user ? client.user.tag : "unknown"}`);
      resolve();
    });
  });

  client.on("error", (error) => {
    logEvent("error", `discord.js client error: ${error && error.message ? error.message : String(error)}`);
  });

  await client.login(token);
  await readyPromise;

  setInterval(() => {
    for (const session of sessions.values()) {
      if (!session.connection) {
        continue;
      }
      sendEvent("latency_update", session.latencyPayload());
    }
  }, 10_000).unref();

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on("line", async (line) => {
    if (!line || !line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      logEvent("error", `Invalid JSON from supervisor: ${error && error.message ? error.message : String(error)}`);
      return;
    }

    if (message.op !== "request") {
      return;
    }

    try {
      const result = await handleRequest(message);
      sendResponse(message.id, true, result);

      if (message.command === "shutdown") {
        process.exit(0);
      }
    } catch (error) {
      sendResponse(message.id, false, error);
    }
  });
}

main().catch((error) => {
  process.stderr.write(
    `voice-sidecar fatal error: ${error && error.stack ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
