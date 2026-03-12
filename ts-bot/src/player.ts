const { spawn } = require("node:child_process");
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require("@discordjs/voice");
const { ChannelType } = require("discord.js");

const {
  buildAutosimilarQuery,
  chooseAutosimilarEntry,
  chooseNextAutoplayEntry,
  shuffleEntries
} = require("./policies");
const { buildVoiceJoinConfig } = require("./dave");

class GuildPlayer {
  constructor(app, guild) {
    this.app = app;
    this.client = app.client;
    this.config = app.config;
    this.store = app.store;
    this.mediaResolver = app.mediaResolver;
    this.guild = guild;
    this.queue = [];
    this.currentEntry = null;
    this.lastPlayedEntry = null;
    this.connection = null;
    this.boundConnection = null;
    this.ffmpegProcess = null;
    this.voiceChannelId = null;
    this.textChannelId = null;
    this.pendingIdleAction = "advance";
    this.playStartedAt = 0;
    this.pauseStartedAt = 0;
    this.pausedAccumulatedMs = 0;
    this.initialized = false;
    this.isAdvancing = false;
    this.skipRequested = false;
    this.disconnectRequested = false;

    this._connectionErrorListener = (error) => {
      this.app.enqueueBackgroundTask(this._handleConnectionError(error));
    };
    this._connectionStateListener = (oldState, newState) => {
      this.app.enqueueBackgroundTask(
        this._handleConnectionStateChange(oldState, newState)
      );
    };

    this.settings = this.store.getGuildSettings(
      guild.id,
      this.config.defaultGuildSettings
    );
    this.autoplaylist = this.store.getAutoplaylist(guild.id);

    this.audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.app.enqueueBackgroundTask(this._handleIdle());
    });
    this.audioPlayer.on("error", (error) => {
      this.app.log(
        "error",
        `[guild:${guild.id}] audio player error: ${error && error.message ? error.message : String(error)}`
      );
      this.app.enqueueBackgroundTask(this._handleIdle());
    });
  }

  async hydrateFromStore() {
    if (this.initialized) {
      return;
    }

    const snapshot = this.store.getQueueSnapshot(this.guild.id);
    if (snapshot) {
      this.voiceChannelId = snapshot.voiceChannelId || null;
      this.textChannelId = snapshot.textChannelId || null;
      this.queue = Array.isArray(snapshot.queue) ? [...snapshot.queue] : [];
      if (snapshot.currentEntry) {
        const restoredCurrent = {
          ...snapshot.currentEntry,
          startTimeSeconds: Number(snapshot.progressSeconds || 0)
        };
        this.queue.unshift(restoredCurrent);
      }
      if (snapshot.settings) {
        this.settings = {
          ...this.settings,
          ...snapshot.settings
        };
      }
    }

    this.initialized = true;
  }

  async recoverAfterStartup() {
    await this.hydrateFromStore();
    if (!this.voiceChannelId || this.queue.length === 0) {
      await this.persist();
      return;
    }

    const channel = await this.guild.channels.fetch(this.voiceChannelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      await this.persist();
      return;
    }

    await this.ensureConnection(channel, this.textChannelId);
    await this.playNext();
  }

  getVolumePercent() {
    return Math.round(Number(this.settings.defaultVolume || 0.2) * 100);
  }

  getProgressSeconds() {
    if (!this.currentEntry || !this.playStartedAt) {
      return 0;
    }

    const pausedMs = this.pauseStartedAt
      ? this.pausedAccumulatedMs + (Date.now() - this.pauseStartedAt)
      : this.pausedAccumulatedMs;
    const elapsedMs = Date.now() - this.playStartedAt - pausedMs;
    return Math.max(0, Number(this.currentEntry.startTimeSeconds || 0) + elapsedMs / 1000);
  }

  _resetProgressClock() {
    this.playStartedAt = 0;
    this.pauseStartedAt = 0;
    this.pausedAccumulatedMs = 0;
  }

  _bindConnection(connection) {
    if (!connection || this.boundConnection === connection) {
      return;
    }

    if (this.boundConnection) {
      this.boundConnection.off("error", this._connectionErrorListener);
      this.boundConnection.off("stateChange", this._connectionStateListener);
    }

    this.boundConnection = connection;
    this.boundConnection.on("error", this._connectionErrorListener);
    this.boundConnection.on("stateChange", this._connectionStateListener);
  }

  _unbindConnection() {
    if (!this.boundConnection) {
      return;
    }

    this.boundConnection.off("error", this._connectionErrorListener);
    this.boundConnection.off("stateChange", this._connectionStateListener);
    this.boundConnection = null;
  }

  _destroyConnection() {
    if (!this.connection) {
      this._unbindConnection();
      return;
    }

    const connection = this.connection;
    this.connection = null;
    this._unbindConnection();
    connection.destroy();
  }

  _requeueCurrentEntryOnFailure() {
    if (!this.currentEntry || this.skipRequested || this.disconnectRequested) {
      return;
    }

    const replayEntry = {
      ...this.currentEntry,
      startTimeSeconds: this.getProgressSeconds()
    };
    this.queue.unshift(replayEntry);
  }

  async _handleConnectionError(error) {
    this.app.log(
      "warn",
      `[guild:${this.guild.id}] voice connection error: ${error && error.message ? error.message : String(error)}`
    );
    this._requeueCurrentEntryOnFailure();
    this.currentEntry = null;
    this._resetProgressClock();
    this._cleanupFfmpeg();
    this._destroyConnection();
    this.pendingIdleAction = "halt";
    await this.persist();
  }

  async _handleConnectionStateChange(oldState, newState) {
    if (!newState || oldState.status === newState.status) {
      return;
    }

    if (newState.status === VoiceConnectionStatus.Destroyed) {
      this.connection = null;
      this._unbindConnection();
      await this.persist();
      return;
    }

    if (
      newState.status === VoiceConnectionStatus.Disconnected &&
      newState.reason !== VoiceConnectionDisconnectReason.AdapterUnavailable
    ) {
      this.app.log(
        "warn",
        `[guild:${this.guild.id}] voice connection disconnected: ${newState.reason || "unknown"}`
      );
    }
  }

  async ensureConnection(channel, textChannelId = null) {
    const existing = getVoiceConnection(this.guild.id);
    this.connection = existing || this.connection;
    this.voiceChannelId = channel.id;
    if (textChannelId) {
      this.textChannelId = textChannelId;
    }

    if (this.connection) {
      this.connection.rejoin({
        channelId: channel.id,
        selfDeaf: true
      });
    } else {
      this.connection = joinVoiceChannel(buildVoiceJoinConfig(channel));
    }
    this._bindConnection(this.connection);
    this.connection.subscribe(this.audioPlayer);

    await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);

    if (channel.type === ChannelType.GuildStageVoice) {
      await this.guild.members.me.voice.setSuppressed(false).catch(() => null);
    }

    await this.persist();
    return this.connection;
  }

  async enqueue(entries, options = {}) {
    await this.hydrateFromStore();
    if (options.toFront) {
      this.queue.unshift(...entries);
    } else {
      this.queue.push(...entries);
    }

    if (options.textChannelId) {
      this.textChannelId = options.textChannelId;
    }
    await this.persist();
  }

  _cleanupFfmpeg() {
    if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
      this.ffmpegProcess.kill("SIGKILL");
    }
    this.ffmpegProcess = null;
  }

  _createAudioResource(playbackSource, entry) {
    const args = ["-hide_banner", "-loglevel", "warning", "-nostdin"];
    if (Number(entry.startTimeSeconds || 0) > 0) {
      args.push("-ss", String(entry.startTimeSeconds));
    }
    if (playbackSource.inputKind === "url") {
      args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
    }
    args.push(
      "-i",
      playbackSource.input,
      "-vn",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1"
    );

    this.ffmpegProcess = spawn(this.config.ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.ffmpegProcess.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        this.app.log("debug", `[guild:${this.guild.id}] ffmpeg: ${message}`);
      }
    });

    const resource = createAudioResource(this.ffmpegProcess.stdout, {
      inlineVolume: true,
      inputType: StreamType.Raw
    });
    if (resource.volume) {
      resource.volume.setVolume(Number(this.settings.defaultVolume || 0.2));
    }
    return resource;
  }

  async playNext() {
    await this.hydrateFromStore();
    if (this.isAdvancing || this.currentEntry) {
      return;
    }
    this.isAdvancing = true;

    try {
      if (this.queue.length === 0) {
        await this._refillQueueFromPolicies();
      }

      if (this.queue.length === 0) {
        if (this.settings.leaveAfterQueueEmpty) {
          await this.disconnect();
          return;
        }
        await this.persist();
        return;
      }

      this.currentEntry = this.queue.shift();
      this.skipRequested = false;
      this.disconnectRequested = false;
      const playbackSource = await this.mediaResolver.getPlaybackSource(this.currentEntry);
      const resource = this._createAudioResource(playbackSource, this.currentEntry);

      this.pendingIdleAction = "advance";
      this._resetProgressClock();
      this.playStartedAt = Date.now();
      this.audioPlayer.play(resource);
      await this.persist();
    } finally {
      this.isAdvancing = false;
    }
  }

  async _refillQueueFromPolicies() {
    if (this.settings.autoplayEnabled && this.autoplaylist.length > 0) {
      const picked = chooseNextAutoplayEntry(
        this.autoplaylist,
        this.lastPlayedEntry
      );
      if (picked) {
        this.queue.push({
          id: `${Date.now()}-autoplay`,
          title: picked.title || picked.source,
          artist: "",
          query: picked.source,
          originalUrl: picked.source,
          webpageUrl: picked.source,
          searchQuery: "",
          durationSeconds: null,
          thumbnailUrl: "",
          requestedById: null,
          requestedByName: "Autoplaylist",
          sourceMode: "play",
          sourceOrigin: "autoplay",
          addedAt: new Date().toISOString(),
          startTimeSeconds: 0
        });
        return;
      }
    }

    if (this.settings.autosimilarEnabled && this.lastPlayedEntry) {
      const autosimilarQuery = buildAutosimilarQuery(this.lastPlayedEntry);
      if (autosimilarQuery) {
        const entries = await this.mediaResolver.resolveEntries(autosimilarQuery, {
          sourceMode: "play",
          sourceOrigin: "autosimilar"
        });
        const picked = chooseAutosimilarEntry(entries, this.lastPlayedEntry);
        if (picked) {
          picked.sourceOrigin = "autosimilar";
          this.queue.push(picked);
        }
      }
    }
  }

  async _handleIdle() {
    const action = this.pendingIdleAction;
    this.pendingIdleAction = "advance";
    const skipped = this.skipRequested;
    this.skipRequested = false;
    this.disconnectRequested = false;
    const finishedEntry = this.currentEntry;
    if (finishedEntry && !skipped) {
      this.lastPlayedEntry = finishedEntry;
    }
    this.currentEntry = null;
    this._resetProgressClock();
    this._cleanupFfmpeg();

    if (action === "disconnect") {
      this._destroyConnection();
      await this.persist();
      return;
    }

    if (action === "halt") {
      await this.persist();
      return;
    }

    await this.playNext();
  }

  async pause() {
    if (!this.currentEntry || this.audioPlayer.state.status !== AudioPlayerStatus.Playing) {
      return false;
    }
    this.pauseStartedAt = Date.now();
    this.audioPlayer.pause();
    await this.persist();
    return true;
  }

  async resume() {
    if (!this.currentEntry || this.audioPlayer.state.status !== AudioPlayerStatus.Paused) {
      return false;
    }
    if (this.pauseStartedAt) {
      this.pausedAccumulatedMs += Date.now() - this.pauseStartedAt;
      this.pauseStartedAt = 0;
    }
    this.audioPlayer.unpause();
    await this.persist();
    return true;
  }

  async skip() {
    if (!this.currentEntry) {
      return false;
    }
    this.skipRequested = true;
    this.pendingIdleAction = "advance";
    this.audioPlayer.stop(true);
    return true;
  }

  async disconnect() {
    this.disconnectRequested = true;
    this.pendingIdleAction = "disconnect";
    if (this.currentEntry) {
      this.audioPlayer.stop(true);
      return;
    }

    this._destroyConnection();
    await this.persist();
  }

  async setVolume(percent) {
    this.settings.defaultVolume = Math.max(0.01, Math.min(1, Number(percent) / 100));
    const resource = this.audioPlayer.state.resource;
    if (resource && resource.volume) {
      resource.volume.setVolume(this.settings.defaultVolume);
    }
    await this.persist();
  }

  async clearQueue() {
    this.queue = [];
    await this.persist();
  }

  async removeQueueIndex(index) {
    if (index < 0 || index >= this.queue.length) {
      return null;
    }
    const [removed] = this.queue.splice(index, 1);
    await this.persist();
    return removed;
  }

  async shuffleQueue() {
    this.queue = shuffleEntries(this.queue);
    await this.persist();
  }

  getQueueLines() {
    return this.queue.map((entry, index) => `${index + 1}. ${entry.title}`);
  }

  getNowPlayingText() {
    if (!this.currentEntry) {
      return "Nothing is currently playing.";
    }

    const duration = this.currentEntry.durationSeconds
      ? ` / ${Math.floor(this.currentEntry.durationSeconds)}s`
      : "";
    return `Now playing: **${this.currentEntry.title}** (${Math.floor(
      this.getProgressSeconds()
    )}s${duration})`;
  }

  getLatency() {
    const wsPing =
      this.connection &&
      this.connection.ping &&
      Number.isFinite(this.connection.ping.ws)
        ? this.connection.ping.ws
        : 0;
    return {
      wsMs: Number(wsPing || 0)
    };
  }

  async updateAutoplaySettings(enabled) {
    this.settings.autoplayEnabled = Boolean(enabled);
    await this.persist();
  }

  async updateAutosimilarSettings(enabled) {
    this.settings.autosimilarEnabled = Boolean(enabled);
    await this.persist();
  }

  async addAutoplaySource(source, title = "") {
    const added = this.store.addAutoplaylistEntry(this.guild.id, { source, title });
    this.autoplaylist = this.store.getAutoplaylist(this.guild.id);
    return added;
  }

  async removeAutoplaySource(source) {
    const removed = this.store.removeAutoplaylistEntry(this.guild.id, source);
    this.autoplaylist = this.store.getAutoplaylist(this.guild.id);
    return removed;
  }

  serializeSnapshot() {
    return {
      guildId: this.guild.id,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      settings: this.settings,
      queue: this.queue,
      currentEntry: this.currentEntry,
      progressSeconds: this.getProgressSeconds(),
      updatedAt: new Date().toISOString()
    };
  }

  async persist() {
    this.store.saveGuildSettings(this.guild.id, this.settings);
    this.store.saveQueueSnapshot(this.guild.id, this.serializeSnapshot());
  }
}

class GuildPlaybackManager {
  constructor(app) {
    this.app = app;
    this.players = new Map();
  }

  async get(guild) {
    let player = this.players.get(guild.id);
    if (!player) {
      player = new GuildPlayer(this.app, guild);
      this.players.set(guild.id, player);
    }
    await player.hydrateFromStore();
    return player;
  }

  getAll() {
    return [...this.players.values()];
  }

  async recoverAll(guilds) {
    for (const guild of guilds.values()) {
      const player = await this.get(guild);
      await player.recoverAfterStartup();
    }
  }
}

module.exports = {
  GuildPlaybackManager,
  GuildPlayer
};
