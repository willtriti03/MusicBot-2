const { ensureRuntimeDirectories, loadConfig } = require("./config");
const { SqliteStore } = require("./store");
const { MusicBotApp } = require("./app");

async function main() {
  const config = loadConfig();
  ensureRuntimeDirectories(config);

  const store = new SqliteStore(config);
  const app = new MusicBotApp(config, store);

  const shutdown = async (signal) => {
    console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down.`);
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.start();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
