// ── Clip — Tiny clipboard sync daemon ────────────────────────────────────────
const http = require("http");
const cfg = require("./config");
const { getLanIp } = require("./net");
const { createApp } = require("./routes");
const peer = require("./peer");
const discover = require("./discover");
const history = require("./history");

const app = createApp();
const server = http.createServer(app);
peer.attachUpgradeHandler(server, getLanIp);

function boot() {
  server.listen(cfg.port, () => {
    const db = require("./db");
    const dupes = db.dedup();
    if (dupes) peer.log(`Cleaned ${dupes} duplicate clips`);
    peer.log(`Clip running on :${cfg.port}`);
    peer.log(`Machine: ${cfg.name}`);
    peer.log(`Peer: ${cfg.peer || "none"}`);
    peer.log(`UI: http://localhost:${cfg.port}`);
    setInterval(peer.poll, cfg.pollMs);
    // History still has to age out while nothing is being copied.
    if (db.MAX_AGE_MS) setInterval(() => db.pruneExpired(), 60000);
    peer.connectToPeer();
    // Advertise either way so the other machine can find us; only adopt what we
    // discover when no CLIP_PEER was pinned.
    const d = discover.start(cfg, { onAdopt: peer.adoptPeer, onDrop: peer.dropPeer });
    peer.setDiscoveryRelease(d.release);
  });
}

if (require.main === module) boot();

module.exports = {
  app, server, boot,
  // re-exported for tests / operational tooling
  getLanIp,
  log: peer.log,
  poll: peer.poll,
  connectToPeer: peer.connectToPeer,
  handlePeer: peer.handlePeer,
  peerState: peer.state,
  addToHistory: history.addToHistory,
  broadcastToUI: history.broadcastToUI,
  uiClients: history.uiClients,
};
