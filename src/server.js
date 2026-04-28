// ── Clip — Tiny clipboard sync daemon ────────────────────────────────────────
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const os = require("os");
const cfg = require("./config");
const clip = require("./clipboard");
const db = require("./db");

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

// ── Clip history — SQLite backed ─────────────────────────────────────────────
function addToHistory(text, source) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    preview: text.slice(0, 200),
    length: text.length,
    hash: clip.hash(text).slice(0, 12),
    source,
    time: new Date().toISOString(),
  };
  db.add(entry);
  broadcastToUI({ type: "new-clip", clip: entry });
  return entry;
}

// ── Web UI clients (separate from peer WS) ───────────────────────────────────
const uiClients = new Set();

function broadcastToUI(data) {
  const msg = JSON.stringify(data);
  for (const ws of uiClients) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(msg); } catch {}
  }
}

// ── LAN IP ───────────────────────────────────────────────────────────────────
function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

// ── Express ──────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
app.use(express.json());

app.get("/", (_req, res) => res.type("html").send(buildHTML()));

app.get("/status", (_req, res) => {
  res.json({
    running: true, name: cfg.name, peer: cfg.peer, peerConnected,
    lastSyncTime, lastDirection, syncCount, clipboardHash: lastHash.slice(0, 12),
    startedAt, lastError, historyCount: db.count(),
  });
});

app.get("/api/clips", (req, res) => {
  const q = (req.query.q || "").trim();
  if (q) return res.json({ clips: db.search(q), search: true, query: q });
  res.json({ clips: db.all(100) });
});

app.delete("/api/clips/:id", (req, res) => {
  const ok = db.remove(req.params.id);
  if (ok) broadcastToUI({ type: "delete", id: req.params.id });
  res.json({ ok });
});

app.get("/api/qr", (_req, res) => {
  const ip = getLanIp();
  res.json({ url: `http://${ip}:${cfg.port}`, ip, port: cfg.port });
});

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Peer sync connection
  if (path === "/ws") {
    if (url.searchParams.get("token") !== cfg.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      log("Peer connected (incoming)");
      handlePeer(ws);
    });
    return;
  }

  // UI WebSocket — no token needed (local only)
  if (path === "/ui") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      uiClients.add(ws);
      ws.on("close", () => uiClients.delete(ws));
      // Send current state
      ws.send(JSON.stringify({ type: "state", peerConnected, syncCount, name: cfg.name, peer: cfg.peer }));
    });
    return;
  }

  socket.destroy();
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
      if (peerWs === ws) { peerWs = null; peerConnected = false; broadcastToUI({ type: "peer", connected: false }); }
      setTimeout(connectToPeer, 3000);
    });
  } catch {
    setTimeout(connectToPeer, 3000);
  }
}

function handlePeer(ws) {
  peerWs = ws;
  peerConnected = true;
  broadcastToUI({ type: "peer", connected: true });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "clip" || !msg.text || !msg.hash) return;
      if (msg.text.length > cfg.maxBytes) return;
      if (msg.hash === lastHash) return;

      clip.write(msg.text);
      lastHash = msg.hash;
      echoUntil = Date.now() + cfg.echoCooldownMs;
      lastSyncTime = new Date().toISOString();
      lastDirection = "received";
      syncCount++;
      addToHistory(msg.text, cfg.peer.split(":")[0]);
      log(`Received from peer (${msg.text.length} chars)`);
    } catch (e) {
      lastError = e.message;
    }
  });

  ws.on("close", () => {
    if (peerWs === ws) { peerWs = null; peerConnected = false; broadcastToUI({ type: "peer", connected: false }); }
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

  // Add to history
  addToHistory(text, cfg.name);

  // Send to peer
  if (text.length > cfg.maxBytes) return;
  if (peerWs && peerWs.readyState === WebSocket.OPEN) {
    peerWs.send(JSON.stringify({ type: "clip", text, hash: h }));
    lastSyncTime = new Date().toISOString();
    lastDirection = "sent";
    syncCount++;
    log(`Sent to peer (${text.length} chars)`);
  }
}

// ── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[clip] ${new Date().toISOString().slice(11, 19)} ${msg}`);
}

