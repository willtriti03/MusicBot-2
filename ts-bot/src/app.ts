const {
  ApplicationCommandOptionType,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const { MediaResolver } = require("./media");
const { GuildPlaybackManager } = require("./player");
const { getDaveRuntimeSummary } = require("./dave");

const EPHEMERAL_FLAGS = MessageFlags.Ephemeral;
const EMBED_COLORS = {
  info: 0x2563eb,
  success: 0x0f766e,
  warn: 0xc2410c,
  danger: 0xbe123c,
  neutral: 0x334155
};
const MAX_EMBED_TITLE = 256;
const MAX_EMBED_DESCRIPTION = 4096;
const MAX_EMBED_FIELD_NAME = 256;
const MAX_EMBED_FIELD_VALUE = 1024;
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
        const payload = this._buildEmbedPayload(
          interaction,
          {
            tone: "danger",
            title: "Command failed",
            description: message,
            fields: interaction.commandName
              ? [{ name: "Command", value: `/${interaction.commandName}`, inline: true }]
              : []
          },
          interaction.deferred || interaction.replied ? {} : { flags: EPHEMERAL_FLAGS }
        );
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

  _truncate(value, maxLength) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  _displayNameForMember(member, fallback = "Unknown") {
    if (member && typeof member === "object") {
      if (typeof member.displayName === "string" && member.displayName) {
        return member.displayName;
      }
      if (typeof member.username === "string" && member.username) {
        return member.username;
      }
      if (member.user && typeof member.user.username === "string" && member.user.username) {
        return member.user.username;
      }
    }
    return fallback;
  }

  _formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds === null || seconds === undefined) {
      return "Live";
    }

    const totalSeconds = Math.max(0, Math.floor(Number(seconds)));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  _formatProgressBar(currentSeconds, totalSeconds, width = 14) {
    const safeWidth = Math.max(6, Math.floor(Number(width) || 14));
    const total = Number(totalSeconds);
    const current = Number(currentSeconds);

    if (!Number.isFinite(total) || total <= 0) {
      const midpoint = Math.floor((safeWidth - 1) / 2);
      return `[${"=".repeat(midpoint)}>${"-".repeat(safeWidth - midpoint - 1)}]`;
    }

    const ratio = Math.min(1, Math.max(0, current / total));
    const markerIndex = Math.min(safeWidth - 1, Math.round(ratio * (safeWidth - 1)));
    let output = "[";
    for (let index = 0; index < safeWidth; index += 1) {
      if (index < markerIndex) {
        output += "=";
      } else if (index === markerIndex) {
        output += ">";
      } else {
        output += "-";
      }
    }
    output += "]";
    return output;
  }

  _formatMeter(value, maximum = 100, width = 10) {
    const safeMaximum = Math.max(1, Number(maximum) || 100);
    const clampedValue = Math.min(safeMaximum, Math.max(0, Number(value) || 0));
    return this._formatProgressBar(clampedValue, safeMaximum, width);
  }

  _describeSourceMode(mode) {
    return mode === "stream" ? "Direct stream" : "Cached playback";
  }

  _describeSourceOrigin(origin) {
    switch (origin) {
      case "autoplay":
        return "Autoplaylist";
      case "autosimilar":
        return "Autosimilar";
      default:
        return "Manual";
    }
  }

  _formatTrackTitle(entry) {
    const title = this._truncate(entry && entry.title ? entry.title : "Unknown track", 80);
    const artist = entry && entry.artist ? ` - ${this._truncate(entry.artist, 32)}` : "";
    return `${title}${artist}`;
  }

  _formatTrackLine(entry, index) {
    const position = String(index).padStart(2, "0");
    const duration = this._formatDuration(entry ? entry.durationSeconds : null);
    return `\`${position}\` ${this._truncate(this._formatTrackTitle(entry), 70)} | ${duration}`;
  }

  _formatQueuePreview(entries, options = {}) {
    const startIndex = Number(options.startIndex || 1);
    const limit = Number(options.limit || 5);
    if (!Array.isArray(entries) || entries.length === 0) {
      return "No tracks waiting.";
    }

    const lines = entries
      .slice(0, limit)
      .map((entry, index) => this._formatTrackLine(entry, startIndex + index));

    if (entries.length > limit) {
      lines.push(`...and ${entries.length - limit} more.`);
    }

    return this._truncate(lines.join("\n"), MAX_EMBED_FIELD_VALUE);
  }

  _getKnownDurationSeconds(entries) {
    if (!Array.isArray(entries)) {
      return 0;
    }

    return entries.reduce((total, entry) => {
      if (!entry || !Number.isFinite(entry.durationSeconds)) {
        return total;
      }
      return total + Math.max(0, Number(entry.durationSeconds));
    }, 0);
  }

  _createEmbed(interaction, options = {}) {
    const tone = options.tone && EMBED_COLORS[options.tone] ? options.tone : "info";
    const embed = new EmbedBuilder().setColor(EMBED_COLORS[tone]).setTimestamp(new Date());

    if (this.client.user) {
      embed.setAuthor({
        name: this.client.user.displayName || this.client.user.username,
        iconURL: this.client.user.displayAvatarURL()
      });
    }

    if (options.title) {
      embed.setTitle(this._truncate(options.title, MAX_EMBED_TITLE));
    }
    if (options.description) {
      embed.setDescription(this._truncate(options.description, MAX_EMBED_DESCRIPTION));
    }
    if (options.url) {
      embed.setURL(options.url);
    }
    if (options.thumbnailUrl) {
      embed.setThumbnail(options.thumbnailUrl);
    }
    if (options.imageUrl) {
      embed.setImage(options.imageUrl);
    }

    const fields = Array.isArray(options.fields)
      ? options.fields
          .filter((field) => field && field.name && field.value)
          .slice(0, 25)
          .map((field) => ({
            name: this._truncate(field.name, MAX_EMBED_FIELD_NAME),
            value: this._truncate(field.value, MAX_EMBED_FIELD_VALUE),
            inline: Boolean(field.inline)
          }))
      : [];

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    const footerParts = [
      interaction.guild ? interaction.guild.name : null,
      options.footerText || null
    ].filter(Boolean);
    if (footerParts.length > 0) {
      embed.setFooter({
        text: this._truncate(footerParts.join(" | "), 2048)
      });
    }

    return embed;
  }

  _buildEmbedPayload(interaction, options = {}, extra = {}) {
    const payload = {
      embeds: [this._createEmbed(interaction, options)]
    };
    if (extra.flags !== undefined) {
      payload.flags = extra.flags;
    }
    return payload;
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
    const queueDepthBefore = player.queue.length + (player.currentEntry ? 1 : 0);
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
    const leadEntry = entries[0];
    const startedImmediately =
      Boolean(player.currentEntry) && player.currentEntry.id === leadEntry.id;
    const requestedBy =
      leadEntry.requestedByName ||
      this._displayNameForMember(interaction.member, interaction.user.username);
    await interaction.editReply(
      this._buildEmbedPayload(interaction, {
        tone: "success",
        title: entries.length === 1 ? "Added to queue" : `Queued ${entries.length} tracks`,
        description:
          entries.length === 1
            ? `**${this._formatTrackTitle(leadEntry)}**`
            : `**${this._formatTrackTitle(leadEntry)}**\nand ${entries.length - 1} more track(s).`,
        url: leadEntry.webpageUrl || leadEntry.originalUrl || leadEntry.query,
        thumbnailUrl: leadEntry.thumbnailUrl || undefined,
        fields: [
          {
            name: "Status",
            value: startedImmediately ? "Playing now" : `Queued at #${queueDepthBefore + 1}`,
            inline: true
          },
          {
            name: "Mode",
            value: this._describeSourceMode(sourceMode),
            inline: true
          },
          {
            name: "Voice",
            value: voiceChannel.name,
            inline: true
          },
          {
            name: "Requested by",
            value: requestedBy,
            inline: true
          },
          {
            name: "Queue depth",
            value: `${player.queue.length + (player.currentEntry ? 1 : 0)} active track(s)`,
            inline: true
          },
          {
            name: "Up next",
            value: this._formatQueuePreview(player.queue, { limit: 4 }),
            inline: false
          }
        ]
      })
    );
  }

  async _handleSummon(interaction, player) {
    await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
    const voiceChannel = this._requireMemberVoiceChannel(interaction);
    await player.ensureConnection(voiceChannel, interaction.channelId);
    await interaction.editReply(
      this._buildEmbedPayload(interaction, {
        tone: "success",
        title: "Connected",
        description: `Voice session is ready in **${voiceChannel.name}**.`,
        fields: [
          {
            name: "Volume",
            value: `\`${this._formatMeter(player.getVolumePercent(), 100, 10)}\` ${player.getVolumePercent()}%`,
            inline: true
          },
          {
            name: "Queue",
            value: `${player.queue.length + (player.currentEntry ? 1 : 0)} active track(s)`,
            inline: true
          }
        ]
      })
    );
  }

  async _handleSkip(interaction, player) {
    const skipped = await player.skip();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: skipped ? "success" : "warn",
        title: skipped ? "Skipped" : "Nothing to skip",
        description: skipped
          ? "Moved playback to the next track."
          : "Nothing is currently playing."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handlePause(interaction, player) {
    const paused = await player.pause();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: paused ? "warn" : "neutral",
        title: paused ? "Playback paused" : "Nothing is playing",
        description: paused
          ? "The current track has been paused."
          : "Playback is not currently running."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleResume(interaction, player) {
    const resumed = await player.resume();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: resumed ? "success" : "neutral",
        title: resumed ? "Playback resumed" : "Nothing to resume",
        description: resumed
          ? "The current track is playing again."
          : "Playback is not currently paused."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleQueue(interaction, player) {
    const totalActive = player.queue.length + (player.currentEntry ? 1 : 0);
    const queuedDurationSeconds = this._getKnownDurationSeconds(player.queue);
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: totalActive > 0 ? "info" : "neutral",
        title: totalActive > 0 ? "Queue snapshot" : "Queue is empty",
        description: player.currentEntry
          ? `Currently locked on **${this._formatTrackTitle(player.currentEntry)}**.`
          : "Nothing is currently playing.",
        thumbnailUrl:
          (player.currentEntry && player.currentEntry.thumbnailUrl) ||
          (player.queue[0] && player.queue[0].thumbnailUrl) ||
          undefined,
        fields: player.currentEntry
          ? [
              {
                name: "Now playing",
                value:
                  `${this._formatTrackTitle(player.currentEntry)}\n` +
                  `\`${this._formatDuration(player.getProgressSeconds())} / ${this._formatDuration(player.currentEntry.durationSeconds)}\`\n` +
                  `\`${this._formatProgressBar(player.getProgressSeconds(), player.currentEntry.durationSeconds, 16)}\``,
                inline: false
              },
              {
                name: `Up next (${player.queue.length})`,
                value: this._formatQueuePreview(player.queue, { limit: 8 }),
                inline: false
              },
              {
                name: "Queued time",
                value: queuedDurationSeconds > 0 ? this._formatDuration(queuedDurationSeconds) : "Unknown",
                inline: true
              },
              {
                name: "Volume",
                value: `${player.getVolumePercent()}%`,
                inline: true
              },
              {
                name: "Refill",
                value:
                  `${player.settings.autoplayEnabled ? "Autoplaylist on" : "Autoplaylist off"}\n` +
                  `${player.settings.autosimilarEnabled ? "Autosimilar on" : "Autosimilar off"}`,
                inline: true
              }
            ]
          : [
              {
                name: `Up next (${player.queue.length})`,
                value: this._formatQueuePreview(player.queue, { limit: 8 }),
                inline: false
              }
            ]
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleNowPlaying(interaction, player) {
    if (!player.currentEntry) {
      await interaction.reply({
        ...this._buildEmbedPayload(interaction, {
          tone: "neutral",
          title: "Nothing is playing",
          description: "Start a track with `/play` or `/stream`."
        }),
        flags: EPHEMERAL_FLAGS
      });
      return;
    }

    const entry = player.currentEntry;
    const progressSeconds = player.getProgressSeconds();
    const hasDuration = Number.isFinite(entry.durationSeconds) && Number(entry.durationSeconds) > 0;
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "success",
        title: this._formatTrackTitle(entry),
        description: `${this._describeSourceMode(entry.sourceMode)} | ${this._describeSourceOrigin(entry.sourceOrigin)}`,
        url: entry.webpageUrl || entry.originalUrl || entry.query,
        thumbnailUrl: entry.thumbnailUrl || undefined,
        fields: [
          {
            name: "Progress",
            value:
              `\`${this._formatProgressBar(progressSeconds, entry.durationSeconds, 18)}\`\n` +
              `\`${this._formatDuration(progressSeconds)} / ${hasDuration ? this._formatDuration(entry.durationSeconds) : "Live"}\``,
            inline: false
          },
          {
            name: "Requested by",
            value: entry.requestedByName || "System",
            inline: true
          },
          {
            name: "Queue",
            value: `${player.queue.length} waiting`,
            inline: true
          },
          {
            name: "Volume",
            value: `${player.getVolumePercent()}%`,
            inline: true
          },
          {
            name: "Up next",
            value: player.queue[0] ? this._formatTrackTitle(player.queue[0]) : "No tracks waiting.",
            inline: false
          }
        ]
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleVolume(interaction, player) {
    const level = interaction.options.getInteger("level", true);
    await player.setVolume(level);
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "info",
        title: "Volume updated",
        description: `\`${this._formatMeter(level, 100, 12)}\` ${level}%`,
        fields: [
          {
            name: "Output",
            value: player.currentEntry ? "Applied to the current track." : "Ready for the next track.",
            inline: false
          }
        ]
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleDisconnect(interaction, player) {
    await player.disconnect();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "neutral",
        title: "Disconnected",
        description: "Left the voice channel and cleared the live connection."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleAutoplaylist(interaction, player) {
    this._ensureManageGuild(interaction);
    const action = interaction.options.getString("action", true);
    const value = interaction.options.getString("value");

    if (action === "list") {
      const preview = player.autoplaylist
        .slice(0, 8)
        .map((entry, index) => {
          const label = entry.title || entry.source;
          return `\`${String(index + 1).padStart(2, "0")}\` ${this._truncate(label, 78)}`;
        })
        .join("\n");
      await interaction.reply({
        ...this._buildEmbedPayload(interaction, {
          tone: player.autoplaylist.length > 0 ? "info" : "neutral",
          title: "Autoplaylist",
          description:
            player.autoplaylist.length > 0
              ? `${player.autoplaylist.length} saved track(s) ready for refill.`
              : "Autoplaylist is empty.",
          fields: player.autoplaylist.length > 0
            ? [
                {
                  name: "Entries",
                  value:
                    this._truncate(preview, MAX_EMBED_FIELD_VALUE) +
                    (player.autoplaylist.length > 8
                      ? `\n...and ${player.autoplaylist.length - 8} more.`
                      : ""),
                  inline: false
                },
                {
                  name: "Refill",
                  value: player.settings.autoplayEnabled ? "Enabled" : "Disabled",
                  inline: true
                }
              ]
            : []
        }),
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
        ...this._buildEmbedPayload(interaction, {
          tone: player.settings.autoplayEnabled ? "success" : "warn",
          title: "Autoplaylist refill updated",
          description: `Autoplaylist refill is now **${player.settings.autoplayEnabled ? "enabled" : "disabled"}**.`
        }),
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
        ...this._buildEmbedPayload(interaction, {
          tone: added ? "success" : "warn",
          title: added ? "Autoplaylist updated" : "Already saved",
          description: added
            ? "Added this source to the autoplaylist."
            : "That track is already in the autoplaylist."
        }),
        flags: EPHEMERAL_FLAGS
      });
      return;
    }

    if (action === "remove") {
      const removed = await player.removeAutoplaySource(value);
      await interaction.reply({
        ...this._buildEmbedPayload(interaction, {
          tone: removed ? "success" : "warn",
          title: removed ? "Autoplaylist updated" : "Nothing removed",
          description: removed
            ? "Removed this source from the autoplaylist."
            : "That track was not present in the autoplaylist."
        }),
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
      ...this._buildEmbedPayload(interaction, {
        tone: enabled ? "success" : "warn",
        title: "Autosimilar updated",
        description: `Autosimilar is now **${enabled ? "enabled" : "disabled"}**.`
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleShuffle(interaction, player) {
    await player.shuffleQueue();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "success",
        title: "Queue shuffled",
        description: "The waiting tracks were reordered."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleClear(interaction, player) {
    await player.clearQueue();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "warn",
        title: "Queue cleared",
        description: "All waiting tracks have been removed."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleRemove(interaction, player) {
    const index = interaction.options.getInteger("index", true) - 1;
    const removed = await player.removeQueueIndex(index);
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: removed ? "success" : "warn",
        title: removed ? "Removed from queue" : "Nothing removed",
        description: removed
          ? `Removed **${this._formatTrackTitle(removed)}** from the queue.`
          : "No queued track exists at that index."
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleLatency(interaction, player) {
    const voiceLatency = player.getLatency();
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "info",
        title: "Latency",
        description: "Current gateway and voice timings.",
        fields: [
          {
            name: "Discord API",
            value: `${Math.round(this.client.ws.ping)} ms`,
            inline: true
          },
          {
            name: "Voice",
            value: `${Math.round(voiceLatency.wsMs)} ms`,
            inline: true
          },
          {
            name: "State",
            value: player.currentEntry ? "Connected" : "Idle",
            inline: true
          }
        ]
      }),
      flags: EPHEMERAL_FLAGS
    });
  }

  async _handleBotLatency(interaction) {
    const lines = this.playback.getAll().map((player) => {
      const latency = player.getLatency();
      return `${player.guild.name}: ${Math.round(latency.wsMs)} ms`;
    });
    await interaction.reply({
      ...this._buildEmbedPayload(interaction, {
        tone: "info",
        title: "Bot latency overview",
        description: `Discord API latency is **${Math.round(this.client.ws.ping)} ms**.`,
        fields: [
          {
            name: "Guild voice latency",
            value:
              lines.length > 0
                ? this._truncate(lines.join("\n"), MAX_EMBED_FIELD_VALUE)
                : "No active voice sessions.",
            inline: false
          }
        ]
      }),
      flags: EPHEMERAL_FLAGS
    });
  }
}

module.exports = {
  MusicBotApp
};
