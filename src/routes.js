// ── HTTP routes — Express app, everything under /api/* requires the shared token ──
const path = require("path");
const express = require("express");
const cfg = require("./config");
const auth = require("./auth");
const db = require("./db");
const { broadcastToUI } = require("./history");
const { getLanIp } = require("./net");
const peer = require("./peer");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const STARTED_AT = new Date().toISOString();

const AUTH_PROMPT_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clip - sign in</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#020203;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
form{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:28px;width:280px}
h1{font-size:16px;margin:0 0 4px}p{font-size:12px;color:rgba(255,255,255,.4);margin:0 0 16px}
input{width:100%;height:38px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;font-size:13px;box-sizing:border-box;outline:none}
button{width:100%;margin-top:10px;height:38px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}</style>
</head><body><form method="GET" action="/"><h1>Clip</h1><p>Enter this machine's CLIP_TOKEN to continue.</p>
<input name="token" type="password" placeholder="CLIP_TOKEN" autofocus required><button type="submit">Open</button></form></body></html>`;

function createApp() {
  const app = express();
  app.use(express.json());

  // ── entry point — gates the whole app behind the shared token, sets a cookie
  //    on success so later loads/fetches/WS upgrades authenticate automatically ──
  app.get("/", (req, res) => {
    if (!auth.isAuthed(req)) {
      return res.status(401).type("html").send(AUTH_PROMPT_HTML);
    }
    res.cookie("clip_token", cfg.token, { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 365 });
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  // Static assets (client.js, manifest.json, icon.svg) - no clip content, safe to serve openly.
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // Lightweight local health check - intentionally not gated so `npm run status` works with no token.
  app.get("/status", (_req, res) => {
    const p = peer.state;
    res.json({
      running: true, name: cfg.name, peer: cfg.peer, peerConnected: p.peerConnected,
      lastSyncTime: p.lastSyncTime, lastDirection: p.lastDirection, syncCount: p.syncCount,
      clipboardHash: p.lastHash.slice(0, 12),
      startedAt: STARTED_AT, lastError: p.lastError, historyCount: db.count(),
    });
  });

  const api = express.Router();
  api.use(auth.requireAuth);

  api.get("/config", (_req, res) => res.json({ name: cfg.name }));

  api.get("/clips", (req, res) => {
    const q = (req.query.q || "").trim();
    if (q) return res.json({ clips: db.search(q), search: true, query: q });
    res.json({ clips: db.all(100) });
  });

  api.put("/clips/:id", (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.json({ ok: false });
    const ok = db.update(req.params.id, text.trim());
    if (ok) broadcastToUI({ type: "updated", id: req.params.id, text: text.trim() });
    res.json({ ok });
  });

  api.delete("/clips/:id", (req, res) => {
    const ok = db.remove(req.params.id);
    if (ok) broadcastToUI({ type: "delete", id: req.params.id });
    res.json({ ok });
  });

  // Lazily mint a Stickies API key on first use and persist it to ../.env.
  // Stickies authorizes this endpoint via its LAN bypass, so no bootstrap secret.
  async function ensureStickiesToken(base) {
    if (process.env.STICKIES_API_TOKEN) return process.env.STICKIES_API_TOKEN;
    const r = await fetch(base + "/api/stickies/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "clip" }),
    });
    if (!r.ok) throw new Error("mint failed: " + r.status);
    const { key } = await r.json();
    if (!key) throw new Error("mint returned no key");
    process.env.STICKIES_API_TOKEN = key;
    cfg.persistEnvVar("STICKIES_API_TOKEN", key);
    return key;
  }

  api.post("/stickies", async (req, res) => {
    const { text } = req.body;
    const content = (text || "").trim();
    if (!content) return res.json({ ok: false });
    try {
      const base = (process.env.STICKIES_API_URL || "http://localhost:4444").replace(/\/$/, "");
      const token = await ensureStickiesToken(base);
      const firstLine = content.split("\n").find(l => l.trim()) || content;
      // Title must be emoji-free (Stickies enforces this on its end too).
      const title = firstLine
        .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 60) || "Clip";
      const r = await fetch(base + "/api/stickies/ext", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ title, content, folder: "Apps/Clips", type: "text" }),
      });
      const data = await r.json().catch(() => ({}));
      res.json({ ok: r.ok && !!data.note });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  api.get("/qr", (_req, res) => {
    const ip = getLanIp();
    res.json({ url: `http://${ip}:${cfg.port}`, ip, port: cfg.port });
  });

  api.get("/setup", (_req, res) => {
    const ip = getLanIp();
    const myAddr = `${ip}:${cfg.port}`;
    res.json({
      status: peer.state.peerConnected ? "connected" : "disconnected",
      thisMachine: { name: cfg.name, ip: myAddr },
      peer: { addr: cfg.peer, connected: peer.state.peerConnected },
      setup: {
        instructions: "To connect another machine, run clip with CLIP_PEER pointing to this machine, using the SAME CLIP_TOKEN you set on this one (see .env - never sent over the network):",
        command: `cd ~/Sites/clip && CLIP_PEER=${myAddr} CLIP_TOKEN=your-shared-token npm start`,
        env: { CLIP_PEER: myAddr, CLIP_PORT: cfg.port },
      },
    });
  });

  api.post("/dedup", (_req, res) => {
    const cleaned = db.cleanup();
    const deduped = db.dedup();
    const removed = cleaned + deduped;
    if (removed > 0) broadcastToUI({ type: "dedup", removed });
    res.json({ ok: true, removed, cleaned, deduped });
  });

  app.use("/api", api);

  return app;
}

module.exports = { createApp, AUTH_PROMPT_HTML };
