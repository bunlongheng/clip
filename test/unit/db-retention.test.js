// ── Unit tests — CLIP_HISTORY_CAP + CLIP_MAX_AGE_HOURS retention ─────────────
// Both knobs are read in src/db.js at require-time, and vi.resetModules is
// unreliable for CJS, so each case runs src/db in a fresh child process with
// its own throwaway DB and prints JSON we parse back.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { tmpDbPath } = require("../helpers/factory");

const DB_MODULE = path.join(__dirname, "..", "..", "src", "db.js");
const dbPaths = [];

// Run `script` with src/db loaded as `db` under the given env, return its JSON output.
function runWithEnv(env, script) {
  const dbPath = tmpDbPath();
  dbPaths.push(dbPath);
  const out = execFileSync(
    process.execPath,
    ["-e", `const db = require(${JSON.stringify(DB_MODULE)});\n${script}`],
    { env: { ...process.env, CLIP_DB_PATH: dbPath, ...env }, encoding: "utf8" }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

afterAll(() => {
  for (const p of dbPaths) for (const f of [p, p + "-wal", p + "-shm"]) { try { fs.unlinkSync(f); } catch {} }
});

const addN = (n) => `
  for (let i = 0; i < ${n}; i++) db.add({ id: "c" + i, text: "t" + i, preview: "t" + i, length: 2, hash: "h" + i, source: "test", time: new Date(Date.now() + i * 1000).toISOString() });
`;

describe("CLIP_HISTORY_CAP", () => {
  test("defaults to 500 when unset", () => {
    const r = runWithEnv({}, `console.log(JSON.stringify({ cap: db.HISTORY_CAP }));`);
    expect(r.cap).toBe(500);
  });

  test("keeps only the newest N clips when set", () => {
    const r = runWithEnv({ CLIP_HISTORY_CAP: "10" }, addN(25) + `
      console.log(JSON.stringify({ cap: db.HISTORY_CAP, count: db.count(), newest: db.all(1)[0].id }));`);
    expect(r.cap).toBe(10);
    expect(r.count).toBe(10);
    expect(r.newest).toBe("c24"); // newest survives, oldest are pruned
  });

  test("never drops below 1 on a junk value", () => {
    const r = runWithEnv({ CLIP_HISTORY_CAP: "0" }, `console.log(JSON.stringify({ cap: db.HISTORY_CAP }));`);
    expect(r.cap).toBe(500); // 0 is falsy -> falls back to the default
  });
});

describe("CLIP_MAX_AGE_HOURS", () => {
  test("is off by default, so pruneExpired is a no-op", () => {
    const r = runWithEnv({}, addN(3) + `
      console.log(JSON.stringify({ age: db.MAX_AGE_MS, removed: db.pruneExpired(), count: db.count() }));`);
    expect(r.age).toBe(0);
    expect(r.removed).toBe(0);
    expect(r.count).toBe(3);
  });

  test("drops clips older than the window and keeps fresh ones", () => {
    const r = runWithEnv({ CLIP_MAX_AGE_HOURS: "24" }, `
      const stale = new Date(Date.now() - 30 * 3600000).toISOString();
      for (let i = 0; i < 4; i++) db.add({ id: "old" + i, text: "o", preview: "o", length: 1, hash: "ho" + i, source: "test", time: stale });
      const before = db.count();
      for (let i = 0; i < 3; i++) db.add({ id: "new" + i, text: "n", preview: "n", length: 1, hash: "hn" + i, source: "test", time: new Date().toISOString() });
      console.log(JSON.stringify({ age: db.MAX_AGE_MS, before, after: db.count() }));`);
    expect(r.age).toBe(24 * 3600000);
    expect(r.before).toBe(0); // stale rows are expired by the add() that inserts them
    expect(r.after).toBe(3);  // only the 3 fresh clips survive
  });
});
