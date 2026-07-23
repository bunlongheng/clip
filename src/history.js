// ── Clip history — write-time dedup + SQLite persistence + UI fanout ──────────
const { WebSocket } = require("ws");
const clip = require("./clipboard");
const db = require("./db");

const uiClients = new Set();

function broadcastToUI(data) {
  const msg = JSON.stringify(data);
  for (const ws of uiClients) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(msg); } catch {}
  }
}

let lastAddedHash = "";
let lastAddedTime = 0;
const SMASH_COOLDOWN_MS = 1000; // ignore re-copies of same content within 1s

function addToHistory(text, source) {
  // Trim overall + strip leading whitespace from every line
  const trimmed = text.trim().split("\n").map(l => l.trimStart()).join("\n").trim();
  const h = clip.hash(trimmed).slice(0, 12);

  // Anti-smash: ignore rapid re-copies of same content
  const now = Date.now();
  if (h === lastAddedHash && now - lastAddedTime < SMASH_COOLDOWN_MS) return null;

  // Anti-stream: if new text shares first 60 chars with recent clip (growing content),
  // replace the old one instead of creating a new entry
  if (lastAddedHash && now - lastAddedTime < SMASH_COOLDOWN_MS) {
    const recent = db.findByHash(lastAddedHash);
    if (recent && trimmed.slice(0, 60) === recent.text.slice(0, 60)) {
      db.remove(recent.id);
      // Fall through to create new entry with updated content
    }
  }

  lastAddedHash = h;
  lastAddedTime = now;

  // Dedup: if same content exists, move it to top by updating time
  const existing = db.findByHash(h);
  if (existing) {
    db.remove(existing.id);
    existing.time = new Date().toISOString();
    existing.source = source;
    db.add(existing);
    broadcastToUI({ type: "bump", clip: existing });
    return existing;
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: trimmed,
    preview: trimmed.slice(0, 2000),
    length: trimmed.length,
    hash: h,
    source,
    time: new Date().toISOString(),
  };
  db.add(entry);
  broadcastToUI({ type: "new-clip", clip: entry });
  return entry;
}

module.exports = { addToHistory, broadcastToUI, uiClients };
