const { ensureRuntimeDirectories, loadConfig } = require("./config");
const { SqliteStore } = require("./store");
const { MusicBotApp } = require("./app");
const { acquireRuntimeLock } = require("./runtime-lock");

async function main() {
  const config = loadConfig();
  ensureRuntimeDirectories(config);
  const runtimeLock = acquireRuntimeLock(config);

  const releaseLock = () => {
    runtimeLock.release();
  };
  process.on("exit", releaseLock);

  try {
    const store = new SqliteStore(config);
    const app = new MusicBotApp(config, store);
    let shutdownPromise = null;

    const shutdown = async (signal) => {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      shutdownPromise = (async () => {
        let exitCode = 0;
        console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down.`);
        try {
          await app.stop();
        } catch (error) {
          exitCode = 1;
          console.error(error && error.stack ? error.stack : String(error));
        } finally {
          releaseLock();
        }
        process.exit(exitCode);
      })();

      return shutdownPromise;
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    await app.start();
  } catch (error) {
    releaseLock();
    throw error;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