// ── HTML ─────────────────────────────────────────────────────────────────────
function buildHTML() {
  const ip = getLanIp();
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clip</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#020203;color:#e5e5e5;min-height:100vh;overflow-x:hidden}
.root{min-height:100vh;background:radial-gradient(ellipse at 20% 50%,rgba(29,78,216,.18) 0%,transparent 60%),radial-gradient(ellipse at 80% 10%,rgba(37,99,235,.12) 0%,transparent 55%),#020203}

/* Flash + confetti */
@keyframes flashBorder{0%,100%{opacity:0}20%,50%{opacity:1}35%{opacity:0}75%{opacity:1}90%{opacity:0}}
@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
#flash{position:fixed;inset:0;z-index:9990;pointer-events:none;border:8px solid #2563eb;box-shadow:inset 0 0 40px rgba(37,99,235,.25);display:none}
#flash.on{display:block;animation:flashBorder .7s ease-in-out}
#confetti{position:fixed;inset:0;z-index:9991;pointer-events:none;display:none}

/* Layout */
.container{max-width:640px;margin:0 auto;padding:20px 16px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px}
.logo{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#fff}
.logo .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.logo .dot.on{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.5)}
.logo .dot.off{background:#ef4444}
.qr-btn{width:36px;height:36px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}
.qr-btn:hover{background:rgba(255,255,255,.1)}
.qr-btn img{width:28px;height:28px;border-radius:4px;opacity:.6}
.qr-btn:hover img{opacity:1}

/* Status bar */
.status{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;font-size:11px;color:rgba(255,255,255,.35)}
.status span{display:flex;align-items:center;gap:4px}
.status .val{color:rgba(255,255,255,.6);font-family:monospace}

/* Search */
.search{position:relative;margin-bottom:16px}
.search input{width:100%;height:36px;padding:0 36px 0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#fff;font-size:13px;outline:none;transition:all .15s}
.search input:focus{border-color:rgba(59,130,246,.4);background:rgba(255,255,255,.06)}
.search input::placeholder{color:rgba(255,255,255,.2)}
.search .clear{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;font-size:14px}
.search .clear:hover{color:#fff}

/* Machine filter pills */
.filters{display:flex;gap:6px;margin-bottom:14px}
.filter-pill{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.45);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s}
.filter-pill:hover{background:rgba(255,255,255,.08);color:rgba(255,255,255,.7)}
.filter-pill.active{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.25)}
.filter-pill .icon{width:16px;height:14px;opacity:.5}
.filter-pill.active .icon{opacity:.9}

/* Clip list */
.list{display:flex;flex-direction:column;gap:2px}
.clip{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid transparent;border-left:3px solid transparent;cursor:pointer;transition:all .15s;animation:fadeInUp .3s ease}
.clip.m-local{border-left-color:rgba(255,255,255,.5)}
.clip.m-peer{border-left-color:rgba(59,130,246,.5)}
.clip:hover{background:rgba(255,255,255,.06)}
.clip.new{border-color:rgba(37,99,235,.5);box-shadow:0 0 16px rgba(37,99,235,.15);animation:slideIn .4s ease}
.clip .meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.clip .source{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:4px}
.clip .source.local{color:rgba(255,255,255,.55)}
.clip .source.peer{color:rgba(59,130,246,.7)}
.clip .time{font-size:9px;color:rgba(255,255,255,.2)}
.clip .text{font-size:12px;color:rgba(255,255,255,.55);line-height:1.5;word-break:break-all;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.clip .text mark{background:rgba(250,204,21,.25);color:#fde047;border-radius:2px;padding:0 1px}
.clip .len{font-size:9px;color:rgba(255,255,255,.15);margin-top:4px}
.clip.copied{border-color:rgba(34,197,94,.5)!important;box-shadow:0 0 12px rgba(34,197,94,.15)!important}
.del-btn{background:none;border:none;color:rgba(255,255,255,.15);cursor:pointer;font-size:12px;font-weight:bold;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:all .15s;opacity:0}
.clip:hover .del-btn{opacity:1}
.del-btn:hover{background:rgba(239,68,68,.2);color:#f87171}

/* Empty */
.empty{text-align:center;padding:60px 20px;color:rgba(255,255,255,.15)}
.empty svg{margin-bottom:12px;opacity:.3}
.empty p{font-size:12px;letter-spacing:.1em;text-transform:uppercase}

/* Toast */
.toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;padding:5px 14px;border-radius:999px;z-index:99999;pointer-events:none;white-space:nowrap;opacity:0;transition:opacity .25s;display:flex;align-items:center;gap:6px;color:#fff}

/* QR modal */
.qr-overlay{display:none;position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.88);backdrop-filter:blur(12px);align-items:center;justify-content:center;flex-direction:column;gap:16px}
.qr-overlay.show{display:flex}
.qr-overlay img{width:220px;height:220px;background:rgba(255,255,255,.1);padding:16px;border-radius:22px;box-shadow:0 0 60px rgba(255,255,255,.1)}
.qr-overlay p{font-size:12px;color:rgba(255,255,255,.45);font-family:monospace;background:rgba(255,255,255,.06);padding:6px 14px;border-radius:8px}
.qr-overlay small{font-size:10px;color:rgba(255,255,255,.25);cursor:pointer}
</style>
</head><body>
<div id="flash"></div>
<canvas id="confetti"></canvas>
<div class="qr-overlay" id="qrOverlay" onclick="this.classList.remove('show')">
  <img id="qrImg" src="" alt="QR">
  <p id="qrUrl"></p>
  <small>tap anywhere to close</small>
</div>
<div class="root">
<div class="container">
  <div class="header">
    <div class="logo">
      <span class="dot" id="peerDot"></span>
      <span>Clip</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <div class="search" style="margin:0;flex:1;min-width:160px">
        <input type="text" id="searchInput" placeholder="Search clips..." oninput="onSearch(this.value)">
        <button class="clear" id="searchClear" onclick="clearSearch()" style="display:none">x</button>
      </div>
      <button class="qr-btn" onclick="showQR()" title="QR Code">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="14.01"/><line x1="21" y1="21" x2="21" y2="21.01"/><line x1="14" y1="21" x2="14" y2="21.01"/></svg>
      </button>
    </div>
  </div>

  <div class="status" id="statusBar">
    <span>Syncs: <span class="val" id="sSyncs">0</span></span>
    <span>Clips: <span class="val" id="sClips">0</span></span>
  </div>

  <div class="filters" id="filters">
    <button class="filter-pill active" onclick="setFilter('all')" id="fAll">All</button>
    <button class="filter-pill" onclick="setFilter('${cfg.name}')" id="fLocal">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      ${cfg.name}
    </button>
    <button class="filter-pill" onclick="setFilter('peer')" id="fPeer">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      <span id="peerName">${cfg.peer ? cfg.peer.split(':')[0] : 'Peer'}</span>
    </button>
  </div>

  <div id="clipList" class="list"></div>
  <div id="emptyState" class="empty">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=".6"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    <p>Copy something to get started</p>
  </div>
</div>
</div>
<div class="toast" id="toast"></div>

<script>
const clips = [];
let searchQuery = '';
let searchTimer = null;
let filterMachine = 'all';
const LOCAL_NAME = '${cfg.name}';

// ── WebSocket ──
function connectUI() {
  const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ui');
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'new-clip') {
      clips.unshift(msg.clip);
      if (clips.length > 200) clips.pop();
      if (!searchQuery) render(msg.clip.id);
      flash(); confetti(); playClick();
      document.getElementById('sClips').textContent = clips.length;
    }
    if (msg.type === 'delete') {
      const idx = clips.findIndex(c => c.id === msg.id);
      if (idx !== -1) clips.splice(idx, 1);
      const el = document.getElementById('c-' + msg.id);
      if (el) { el.style.opacity='0'; el.style.transform='translateX(-20px)'; setTimeout(() => { el.remove(); if (!clips.length) document.getElementById('emptyState').style.display='block'; }, 200); }
      document.getElementById('sClips').textContent = clips.length;
    }
    if (msg.type === 'peer') {
      document.getElementById('peerDot').className = 'dot ' + (msg.connected ? 'on' : 'off');
    }
    if (msg.type === 'state') {
      document.getElementById('peerDot').className = 'dot ' + (msg.peerConnected ? 'on' : 'off');
      document.getElementById('sSyncs').textContent = msg.syncCount || 0;
    }
  };
  ws.onclose = () => setTimeout(connectUI, 2000);
  ws.onerror = () => ws.close();
}

// ── Load initial clips ──
async function loadClips() {
  try {
    const r = await fetch('/api/clips');
    const d = await r.json();
    clips.length = 0;
    clips.push(...d.clips);
    render();
    document.getElementById('sClips').textContent = clips.length;
  } catch {}
}

// ── Render ──
function render(newId) {
  const list = document.getElementById('clipList');
  const empty = document.getElementById('emptyState');
  let items = clips;
  if (searchQuery) items = items.filter(c => c.text.toLowerCase().includes(searchQuery.toLowerCase()));
  if (filterMachine === LOCAL_NAME) items = items.filter(c => c.source === LOCAL_NAME);
  else if (filterMachine === 'peer') items = items.filter(c => c.source !== LOCAL_NAME);

  empty.style.display = items.length ? 'none' : 'block';

  const laptopIcon = '<svg style="width:12px;height:10px;opacity:.5;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  list.innerHTML = items.slice(0, 100).map(c => {
    const isLocal = c.source === LOCAL_NAME;
    const mClass = isLocal ? 'm-local' : 'm-peer';
    const sClass = isLocal ? 'local' : 'peer';
    const preview = searchQuery ? highlight(esc(c.preview), searchQuery) : esc(c.preview);
    return '<div class="clip ' + mClass + (c.id === newId ? ' new' : '') + '" id="c-' + c.id + '" onclick="copyClip(this,\\''+c.id+'\\')"><div class="meta"><span class="source ' + sClass + '">' + laptopIcon + ' ' + esc(c.source) + '</span><div style="display:flex;align-items:center;gap:6px"><span class="time">' + ago(c.time) + '</span><button class="del-btn" onclick="event.stopPropagation();delClip(\\''+c.id+'\\')">x</button></div></div><div class="text">' + preview + '</div><div class="len">' + c.length + ' chars</div></div>';
  }).join('');
}

function setFilter(f) {
  filterMachine = f;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  if (f === 'all') document.getElementById('fAll').classList.add('active');
  else if (f === LOCAL_NAME) document.getElementById('fLocal').classList.add('active');
  else document.getElementById('fPeer').classList.add('active');
  render();
}

function highlight(html, q) {
  if (!q) return html;
  const re = new RegExp('(' + q.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&') + ')', 'gi');
  return html.replace(re, '<mark>$1</mark>');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  return Math.floor(s/86400) + 'd';
}

// ── Copy ──
async function copyClip(el, id) {
  const c = clips.find(x => x.id === id);
  if (!c) return;
  try {
    await navigator.clipboard.writeText(c.text);
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1200);
    toast('Copied', '#16a34a');
  } catch {
    toast('Copy failed', '#dc2626');
  }
}

