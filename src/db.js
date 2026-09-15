// ── SQLite persistence for Clip history ──────────────────────────────────────
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// How many clips to keep, and how long to keep them. Both are env-tunable so a
// long-running daemon can be pinned to a tiny rolling window instead of a
// 500-deep archive. CLIP_MAX_AGE_HOURS=0 (the default) disables age expiry.
const HISTORY_CAP = Math.max(1, parseInt(process.env.CLIP_HISTORY_CAP || "500", 10) || 500);
const MAX_AGE_MS = Math.max(0, parseInt(process.env.CLIP_MAX_AGE_HOURS || "0", 10) || 0) * 3600000;

const dbPath = process.env.CLIP_DB_PATH || path.join(__dirname, "..", "clip.db");
const db = new Database(dbPath);
try { fs.chmodSync(dbPath, 0o600); } catch {}

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
  CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(hash);
`);

const stmts = {
  insert: db.prepare(`INSERT OR IGNORE INTO clips (id, text, preview, length, hash, source, time) VALUES (@id, @text, @preview, @length, @hash, @source, @time)`),
  all: db.prepare(`SELECT * FROM clips ORDER BY time DESC LIMIT ?`),
  search: db.prepare(`SELECT * FROM clips WHERE text LIKE ? ORDER BY time DESC LIMIT ?`),
  delete: db.prepare(`DELETE FROM clips WHERE id = ?`),
  update: db.prepare(`UPDATE clips SET text = ?, preview = ?, length = ? WHERE id = ?`),
  count: db.prepare(`SELECT COUNT(*) as total FROM clips`),
  prune: db.prepare(`DELETE FROM clips WHERE id NOT IN (SELECT id FROM clips ORDER BY time DESC LIMIT ?)`),
  findByHash: db.prepare(`SELECT * FROM clips WHERE hash = ? ORDER BY time DESC LIMIT 1`),
  pruneByAge: db.prepare(`DELETE FROM clips WHERE time < ?`),
};

function add(clip) {
  stmts.insert.run(clip);
  stmts.prune.run(HISTORY_CAP);
  pruneExpired();
}

// Drop clips past CLIP_MAX_AGE_HOURS. `time` is an ISO-8601 string, so a plain
// string comparison is a correct chronological one. No-op when expiry is off.
// Called on every write and on a timer, so history still clears while idle.
function pruneExpired() {
  if (!MAX_AGE_MS) return 0;
  return stmts.pruneByAge.run(new Date(Date.now() - MAX_AGE_MS).toISOString()).changes;
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

function update(id, text) {
  return stmts.update.run(text, text.slice(0, 2000), text.length, id).changes > 0;
}

// Indexed hash lookup, used on the write-time dedup hot path instead of pulling
// the whole capped table into JS.
function findByHash(hash) {
  return stmts.findByHash.get(hash);
}

function dedup() {
  const dupeSet = new Set();
  const rows = stmts.all.all(HISTORY_CAP + 1);
  // Hash-based dedup
  const seenHash = new Set();
  for (const r of rows) {
    if (seenHash.has(r.hash)) dupeSet.add(r.id);
    else seenHash.add(r.hash);
  }
  // Fuzzy prefix dedup: group clips sharing the same first 60 chars,
  // keep only the longest in each group
  const groups = {};
  for (const r of rows) {
    if (dupeSet.has(r.id)) continue;
    const key = r.text.slice(0, 60);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  for (const g of Object.values(groups)) {
    if (g.length <= 1) continue;
    g.sort((a, b) => b.length - a.length); // longest first
    for (let i = 1; i < g.length; i++) dupeSet.add(g[i].id);
  }
  for (const id of dupeSet) stmts.delete.run(id);
  return dupeSet.size;
}

function cleanup() {
  const rows = stmts.all.all(HISTORY_CAP + 1);
  let removed = 0;
  for (const r of rows) {
    const qCount = (r.text.match(/\?/g) || []).length;
    const ratio = r.text.length > 0 ? qCount / r.text.length : 0;
    // Remove clips where >30% of chars are ? (corrupted box-drawing from LANG bug)
    // or clips with mojibake double-encoded UTF-8
    if (ratio > 0.3 || /[\u201a\u00c4\u00e0\u221a\u00ac]{2}/.test(r.text)) {
      stmts.delete.run(r.id);
      removed++;
    }
  }
  return removed;
}

module.exports = { add, all, search, remove, update, count, dedup, cleanup, pruneExpired, findByHash, HISTORY_CAP, MAX_AGE_MS };
