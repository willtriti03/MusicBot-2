const {
  ApplicationCommandOptionType,
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const { MediaResolver } = require("./media");
const { GuildPlaybackManager } = require("./player");
const { getDaveRuntimeSummary } = require("./dave");

const EPHEMERAL_FLAGS = MessageFlags.Ephemeral;
const LEGACY_REMOVED_COMMANDS = new Set([
  "listen",
  "stoplisten",
  "seek",
  "speed",
  "restart",
  "shutdown",
  "config",
  "perms"
]);

class MusicBotApp {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    this.mediaResolver = new MediaResolver(config);
    this.playback = new GuildPlaybackManager(this);
    this.backgroundTasks = new Set();
    this._wireClient();
  }

  log(level, message) {
    const normalized = String(level || "info").toLowerCase();
    const prefix = `[${new Date().toISOString()}]`;
    if (normalized === "error") {
      console.error(prefix, message);
      return;
    }
    if (normalized === "warn") {
      console.warn(prefix, message);
      return;
    }
    if (normalized === "debug" && this.config.logLevel !== "debug") {
      return;
    }
    console.log(prefix, message);
  }

  enqueueBackgroundTask(promise) {
    const tracked = Promise.resolve(promise)
      .catch((error) => {
        this.log(
          "error",
          error && error.stack ? error.stack : String(error)
        );
      })
      .finally(() => {
        this.backgroundTasks.delete(tracked);
      });
    this.backgroundTasks.add(tracked);
    return tracked;
  }

  async start() {
    if (!this.config.discordToken) {
      throw new Error("DISCORD_TOKEN is not configured.");
    }
    const daveRuntime = getDaveRuntimeSummary();
    this.log("info", daveRuntime.summary);
    for (const warning of this.mediaResolver.getStartupWarnings()) {
      this.log("warn", warning);
    }
    if (this.config.loadedEnvPath) {
      this.log("info", `Loaded environment from ${this.config.loadedEnvPath}`);
    }
    await this.client.login(this.config.discordToken);
  }

  async stop() {
    for (const player of this.playback.getAll()) {
      await player.persist();
      await player.disconnect();
    }
    await Promise.allSettled([...this.backgroundTasks]);
    await this.client.destroy();
    this.store.close();
  }

  _wireClient() {
    this.client.once("clientReady", async () => {
      this.log("info", `Logged in as ${this.client.user.tag}`);
      await this._registerCommands();
      await this.playback.recoverAll(this.client.guilds.cache);
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      try {
        await this._dispatchInteraction(interaction);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        this.log("error", message);
        const payload = {
          content: message,
          flags: EPHEMERAL_FLAGS
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload).catch(() => null);
        } else {
          await interaction.reply(payload).catch(() => null);
        }
      }
    });
  }

  _createCommandDefinitions() {
    return [
      {
        name: "play",
        description: "Queue a track and download/cache it before playback.",
        options: [
          {
            name: "query",
            description: "URL or search query",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      },
      {
        name: "stream",
        description: "Queue a track for direct stream playback.",
        options: [
          {
            name: "query",
            description: "URL or search query",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      },
      { name: "summon", description: "Join your current voice channel." },
      { name: "skip", description: "Skip the current track." },
      { name: "pause", description: "Pause the current track." },
      { name: "resume", description: "Resume paused playback." },
      { name: "queue", description: "Show the current queue." },
      { name: "np", description: "Show the current song and progress." },
      {
        name: "volume",
        description: "Set playback volume as a percentage.",
        options: [
          {
            name: "level",
            description: "Volume between 1 and 100",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1,
            max_value: 100
          }
        ]
      },
      { name: "disconnect", description: "Disconnect from voice." },
      {
        name: "autoplaylist",
        description: "Manage the guild autoplaylist.",
        options: [
          {
            name: "action",
            description: "Autoplaylist action",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" },
              { name: "toggle", value: "toggle" }
            ]
          },
          {
            name: "value",
            description: "URL for add/remove, or on/off for toggle",
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: "autosimilar",
        description: "Enable or disable queue refill from similar songs.",
        options: [
          {
            name: "enabled",
            description: "Whether autosimilar is enabled",
            type: ApplicationCommandOptionType.Boolean,
            required: true
          }
        ]
      },
      { name: "shuffle", description: "Shuffle the queued tracks." },
      { name: "clear", description: "Clear all queued tracks." },
      {
        name: "remove",
        description: "Remove a queued track by its displayed queue index.",
        options: [
          {
            name: "index",
            description: "Queue index starting at 1",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1
          }
        ]
      },
      { name: "latency", description: "Show API and voice latency for this guild." },
      { name: "botlatency", description: "Show API and voice latency for all guild players." }
    ];
  }

  async _registerCommands() {
    const commands = this._createCommandDefinitions();
    if (this.config.commandGuildIds.length > 0) {
      for (const guildId of this.config.commandGuildIds) {
        const guild = await this.client.guilds.fetch(guildId).catch(() => null);
        if (guild) {
          await guild.commands.set(commands);
        }
      }
      return;
    }
    await this.client.application.commands.set(commands);
  }

  _requireGuild(interaction) {
    if (!interaction.guild) {
      throw new Error("This command can only be used in a server.");
    }
    return interaction.guild;
  }

  _requireMemberVoiceChannel(interaction) {
    const memberVoice = interaction.member && interaction.member.voice;
    if (!memberVoice || !memberVoice.channel) {
      throw new Error("You must be connected to a voice channel.");
    }
    if (
      memberVoice.channel.type !== ChannelType.GuildVoice &&
      memberVoice.channel.type !== ChannelType.GuildStageVoice
    ) {
      throw new Error("Unsupported voice channel type.");
    }
    return memberVoice.channel;
  }

  _ensureManageGuild(interaction) {
    if (
      !interaction.memberPermissions ||
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      throw new Error("Manage Server permission is required for this command.");
    }
  }

  async _dispatchInteraction(interaction) {
    const guild = this._requireGuild(interaction);
    const player = await this.playback.get(guild);

    switch (interaction.commandName) {
      case "play":
        return this._handlePlay(interaction, player, "play");
      case "stream":
        return this._handlePlay(interaction, player, "stream");
      case "summon":
        return this._handleSummon(interaction, player);
      case "skip":
        return this._handleSkip(interaction, player);
      case "pause":
        return this._handlePause(interaction, player);
      case "resume":
        return this._handleResume(interaction, player);
      case "queue":
        return this._handleQueue(interaction, player);
      case "np":
        return this._handleNowPlaying(interaction, player);
      case "volume":
        return this._handleVolume(interaction, player);
      case "disconnect":
        return this._handleDisconnect(interaction, player);
      case "autoplaylist":
        return this._handleAutoplaylist(interaction, player);
      case "autosimilar":
        return this._handleAutosimilar(interaction, player);
      case "shuffle":
        return this._handleShuffle(interaction, player);
      case "clear":
        return this._handleClear(interaction, player);
      case "remove":
        return this._handleRemove(interaction, player);
      case "latency":
        return this._handleLatency(interaction, player);
      case "botlatency":
        return this._handleBotLatency(interaction);
      default:
        if (LEGACY_REMOVED_COMMANDS.has(interaction.commandName)) {
          throw new Error(
            `/${interaction.commandName} is not available in the TypeScript runtime. Remove stale slash commands and use the supported slash commands only.`
          );
        }
        throw new Error(`Unsupported command: ${interaction.commandName}`);
    }
  }

  async _handlePlay(interaction, player, sourceMode) {
    await interaction.deferReply();
    const voiceChannel = this._requireMemberVoiceChannel(interaction);
    await player.ensureConnection(voiceChannel, interaction.channelId);
    const query = interaction.options.getString("query", true);
    const entries = await this.mediaResolver.resolveEntries(query, {
      requestedBy: interaction.member,
      sourceMode,
      sourceOrigin: "manual"
    });
    if (entries.length === 0) {
      throw new Error("No playable results were found.");
    }
    await player.enqueue(entries, { textChannelId: interaction.channelId });
    await player.playNext();
    await interaction.editReply(
      `Queued ${entries.length} track(s). First up: **${entries[0].title}**`
    );
  }

  async _handleSummon(interaction, player) {
    await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
    const voiceChannel = this._requireMemberVoiceChannel(interaction);
    await player.ensureConnection(voiceChannel, interaction.channelId);
    await interaction.editReply(`Connected to **${voiceChannel.name}**.`);
  }

  async _handleSkip(interaction, player) {
    const skipped = await player.skip();
    await interaction.reply({
      content: skipped ? "Skipped the current track." : "Nothing is currently playing.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handlePause(interaction, player) {
    const paused = await player.pause();
    await interaction.reply({
      content: paused ? "Paused playback." : "Playback is not currently running.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleResume(interaction, player) {
    const resumed = await player.resume();
    await interaction.reply({
      content: resumed ? "Resumed playback." : "Playback is not currently paused.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleQueue(interaction, player) {
    const lines = player.getQueueLines();
    await interaction.reply({
      content: lines.length > 0 ? lines.join("\n") : "The queue is empty.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleNowPlaying(interaction, player) {
    await interaction.reply({
      content: player.getNowPlayingText(),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleVolume(interaction, player) {
    const level = interaction.options.getInteger("level", true);
    await player.setVolume(level);
    await interaction.reply({
      content: `Volume set to **${level}%**.`,
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleDisconnect(interaction, player) {
    await player.disconnect();
    await interaction.reply({
      content: "Disconnected from voice.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleAutoplaylist(interaction, player) {
    this._ensureManageGuild(interaction);
    const action = interaction.options.getString("action", true);
    const value = interaction.options.getString("value");

    if (action === "list") {
      await interaction.reply({
        content:
          player.autoplaylist.length > 0
            ? player.autoplaylist
                .map((entry, index) => `${index + 1}. ${entry.title || entry.source}`)
                .join("\n")
            : "Autoplaylist is empty.",
        flags: EPHEMERAL_FLAGS
      });
      return;
    }

    if (action === "toggle") {
      const enabled = String(value || "").toLowerCase();
      if (!["on", "off", "true", "false"].includes(enabled)) {
        throw new Error("Use `on` or `off` with autoplaylist toggle.");
      }
      await player.updateAutoplaySettings(enabled === "on" || enabled === "true");
      await interaction.reply({
        content: `Autoplaylist refill is now **${player.settings.autoplayEnabled ? "enabled" : "disabled"}**.`,
        flags: EPHEMERAL_FLAGS
      });
      return;
    }

    if (!value) {
      throw new Error("This autoplaylist action requires a value.");
    }

    if (action === "add") {
      const added = await player.addAutoplaySource(value, value);
      await interaction.reply({
        content: added
          ? "Added track to the autoplaylist."
          : "That track is already in the autoplaylist.",
        flags: EPHEMERAL_FLAGS
      });
      return;
    }

    if (action === "remove") {
      const removed = await player.removeAutoplaySource(value);
      await interaction.reply({
        content: removed
          ? "Removed track from the autoplaylist."
          : "That track was not present in the autoplaylist.",
        flags: EPHEMERAL_FLAGS
      });
      return;
    }

    throw new Error(`Unsupported autoplaylist action: ${action}`);
  }

  async _handleAutosimilar(interaction, player) {
    this._ensureManageGuild(interaction);
    const enabled = interaction.options.getBoolean("enabled", true);
    await player.updateAutosimilarSettings(enabled);
    await interaction.reply({
      content: `Autosimilar is now **${enabled ? "enabled" : "disabled"}**.`,
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleShuffle(interaction, player) {
    await player.shuffleQueue();
    await interaction.reply({
      content: "Shuffled the queue.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleClear(interaction, player) {
    await player.clearQueue();
    await interaction.reply({
      content: "Cleared the queued tracks.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleRemove(interaction, player) {
    const index = interaction.options.getInteger("index", true) - 1;
    const removed = await player.removeQueueIndex(index);
    await interaction.reply({
      content: removed
        ? `Removed **${removed.title}** from the queue.`
        : "No queued track exists at that index.",
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleLatency(interaction, player) {
    const voiceLatency = player.getLatency();
    await interaction.reply({
      content: `API latency: **${Math.round(this.client.ws.ping)} ms**\nVoice latency: **${Math.round(
        voiceLatency.wsMs
      )} ms**`,
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleBotLatency(interaction) {
    const lines = this.playback.getAll().map((player) => {
      const latency = player.getLatency();
      return `${player.guild.name}: ${Math.round(latency.wsMs)} ms`;
    });
    await interaction.reply({
      content:
        `API latency: **${Math.round(this.client.ws.ping)} ms**\n` +
        (lines.length > 0 ? lines.join("\n") : "No active voice sessions."),
      flags: EPHEMERAL_FLAGS
    });
  }
}

module.exports = {
  MusicBotApp
};
