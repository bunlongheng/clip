// ── Child-process entry for the two-daemon peer-sync integration test ────────
// Runs one real Clip daemon (real HTTP + WS + poll loop) with a stubbed
// clipboard, controlled over IPC from the parent test process.
const clipstub = require("./clipstub"); // must patch execFile before src/clipboard loads
const bin = clipstub.setup();
const srv = require("../../src/server");

srv.boot();

process.on("message", (msg) => {
  if (msg.type === "setClipboard") {
    bin.setClipboard(msg.text);
    process.send({ type: "ack" });
  }
  if (msg.type === "getWritten") {
    process.send({ type: "written", text: bin.getWritten() });
  }
});

process.send({ type: "ready" });
