const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class SqliteStore {
  constructor(config) {
    this.config = config;
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    this.db = new DatabaseSync(config.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS queue_snapshots (
        guild_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS autoplaylist_entries (
        guild_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, position)
      );
    `);
  }

  close() {
    this.db.close();
  }

  getGuildSettings(guildId, defaults = {}) {
    const row = this.db
      .prepare("SELECT settings_json FROM guild_settings WHERE guild_id = ?")
      .get(String(guildId));
    if (!row) {
      return { ...defaults };
    }
    return { ...defaults, ...JSON.parse(row.settings_json) };
  }

  saveGuildSettings(guildId, settings) {
    this.db
      .prepare(
        `
        INSERT INTO guild_settings (guild_id, settings_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id)
        DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP
      `
      )
      .run(String(guildId), JSON.stringify(settings));
  }

  getQueueSnapshot(guildId) {
    const row = this.db
      .prepare("SELECT snapshot_json FROM queue_snapshots WHERE guild_id = ?")
      .get(String(guildId));
    return row ? JSON.parse(row.snapshot_json) : null;
  }

  saveQueueSnapshot(guildId, snapshot) {
    this.db
      .prepare(
        `
        INSERT INTO queue_snapshots (guild_id, snapshot_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id)
        DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = CURRENT_TIMESTAMP
      `
      )
      .run(String(guildId), JSON.stringify(snapshot));
  }

  clearQueueSnapshot(guildId) {
    this.db
      .prepare("DELETE FROM queue_snapshots WHERE guild_id = ?")
      .run(String(guildId));
  }

  getAutoplaylist(guildId) {
    return this.db
      .prepare(
        "SELECT source, title FROM autoplaylist_entries WHERE guild_id = ? ORDER BY position ASC"
      )
      .all(String(guildId))
      .map((row) => ({
        source: row.source,
        title: row.title
      }));
  }

  saveAutoplaylist(guildId, entries) {
    const normalizedGuildId = String(guildId);
    this.db
      .prepare("DELETE FROM autoplaylist_entries WHERE guild_id = ?")
      .run(normalizedGuildId);

    const insert = this.db.prepare(
      `
      INSERT INTO autoplaylist_entries (guild_id, position, source, title)
      VALUES (?, ?, ?, ?)
    `
    );
    for (const [index, entry] of entries.entries()) {
      insert.run(
        normalizedGuildId,
        index,
        String(entry.source || ""),
        String(entry.title || "")
      );
    }
  }

  addAutoplaylistEntry(guildId, entry) {
    const existing = this.getAutoplaylist(guildId);
    if (existing.some((candidate) => candidate.source === entry.source)) {
      return false;
    }
    existing.push({
      source: String(entry.source || ""),
      title: String(entry.title || "")
    });
    this.saveAutoplaylist(guildId, existing);
    return true;
  }

  removeAutoplaylistEntry(guildId, source) {
    const existing = this.getAutoplaylist(guildId);
    const filtered = existing.filter((entry) => entry.source !== source);
    if (filtered.length === existing.length) {
      return false;
    }
    this.saveAutoplaylist(guildId, filtered);
    return true;
  }
}

module.exports = {
  SqliteStore
};