// ── Delete ──
async function delClip(id) {
  try { await fetch('/api/clips/' + id, { method: 'DELETE' }); } catch {}
}

// ── Search ──
function onSearch(val) {
  searchQuery = val.trim();
  document.getElementById('searchClear').style.display = searchQuery ? 'block' : 'none';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => render(), 150);
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  searchQuery = '';
  document.getElementById('searchClear').style.display = 'none';
  render();
}

// ── QR ──
async function showQR() {
  try {
    const r = await fetch('/api/qr');
    const d = await r.json();
    // Generate QR via external API
    document.getElementById('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(d.url);
    document.getElementById('qrUrl').textContent = d.url;
    document.getElementById('qrOverlay').classList.add('show');
  } catch {}
}

// ── Sound ──
function playClick() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1200, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08);
  } catch {}
}

// ── Flash ──
function flash() {
  const el = document.getElementById('flash');
  el.style.display = 'block';
  el.classList.remove('on'); el.offsetHeight; el.classList.add('on');
  setTimeout(() => { el.style.display = 'none'; el.classList.remove('on'); }, 750);
}

// ── Confetti ──
function confetti() {
  const canvas = document.getElementById('confetti');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const colors = ['#2563eb','#60a5fa','#93c5fd','#fff','#fbbf24','#a3e635','#bfdbfe'];
  const ps = Array.from({length:60}, () => ({
    x: Math.random()*canvas.width, y: -Math.random()*100,
    vx: (Math.random()-.5)*5, vy: Math.random()*6+4,
    w: Math.random()*10+4, h: Math.random()*5+3,
    color: colors[Math.floor(Math.random()*colors.length)],
    rot: Math.random()*360, rotV: (Math.random()-.5)*14,
  }));
  const start = Date.now();
  function tick() {
    const t = Date.now() - start;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const p of ps) {
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.15; p.rot+=p.rotV;
      ctx.save(); ctx.globalAlpha=Math.max(0,1-t/2400);
      ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(tick);
    else { ctx.clearRect(0,0,canvas.width,canvas.height); canvas.style.display='none'; }
  }
  requestAnimationFrame(tick);
}

// ── Toast ──
let toastTimer;
function toast(msg, bg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = bg || '#2563eb';
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

// ── Keyboard ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    clearSearch();
    document.getElementById('qrOverlay').classList.remove('show');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
});

// ── Init ──
loadClips();
connectUI();
setInterval(() => { if (!searchQuery) render(); }, 30000); // refresh ages
</script>
</body></html>`;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
server.listen(cfg.port, () => {
  log(`Clip running on :${cfg.port}`);
  log(`Machine: ${cfg.name}`);
  log(`Peer: ${cfg.peer || "none"}`);
  log(`UI: http://localhost:${cfg.port}`);
  setInterval(poll, cfg.pollMs);
  connectToPeer();
});
