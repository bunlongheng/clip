// ── Peer sync — clipboard poller + peer WebSocket (server + client) ───────────
const { WebSocketServer, WebSocket } = require("ws");
const cfg = require("./config");
const clip = require("./clipboard");
const auth = require("./auth");
const { addToHistory, broadcastToUI } = require("./history");

const wss = new WebSocketServer({ noServer: true });

const state = {
  lastHash: "",
  echoUntil: 0,
  peerWs: null,
  peerConnected: false,
  lastSyncTime: null,
  lastDirection: null,
  syncCount: 0,
  lastError: null,
  polling: false, // re-entrancy guard so a slow pbpaste can't overlap ticks
};

function log(msg) {
  console.log(`[clip] ${new Date().toISOString().slice(11, 19)} ${msg}`);
}

async function poll() {
  if (state.polling) return; // previous tick still running (pbpaste hasn't returned)
  if (Date.now() < state.echoUntil) return;
  state.polling = true;
  try {
    const text = await clip.read();
    if (!text) return;

    const h = clip.hash(text);
    if (h === state.lastHash) return;
    state.lastHash = h;

    addToHistory(text, cfg.name);

    if (text.length > cfg.maxBytes) return;
    if (state.peerWs && state.peerWs.readyState === WebSocket.OPEN) {
      state.peerWs.send(JSON.stringify({ type: "clip", text, hash: h }));
      state.lastSyncTime = new Date().toISOString();
      state.lastDirection = "sent";
      state.syncCount++;
      log(`Sent to peer (${text.length} chars)`);
    }
  } finally {
    state.polling = false;
  }
}

function connectToPeer() {
  if (!cfg.peer) return;
  if (state.peerWs && state.peerWs.readyState === WebSocket.OPEN) return;

  try {
    const ws = new WebSocket(`ws://${cfg.peer}/ws?token=${cfg.token}`);
    ws.on("open", () => {
      log("Connected to peer (outgoing)");
      handlePeer(ws);
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      if (state.peerWs === ws) { state.peerWs = null; state.peerConnected = false; broadcastToUI({ type: "peer", connected: false }); }
      setTimeout(connectToPeer, 3000);
    });
  } catch {
    setTimeout(connectToPeer, 3000);
  }
}

function handlePeer(ws) {
  state.peerWs = ws;
  state.peerConnected = true;
  broadcastToUI({ type: "peer", connected: true });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "clip" || !msg.text || !msg.hash) return;
      if (msg.text.length > cfg.maxBytes) return;
      if (msg.hash === state.lastHash) return;

      await clip.write(msg.text);
      state.lastHash = msg.hash;
      state.echoUntil = Date.now() + cfg.echoCooldownMs;
      state.lastSyncTime = new Date().toISOString();
      state.lastDirection = "received";
      state.syncCount++;
      addToHistory(msg.text, cfg.peer.split(":")[0]);
      log(`Received from peer (${msg.text.length} chars)`);
    } catch (e) {
      state.lastError = e.message;
    }
  });

  ws.on("close", () => {
    if (state.peerWs === ws) { state.peerWs = null; state.peerConnected = false; broadcastToUI({ type: "peer", connected: false }); }
    log("Peer disconnected");
  });
}

// Attach the /ws (peer) and /ui (browser push) upgrade routes to an http.Server.
function attachUpgradeHandler(server, getLanIp) {
  const { uiClients } = require("./history");

  server.on("upgrade", (req, socket, head) => {
    // Runs pre-auth on every raw connection attempt - a malformed Host header
    // or URL must never crash the whole daemon (this callback isn't wrapped
    // by Express's error handling, unlike the HTTP routes).
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (path === "/ws") {
        if (!auth.safeEqual(url.searchParams.get("token") || "", cfg.token)) {
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

      if (path === "/ui") {
        if (!auth.isAuthed(req, { token: url.searchParams.get("token") })) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          uiClients.add(ws);
          ws.on("close", () => uiClients.delete(ws));
          ws.send(JSON.stringify({
            type: "state",
            peerConnected: state.peerConnected,
            syncCount: state.syncCount,
            name: cfg.name,
            peer: cfg.peer,
            localIp: getLanIp() + ":" + cfg.port,
          }));
        });
        return;
      }

      socket.destroy();
    } catch (e) {
      log(`Rejected malformed upgrade request: ${e.message}`);
      socket.destroy();
    }
  });
}

module.exports = { state, poll, connectToPeer, handlePeer, attachUpgradeHandler, log, wss };
