// ── SQLite persistence for Clip history ──────────────────────────────────────
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.CLIP_DB_PATH || path.join(__dirname, "..", "clip.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS clips (
    id        TEXT PRIMARY KEY,
    text      TEXT NOT NULL,
    preview   TEXT NOT NULL,
    length    INTEGER NOT NULL,
    hash      TEXT NOT NULL,
    source    TEXT NOT NULL,
    time      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clips_time ON clips(time DESC);
`);

const stmts = {
  insert: db.prepare(`INSERT OR IGNORE INTO clips (id, text, preview, length, hash, source, time) VALUES (@id, @text, @preview, @length, @hash, @source, @time)`),
  all: db.prepare(`SELECT * FROM clips ORDER BY time DESC LIMIT ?`),
  search: db.prepare(`SELECT * FROM clips WHERE text LIKE ? ORDER BY time DESC LIMIT ?`),
  delete: db.prepare(`DELETE FROM clips WHERE id = ?`),
  count: db.prepare(`SELECT COUNT(*) as total FROM clips`),
  prune: db.prepare(`DELETE FROM clips WHERE id NOT IN (SELECT id FROM clips ORDER BY time DESC LIMIT ?)`),
};

function add(clip) {
  stmts.insert.run(clip);
  // Keep max 500
  stmts.prune.run(500);
}

function all(limit = 100) {
  return stmts.all.all(limit);
}

function search(query, limit = 50) {
  return stmts.search.all(`%${query}%`, limit);
}

function remove(id) {
  return stmts.delete.run(id).changes > 0;
}

function count() {
  return stmts.count.get().total;
}

function dedup() {
  const seen = new Set();
  const dupes = [];
  const rows = stmts.all.all(9999);
  for (const r of rows) {
    if (seen.has(r.hash)) dupes.push(r.id);
    else seen.add(r.hash);
  }
  for (const id of dupes) stmts.delete.run(id);
  return dupes.length;
}

module.exports = { add, all, search, remove, count, dedup };
