// ── Unit-test helpers — isolated temp DB paths + clip row factory ────────────
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// Unique throwaway DB path. Set process.env.CLIP_DB_PATH to this BEFORE
// requiring ../src/db or ../src/server so each test file is fully isolated.
function tmpDbPath() {
  return path.join(os.tmpdir(), "clip-unit-" + crypto.randomBytes(8).toString("hex") + ".db");
}

// Build a complete clip row matching the src/db.js schema.
function makeClip(spec = {}) {
  const text = spec.text != null ? spec.text : "hello world";
  return {
    id: spec.id || crypto.randomBytes(6).toString("hex"),
    text,
    preview: spec.preview != null ? spec.preview : text.slice(0, 2000),
    length: spec.length != null ? spec.length : text.length,
    hash: spec.hash || crypto.createHash("sha256").update(text).digest("hex").slice(0, 12),
    source: spec.source || "M4",
    time: spec.time || new Date().toISOString(),
  };
}

module.exports = { tmpDbPath, makeClip };
