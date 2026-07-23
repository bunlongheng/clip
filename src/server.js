// ── Clip — Tiny clipboard sync daemon ────────────────────────────────────────
const http = require("http");
const cfg = require("./config");
const { getLanIp } = require("./net");
const { createApp } = require("./routes");
const peer = require("./peer");
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
    peer.connectToPeer();
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
