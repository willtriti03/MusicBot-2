const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEPENDENCY_PROBES = {
  ffmpeg: ["-version"],
  "yt-dlp": ["--version"]
};

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isSpotifyUrl(value) {
  return /open\.spotify\.com\/(track|album|playlist)\//i.test(String(value || ""));
}

function parseSpotifyUrl(value) {
  const match = String(value || "").match(
    /open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/i
  );
  if (!match) {
    return null;
  }
  return {
    type: match[1].toLowerCase(),
    id: match[2]
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        reject(createMissingCommandError(command));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code}. ${stderr.trim() || stdout.trim()}`
        )
      );
    });
  });
}

function createMissingCommandError(command) {
  const envVar =
    command === "ffmpeg"
      ? "MUSICBOT_FFMPEG_PATH"
      : command === "yt-dlp"
        ? "MUSICBOT_YTDLP_PATH"
        : "";

  const envHint = envVar
    ? ` or point ${envVar} at the binary`
    : "";

  return new Error(
    `Missing required runtime command: ${command}. Install ${command}${envHint}.`
  );
}

function probeExternalCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: "ignore"
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      return {
        ok: false,
        error: createMissingCommandError(command)
      };
    }
    return {
      ok: false,
      error: result.error
    };
  }

  return {
    ok: result.status === 0
  };
}

class MediaResolver {
  constructor(config) {
    this.config = config;
    this.spotifyToken = null;
    this.spotifyTokenExpiresAt = 0;
    this.commandStatus = new Map();
  }

  _assertCommandAvailable(command, args) {
    const cached = this.commandStatus.get(command);
    if (cached === true) {
      return;
    }

    const probe = probeExternalCommand(command, args);
    if (!probe.ok) {
      throw probe.error || createMissingCommandError(command);
    }

    this.commandStatus.set(command, true);
  }

  getStartupWarnings() {
    const warnings = [];
    for (const [label, args] of Object.entries(DEPENDENCY_PROBES)) {
      const command =
        label === "ffmpeg" ? this.config.ffmpegPath : this.config.ytdlpPath;
      const probe = probeExternalCommand(command, args);
      if (!probe.ok) {
        warnings.push(
          probe.error && probe.error.message
            ? probe.error.message
            : `Failed to probe runtime command: ${command}`
        );
        continue;
      }
      this.commandStatus.set(command, true);
    }
    return warnings;
  }

  _createQueueEntry(data) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      title: data.title || "Unknown",
      artist: data.artist || "",
      query: data.query || "",
      originalUrl: data.originalUrl || data.query || "",
      webpageUrl: data.webpageUrl || data.originalUrl || data.query || "",
      searchQuery: data.searchQuery || "",
      durationSeconds:
        data.durationSeconds === null || data.durationSeconds === undefined
          ? null
          : Number(data.durationSeconds),
      thumbnailUrl: data.thumbnailUrl || "",
      requestedById: data.requestedById || null,
      requestedByName: data.requestedByName || "System",
      sourceMode: data.sourceMode || "play",
      sourceOrigin: data.sourceOrigin || "manual",
      addedAt: data.addedAt || new Date().toISOString(),
      startTimeSeconds: Number(data.startTimeSeconds || 0)
    };
  }

  async resolveEntries(query, options = {}) {
    if (isSpotifyUrl(query)) {
      return this.resolveSpotifyEntries(query, options);
    }

    const info = await this.extractInfo(query, {
      allowSearch: !isUrl(query)
    });

    return this.infoToQueueEntries(info, {
      query,
      requestedBy: options.requestedBy || null,
      sourceMode: options.sourceMode || "play",
      sourceOrigin: options.sourceOrigin || "manual"
    });
  }

  async extractInfo(query, options = {}) {
    this._assertCommandAvailable(this.config.ytdlpPath, DEPENDENCY_PROBES["yt-dlp"]);
    const args = ["-J", "--no-warnings", "--no-call-home"];
    if (options.allowSearch) {
      args.push("--default-search", "ytsearch1");
    }
    args.push(query);
    const { stdout } = await runCommand(this.config.ytdlpPath, args);
    return JSON.parse(stdout);
  }

  infoToQueueEntries(info, options) {
    const entries = Array.isArray(info.entries) ? info.entries : [info];
    return entries
      .filter(Boolean)
      .slice(0, 25)
      .map((item) =>
        this._createQueueEntry({
          title: item.title || options.query,
          query: item.webpage_url || item.url || options.query,
          originalUrl: item.original_url || item.webpage_url || item.url || options.query,
          webpageUrl: item.webpage_url || item.original_url || item.url || options.query,
          durationSeconds: item.duration || null,
          thumbnailUrl: item.thumbnail || "",
          requestedById: options.requestedBy ? options.requestedBy.id : null,
          requestedByName: options.requestedBy
            ? options.requestedBy.displayName || options.requestedBy.username
            : "System",
          sourceMode: options.sourceMode,
          sourceOrigin: options.sourceOrigin
        })
      );
  }

  async getPlaybackSource(entry) {
    this._assertCommandAvailable(this.config.ffmpegPath, DEPENDENCY_PROBES.ffmpeg);
    if (entry.sourceMode === "play") {
      const cached = await this.getCachedOrDownloadedFile(entry);
      return {
        input: cached,
        inputKind: "file"
      };
    }

    return this.resolveStreamSource(entry);
  }

  _getCacheTemplate() {
    return path.join(this.config.cacheDir, "%(extractor)s-%(id)s.%(ext)s");
  }

  async getCachedOrDownloadedFile(entry) {
    fs.mkdirSync(this.config.cacheDir, { recursive: true });
    const outputTemplate = this._getCacheTemplate();
    const query = entry.searchQuery || entry.originalUrl || entry.query;

    const args = [
      "--no-warnings",
      "--no-call-home",
      "--no-playlist",
      "-f",
      "bestaudio/best",
      "-o",
      outputTemplate,
      "--print",
      "after_move:filepath",
      query
    ];

    const { stdout } = await runCommand(this.config.ytdlpPath, args);
    const filepath = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();

    if (!filepath) {
      throw new Error("yt-dlp did not return a cached filepath.");
    }

    return filepath;
  }

  async resolveStreamSource(entry) {
    const subject = entry.searchQuery || entry.originalUrl || entry.query;
    const info = await this.extractInfo(subject, {
      allowSearch: Boolean(entry.searchQuery) || !isUrl(subject)
    });
    const resolved = Array.isArray(info.entries) ? info.entries.find(Boolean) : info;
    if (!resolved || !resolved.url) {
      throw new Error("Could not resolve a playable stream URL.");
    }

    return {
      input: resolved.url,
      inputKind: "url"
    };
  }

  async resolveSpotifyEntries(query, options = {}) {
    const parsed = parseSpotifyUrl(query);
    if (!parsed) {
      throw new Error("Unsupported Spotify URL.");
    }
    if (!this.config.spotifyClientId || !this.config.spotifyClientSecret) {
      throw new Error("Spotify credentials are not configured.");
    }

    if (parsed.type === "track") {
      const track = await this.fetchSpotifyJson(`tracks/${parsed.id}`);
      return [
        this._createQueueEntry({
          title: track.name,
          artist: Array.isArray(track.artists)
            ? track.artists.map((artist) => artist.name).join(", ")
            : "",
          query,
          originalUrl: query,
          webpageUrl: query,
          searchQuery: `${track.artists.map((artist) => artist.name).join(" ")} ${track.name} audio`,
          durationSeconds: track.duration_ms ? track.duration_ms / 1000 : null,
          thumbnailUrl:
            track.album && Array.isArray(track.album.images) && track.album.images[0]
              ? track.album.images[0].url
              : "",
          requestedById: options.requestedBy ? options.requestedBy.id : null,
          requestedByName: options.requestedBy
            ? options.requestedBy.displayName || options.requestedBy.username
            : "System",
          sourceMode: options.sourceMode || "play",
          sourceOrigin: options.sourceOrigin || "manual"
        })
      ];
    }

    const endpoint =
      parsed.type === "album" ? `albums/${parsed.id}` : `playlists/${parsed.id}`;
    const payload = await this.fetchSpotifyJson(endpoint);
    const tracks =
      parsed.type === "album"
        ? payload.tracks.items
        : payload.tracks.items.map((item) => item.track).filter(Boolean);

    return tracks.slice(0, 25).map((track) =>
      this._createQueueEntry({
        title: track.name,
        artist: Array.isArray(track.artists)
          ? track.artists.map((artist) => artist.name).join(", ")
          : "",
        query,
        originalUrl: query,
        webpageUrl: query,
        searchQuery: `${track.artists.map((artist) => artist.name).join(" ")} ${track.name} audio`,
        durationSeconds: track.duration_ms ? track.duration_ms / 1000 : null,
        thumbnailUrl:
          track.album && Array.isArray(track.album.images) && track.album.images[0]
            ? track.album.images[0].url
            : "",
        requestedById: options.requestedBy ? options.requestedBy.id : null,
        requestedByName: options.requestedBy
          ? options.requestedBy.displayName || options.requestedBy.username
          : "System",
        sourceMode: options.sourceMode || "play",
        sourceOrigin: options.sourceOrigin || "manual"
      })
    );
  }

  async fetchSpotifyJson(pathname) {
    const token = await this.getSpotifyAccessToken();
    const response = await fetch(`https://api.spotify.com/v1/${pathname}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify API request failed: ${response.status}`);
    }

    return response.json();
  }

  async getSpotifyAccessToken() {
    if (this.spotifyToken && Date.now() < this.spotifyTokenExpiresAt) {
      return this.spotifyToken;
    }

    const credentials = Buffer.from(
      `${this.config.spotifyClientId}:${this.config.spotifyClientSecret}`,
      "utf8"
    ).toString("base64");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });

    if (!response.ok) {
      throw new Error(`Spotify token request failed: ${response.status}`);
    }

    const data = await response.json();
    this.spotifyToken = data.access_token;
    this.spotifyTokenExpiresAt = Date.now() + ((data.expires_in || 3000) * 1000) - 60_000;
    return this.spotifyToken;
  }
}

module.exports = {
  MediaResolver,
  createMissingCommandError,
  isSpotifyUrl,
  isUrl,
  parseSpotifyUrl,
  probeExternalCommand,
  runCommand
};
