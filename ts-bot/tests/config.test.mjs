import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { loadConfig, parseEnvFile } = await import("../dist/config.js");

test("parseEnvFile reads key=value pairs and ignores comments", () => {
  assert.deepEqual(
    parseEnvFile(`
# comment
DISCORD_TOKEN=test-token
SPOTIFY_CLIENT_SECRET="quoted"
INVALID
`),
    {
      DISCORD_TOKEN: "test-token",
      SPOTIFY_CLIENT_SECRET: "quoted"
    }
  );
});

test("loadConfig merges config file and env secrets", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-config-"));
  const configPath = path.join(tempRoot, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      databasePath: "data/test.sqlite",
      cacheDir: "cache",
      defaultGuildSettings: {
        defaultVolume: 0.35,
        autoplayEnabled: false
      }
    })
  );

  const previousToken = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = "test-token";

  const config = loadConfig({
    repoRoot: tempRoot,
    configPath
  });

  assert.equal(config.discordToken, "test-token");
  assert.equal(config.defaultGuildSettings.defaultVolume, 0.35);
  assert.equal(config.defaultGuildSettings.autoplayEnabled, false);
  assert.equal(config.databasePath, path.join(tempRoot, "data", "test.sqlite"));
  assert.equal(path.dirname(config.instanceLockPath), path.join(tempRoot, "data"));
  assert.match(
    path.basename(config.instanceLockPath),
    /^musicbot-instance-[0-9a-f]{12}\.lock$/
  );

  if (previousToken === undefined) {
    delete process.env.DISCORD_TOKEN;
  } else {
    process.env.DISCORD_TOKEN = previousToken;
  }
});

test("loadConfig loads secrets from a repo-local .env file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-dotenv-"));
  const configPath = path.join(tempRoot, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({}));
  fs.writeFileSync(
    path.join(tempRoot, ".env"),
    "DISCORD_TOKEN=dotenv-token\nSPOTIFY_CLIENT_ID=spotify-id\n"
  );

  const previousToken = process.env.DISCORD_TOKEN;
  const previousSpotify = process.env.SPOTIFY_CLIENT_ID;
  delete process.env.DISCORD_TOKEN;
  delete process.env.SPOTIFY_CLIENT_ID;

  const config = loadConfig({
    repoRoot: tempRoot,
    configPath
  });

  assert.equal(config.discordToken, "dotenv-token");
  assert.equal(config.spotifyClientId, "spotify-id");
  assert.equal(config.loadedEnvPath, path.join(tempRoot, ".env"));
  assert.equal(path.dirname(config.instanceLockPath), path.join(tempRoot, "data"));

  if (previousToken === undefined) {
    delete process.env.DISCORD_TOKEN;
  } else {
    process.env.DISCORD_TOKEN = previousToken;
  }

  if (previousSpotify === undefined) {
    delete process.env.SPOTIFY_CLIENT_ID;
  } else {
    process.env.SPOTIFY_CLIENT_ID = previousSpotify;
  }
});

test("loadConfig honors MUSICBOT_INSTANCE_LOCK_PATH override", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-lock-path-"));
  const configPath = path.join(tempRoot, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({}));

  const previousLockPath = process.env.MUSICBOT_INSTANCE_LOCK_PATH;
  process.env.MUSICBOT_INSTANCE_LOCK_PATH = "locks/custom.lock";

  const config = loadConfig({
    repoRoot: tempRoot,
    configPath
  });

  assert.equal(config.instanceLockPath, path.join(tempRoot, "locks", "custom.lock"));

  if (previousLockPath === undefined) {
    delete process.env.MUSICBOT_INSTANCE_LOCK_PATH;
  } else {
    process.env.MUSICBOT_INSTANCE_LOCK_PATH = previousLockPath;
  }
});
