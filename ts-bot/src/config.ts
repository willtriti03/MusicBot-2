const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const DEFAULT_CONFIG = {
  logLevel: "info",
  ffmpegPath: "ffmpeg",
  ytdlpPath: "yt-dlp",
  databasePath: "data/musicbot.sqlite",
  instanceLockPath: "",
  cacheDir: "audio_cache",
  tempDir: "data/tmp",
  commandGuildIds: [],
  defaultGuildSettings: {
    defaultVolume: 0.2,
    autoplayEnabled: true,
    autosimilarEnabled: true,
    leaveAfterQueueEmpty: false,
    leaveAfterIdleSeconds: 300
  }
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeConfig(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function resolveFromRoot(rootDir, value) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function buildDefaultInstanceLockPath(configPath, databasePath, discordToken) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${configPath}\n${discordToken || ""}`)
    .digest("hex")
    .slice(0, 12);

  return path.join(
    path.dirname(databasePath),
    `musicbot-instance-${fingerprint}.lock`
  );
}

function parseEnvFile(contents) {
  const entries = {};
  for (const rawLine of String(contents || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function loadEnvFileIntoProcess(repoRoot) {
  const envPath =
    process.env.MUSICBOT_ENV_PATH || path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const entries = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(entries)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return envPath;
}

function loadConfig(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..", "..");
  const loadedEnvPath = loadEnvFileIntoProcess(repoRoot);
  const configPath =
    options.configPath ||
    process.env.MUSICBOT_CONFIG_PATH ||
    path.join(repoRoot, "config", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const merged = mergeConfig(DEFAULT_CONFIG, raw);
  const discordToken =
    process.env.DISCORD_TOKEN || process.env.MUSICBOT_DISCORD_TOKEN || "";
  const databasePath = resolveFromRoot(repoRoot, merged.databasePath);
  const configuredLockPath =
    process.env.MUSICBOT_INSTANCE_LOCK_PATH || merged.instanceLockPath;

  return {
    repoRoot,
    configPath,
    loadedEnvPath,
    logLevel: String(merged.logLevel || "info").toLowerCase(),
    ffmpegPath:
      process.env.MUSICBOT_FFMPEG_PATH ||
      process.env.FFMPEG_PATH ||
      merged.ffmpegPath ||
      "ffmpeg",
    ytdlpPath:
      process.env.MUSICBOT_YTDLP_PATH ||
      process.env.YTDLP_PATH ||
      merged.ytdlpPath ||
      "yt-dlp",
    databasePath,
    instanceLockPath:
      resolveFromRoot(repoRoot, configuredLockPath) ||
      buildDefaultInstanceLockPath(configPath, databasePath, discordToken),
    cacheDir: resolveFromRoot(repoRoot, merged.cacheDir),
    tempDir: resolveFromRoot(repoRoot, merged.tempDir),
    commandGuildIds: Array.isArray(merged.commandGuildIds)
      ? merged.commandGuildIds.map((value) => String(value))
      : [],
    defaultGuildSettings: {
      defaultVolume: Number(merged.defaultGuildSettings.defaultVolume || 0.2),
      autoplayEnabled: Boolean(merged.defaultGuildSettings.autoplayEnabled),
      autosimilarEnabled: Boolean(merged.defaultGuildSettings.autosimilarEnabled),
      leaveAfterQueueEmpty: Boolean(
        merged.defaultGuildSettings.leaveAfterQueueEmpty
      ),
      leaveAfterIdleSeconds: Number(
        merged.defaultGuildSettings.leaveAfterIdleSeconds || 300
      )
    },
    discordToken,
    spotifyClientId:
      process.env.SPOTIFY_CLIENT_ID ||
      process.env.MUSICBOT_SPOTIFY_CLIENT_ID ||
      "",
    spotifyClientSecret:
      process.env.SPOTIFY_CLIENT_SECRET ||
      process.env.MUSICBOT_SPOTIFY_CLIENT_SECRET ||
      ""
  };
}

function ensureRuntimeDirectories(config) {
  for (const directory of [path.dirname(config.databasePath), config.cacheDir, config.tempDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

module.exports = {
  DEFAULT_CONFIG,
  ensureRuntimeDirectories,
  loadConfig,
  loadEnvFileIntoProcess,
  mergeConfig,
  parseEnvFile
};
