// ── Clip Configuration ───────────────────────────────────────────────────────
// Edit these values for each machine.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Overridable so tests can point at a scratch file instead of the real .env.
const envPath = process.env.CLIP_ENV_PATH || path.join(__dirname, "..", ".env");

// ── .env loader — load ../.env into process.env (does not override existing) ──
try {
  const envFile = fs.readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {
  // ENOENT (no .env yet) is the normal first-run case - only warn on anything else.
  if (e.code !== "ENOENT") console.warn("[clip] could not read .env:", e.message);
}

// Persist KEY=value into ../.env, replacing an existing line for that key if present.
function persistEnvVar(key, value) {
  let body = "";
  try { body = fs.readFileSync(envPath, "utf8"); } catch {}
  const re = new RegExp(`^${key}=.*$`, "m");
  body = re.test(body)
    ? body.replace(re, `${key}=${value}`)
    : (body && !body.endsWith("\n") ? body + "\n" : body) + `${key}=${value}\n`;
  fs.writeFileSync(envPath, body, { mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch {}
}

// Known-public defaults from older versions of this repo / the launchd template.
// Running with one of these means the peer secret is guessable by anyone who
// has read the source, so treat them the same as "unset".
const WEAK_TOKENS = new Set(["clip-sync-secret", "change-this-shared-secret", ""]);

let token = process.env.CLIP_TOKEN || "";
if (WEAK_TOKENS.has(token)) {
  token = crypto.randomBytes(24).toString("hex");
  persistEnvVar("CLIP_TOKEN", token);
  console.warn("[clip] No CLIP_TOKEN set (or a known public default was used) - generated a random one and saved it to .env. Copy CLIP_TOKEN from .env to the other machine to sync.");
}

module.exports = {
  // This machine's name (shown on status page)
  name: process.env.CLIP_NAME || require("os").hostname(),

  // Port for status page + WebSocket server
  port: parseInt(process.env.CLIP_PORT || "4545", 10),

  // Peer machine address - the other computer's IP:port
  // e.g. "192.168.1.50:4545" or "macmini.local:4545"
  peer: process.env.CLIP_PEER || "",

  // Shared secret — must match on both machines. Auto-generated above if unset.
  token,

  // Clipboard poll interval (ms)
  pollMs: parseInt(process.env.CLIP_POLL_MS || "400", 10),

  // Max payload size (bytes) — reject anything larger
  maxBytes: parseInt(process.env.CLIP_MAX_BYTES || "102400", 10), // 100KB

  // Cooldown after receiving from peer (ms) — prevents echo
  echoCooldownMs: 2000,

  persistEnvVar,
};
