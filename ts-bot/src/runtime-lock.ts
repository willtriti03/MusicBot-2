const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && (error.code === "ESRCH" || error.code === "EINVAL")) {
      return false;
    }
    if (error && error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function readLockFile(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function formatLockOwner(lockData, lockPath) {
  const details = [];
  if (lockData && Number.isInteger(lockData.pid) && lockData.pid > 0) {
    details.push(`pid ${lockData.pid}`);
  }
  if (lockData && lockData.createdAt) {
    details.push(`started at ${lockData.createdAt}`);
  }
  details.push(`lock ${lockPath}`);
  return details.join(", ");
}

function acquireRuntimeLock(config) {
  const lockPath = config.instanceLockPath;
  const instanceId = crypto.randomUUID();
  const lockData = {
    instanceId,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    configPath: config.configPath
  };

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o644);
      try {
        fs.writeFileSync(fd, `${JSON.stringify(lockData, null, 2)}\n`, "utf8");
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw error;
      }

      const existingLock = readLockFile(lockPath);
      if (existingLock && isProcessRunning(existingLock.pid)) {
        throw new Error(
          `Another MusicBot instance is already running (${formatLockOwner(existingLock, lockPath)}).`
        );
      }

      try {
        fs.rmSync(lockPath, { force: true });
      } catch (removeError) {
        if (!removeError || removeError.code !== "ENOENT") {
          throw removeError;
        }
      }
    }
  }

  let released = false;

  return {
    lockPath,
    release() {
      if (released) {
        return;
      }
      released = true;

      const currentLock = readLockFile(lockPath);
      if (currentLock && currentLock.instanceId !== instanceId) {
        return;
      }

      try {
        fs.rmSync(lockPath, { force: true });
      } catch (error) {
        if (!error || error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  };
}

module.exports = {
  acquireRuntimeLock,
  isProcessRunning
};
