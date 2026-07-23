// ── Integration test — two REAL daemons, real HTTP + real peer WebSocket ─────
// Everything else in this suite tests handlePeer/poll/connectToPeer in
// isolation with fakes. This test is the one that actually proves the
// composed loop: two independent Clip processes, pointed at each other,
// with a clip copied on A landing in B's history exactly once (no echo
// bounce back to A). Each daemon runs in its own subprocess (real module
// singletons can't be instantiated twice in one process) with a stubbed
// clipboard so no test ever touches the real system clipboard.
const { fork } = require("child_process");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ENTRY = path.join(__dirname, "..", "helpers", "two-daemon-instance.js");
const TOKEN = "integration-shared-token";

function scratch(ext) {
  return path.join(os.tmpdir(), "clip-2daemon-" + crypto.randomBytes(6).toString("hex") + ext);
}

function startDaemon(port, peerPort, name) {
  const env = {
    ...process.env,
    CLIP_PORT: String(port),
    CLIP_PEER: peerPort ? `127.0.0.1:${peerPort}` : "",
    CLIP_TOKEN: TOKEN,
    CLIP_NAME: name,
    CLIP_DB_PATH: scratch(".db"),
    CLIP_ENV_PATH: scratch(".env"),
    CLIP_POLL_MS: "50",
  };
  return fork(ENTRY, [], { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
}

function waitForMessage(child, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { child.off("message", onMsg); reject(new Error("timeout waiting for message")); }, timeoutMs);
    function onMsg(msg) {
      if (predicate(msg)) { clearTimeout(t); child.off("message", onMsg); resolve(msg); }
    }
    child.on("message", onMsg);
  });
}

async function httpJson(port, urlPath) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

describe("two-daemon peer sync (real subprocesses, stubbed clipboard)", () => {
  let a, b;
  const PORT_A = 4700 + Math.floor(Math.random() * 200);
  const PORT_B = PORT_A + 1;

  beforeAll(async () => {
    a = startDaemon(PORT_A, PORT_B, "DaemonA");
    b = startDaemon(PORT_B, PORT_A, "DaemonB");
    await Promise.all([
      waitForMessage(a, (m) => m.type === "ready"),
      waitForMessage(b, (m) => m.type === "ready"),
    ]);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [sa, sb] = await Promise.all([httpJson(PORT_A, "/status"), httpJson(PORT_B, "/status")]);
      if (sa.peerConnected && sb.peerConnected) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("peers never reported connected");
  }, 10000);

  afterAll(() => {
    a?.kill();
    b?.kill();
  });

  test("a clip copied on A lands in B's history exactly once, and does not echo back to A", async () => {
    const text = "integration-sync-" + Date.now();
    a.send({ type: "setClipboard", text });
    await waitForMessage(a, (m) => m.type === "ack");

    // Poll B's history until the synced clip shows up.
    let found = null;
    const findDeadline = Date.now() + 4000;
    while (Date.now() < findDeadline && !found) {
      const j = await httpJson(PORT_B, "/api/clips");
      found = j.clips.find((c) => c.text === text);
      if (!found) await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBeTruthy();
    // handlePeer records the source as the peer's configured address (127.0.0.1),
    // not its CLIP_NAME — matches src/peer.js's cfg.peer.split(":")[0].
    expect(found.source).toBe("127.0.0.1");

    // Give the echo-suppression window (2s echoCooldownMs) time to matter,
    // then confirm A only has ONE copy of it — the echo guard, not luck.
    await new Promise((r) => setTimeout(r, 500));
    const ja = await httpJson(PORT_A, "/api/clips");
    const onA = ja.clips.filter((c) => c.text === text);
    expect(onA.length).toBe(1);
  }, 10000);

  test("B actually wrote the received clip to its (stubbed) clipboard", async () => {
    const text = "clipboard-write-check-" + Date.now();
    a.send({ type: "setClipboard", text });
    await waitForMessage(a, (m) => m.type === "ack");

    const deadline = Date.now() + 4000;
    let written = null;
    while (Date.now() < deadline && written !== text) {
      b.send({ type: "getWritten" });
      const msg = await waitForMessage(b, (m) => m.type === "written");
      written = msg.text;
      if (written !== text) await new Promise((r) => setTimeout(r, 100));
    }
    expect(written).toBe(text);
  }, 10000);
});
