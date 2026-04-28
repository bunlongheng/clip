// ── Clip Configuration ───────────────────────────────────────────────────────
// Edit these values for each machine.

module.exports = {
  // This machine's name (shown on status page)
  name: process.env.CLIP_NAME || require("os").hostname(),

  // Port for status page + WebSocket server
  port: parseInt(process.env.CLIP_PORT || "4545", 10),

  // Peer machine address — the other computer's IP:port
  // e.g. "10.0.0.218:4545" or "macmini.local:4545"
  peer: process.env.CLIP_PEER || "",

  // Shared secret — must match on both machines
  token: process.env.CLIP_TOKEN || "clip-sync-secret",

  // Clipboard poll interval (ms)
  pollMs: parseInt(process.env.CLIP_POLL_MS || "400", 10),

  // Max payload size (bytes) — reject anything larger
  maxBytes: parseInt(process.env.CLIP_MAX_BYTES || "102400", 10), // 100KB

  // Cooldown after receiving from peer (ms) — prevents echo
  echoCooldownMs: 2000,
};
