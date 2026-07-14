// ── E2E DB seeding — write clips straight into the live server's SQLite file ──
// The Clip server queries the DB on every /api/clips request (no in-memory
// cache), so seeding the same file from the test process is picked up live.
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { E2E_DB_PATH } = require("../../playwright.config");

const SCHEMA = `
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
`;

function open(dbPath = E2E_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

// Build a full clip row from a partial spec. `i` spaces out timestamps so the
// newest-first ordering is deterministic (higher i = more recent).
function makeClip(spec = {}, i = 0) {
  const text = spec.text != null ? spec.text : "clip text " + i;
  const time = spec.time || new Date(Date.now() - (1000 - i) * 1000).toISOString();
  return {
    id: spec.id || "id-" + i + "-" + crypto.randomBytes(3).toString("hex"),
    text,
    preview: spec.preview != null ? spec.preview : text.slice(0, 2000),
    length: spec.length != null ? spec.length : text.length,
    hash: spec.hash || crypto.createHash("sha256").update(text).digest("hex").slice(0, 12),
    source: spec.source || "TestMachine",
    time,
  };
}

function reset(dbPath = E2E_DB_PATH) {
  const db = open(dbPath);
  db.exec("DELETE FROM clips");
  db.close();
}

// Replace all clips with the given specs (array of partial clip objects).
// Returns the full rows that were written.
function seed(specs = [], dbPath = E2E_DB_PATH) {
  const db = open(dbPath);
  db.exec("DELETE FROM clips");
  const insert = db.prepare(
    `INSERT INTO clips (id, text, preview, length, hash, source, time)
     VALUES (@id, @text, @preview, @length, @hash, @source, @time)`
  );
  const rows = specs.map((s, i) => makeClip(s, i));
  const tx = db.transaction((items) => items.forEach((r) => insert.run(r)));
  tx(rows);
  db.close();
  return rows;
}

function count(dbPath = E2E_DB_PATH) {
  const db = open(dbPath);
  const n = db.prepare("SELECT COUNT(*) AS c FROM clips").get().c;
  db.close();
  return n;
}

module.exports = { open, makeClip, reset, seed, count, SCHEMA };
