// ── Clip — Tiny clipboard sync daemon ────────────────────────────────────────
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const cfg = require("./config");
const clip = require("./clipboard");

// ── State ────────────────────────────────────────────────────────────────────
let lastHash = clip.hash(clip.read());
let echoUntil = 0;
let peerWs = null;
let peerConnected = false;
let lastSyncTime = null;
let lastDirection = null;
let syncCount = 0;
let lastError = null;
const startedAt = new Date().toISOString();

// ── Express status page ──────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Clip</title>
<meta http-equiv="refresh" content="3">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:40px;min-height:100vh}
h1{font-size:20px;font-weight:600;margin-bottom:24px;color:#fff}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px}
.green{background:#22c55e}.red{background:#ef4444}.yellow{background:#eab308}
table{width:100%;max-width:480px;border-collapse:collapse}
td{padding:8px 0;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06)}
td:first-child{color:rgba(255,255,255,.4);width:140px}
td:last-child{color:rgba(255,255,255,.8);font-family:monospace;font-size:12px}
</style></head><body>
<h1><span class="dot ${peerConnected ? "green" : "red"}"></span>Clip</h1>
<table>
<tr><td>Status</td><td>${peerConnected ? "Connected" : "Waiting for peer"}</td></tr>
<tr><td>Machine</td><td>${cfg.name}</td></tr>
<tr><td>Peer</td><td>${cfg.peer || "not configured"}</td></tr>
<tr><td>Peer status</td><td>${peerConnected ? "online" : "offline"}</td></tr>
<tr><td>Last sync</td><td>${lastSyncTime || "never"}</td></tr>
<tr><td>Direction</td><td>${lastDirection || "-"}</td></tr>
<tr><td>Syncs</td><td>${syncCount}</td></tr>
<tr><td>Clipboard hash</td><td>${lastHash.slice(0, 12)}...</td></tr>
<tr><td>Uptime</td><td>${startedAt}</td></tr>
<tr><td>Last error</td><td>${lastError || "none"}</td></tr>
</table>
</body></html>`);
});

app.get("/status", (_req, res) => {
  res.json({
    running: true,
    name: cfg.name,
    peer: cfg.peer,
    peerConnected,
    lastSyncTime,
    lastDirection,
    syncCount,
    clipboardHash: lastHash.slice(0, 12),
    startedAt,
    lastError,
  });
});

// ── WebSocket server — accepts incoming peer connection ──────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get("token") !== cfg.token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    log("Peer connected (incoming)");
    handlePeer(ws);
  });
});

// ── WebSocket client — connect to peer ───────────────────────────────────────
function connectToPeer() {
  if (!cfg.peer) return;
  if (peerWs && peerWs.readyState === WebSocket.OPEN) return;

  try {
    const ws = new WebSocket(`ws://${cfg.peer}/ws?token=${cfg.token}`);
    ws.on("open", () => {
      log("Connected to peer (outgoing)");
      handlePeer(ws);
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      if (peerWs === ws) { peerWs = null; peerConnected = false; }
      setTimeout(connectToPeer, 3000);
    });
  } catch {
    setTimeout(connectToPeer, 3000);
  }
}

function handlePeer(ws) {
  peerWs = ws;
  peerConnected = true;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "clip" || !msg.text || !msg.hash) return;
      if (msg.text.length > cfg.maxBytes) return;

      // Already have this content
      if (msg.hash === lastHash) return;

      // Write to clipboard
      clip.write(msg.text);
      lastHash = msg.hash;
      echoUntil = Date.now() + cfg.echoCooldownMs;
      lastSyncTime = new Date().toISOString();
      lastDirection = "received";
      syncCount++;
      log(`Received from peer (${msg.text.length} chars)`);
    } catch (e) {
      lastError = e.message;
    }
  });

  ws.on("close", () => {
    if (peerWs === ws) { peerWs = null; peerConnected = false; }
    log("Peer disconnected");
  });
}

// ── Clipboard watcher ────────────────────────────────────────────────────────
function poll() {
  if (Date.now() < echoUntil) return;

  const text = clip.read();
  if (!text) return;

  const h = clip.hash(text);
  if (h === lastHash) return;
  lastHash = h;

  // Text changed — send to peer
  if (text.length > cfg.maxBytes) return;
  if (peerWs && peerWs.readyState === WebSocket.OPEN) {
    peerWs.send(JSON.stringify({ type: "clip", text, hash: h }));
    lastSyncTime = new Date().toISOString();
    lastDirection = "sent";
    syncCount++;
    log(`Sent to peer (${text.length} chars)`);
  }
}

// ── Logging — no clipboard content, ever ─────────────────────────────────────
function log(msg) {
  console.log(`[clip] ${new Date().toISOString().slice(11, 19)} ${msg}`);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
server.listen(cfg.port, () => {
  log(`Clip running on :${cfg.port}`);
  log(`Machine: ${cfg.name}`);
  log(`Peer: ${cfg.peer || "none"}`);
  setInterval(poll, cfg.pollMs);
  connectToPeer();
});
