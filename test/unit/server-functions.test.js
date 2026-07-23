// ── Unit tests — internal functions exported by src/server.js ────────────────
// Requiring src/server.js does NOT start the listener (boot is guarded by
// require.main === module).
const { tmpDbPath, makeClip } = require("../helpers/factory");

// Must be set BEFORE requiring src/db or src/server so each file is isolated.
process.env.CLIP_DB_PATH = tmpDbPath();
process.env.CLIP_PEER = "127.0.0.1:9"; // dead address — connectToPeer never connects
process.env.CLIP_ENV_PATH = require("path").join(require("os").tmpdir(), "clip-test-env-" + Date.now() + ".env");
process.env.CLIP_TOKEN = "server-functions-test-token"; // fixed - skip auto-generation + .env writes

// clipstub patches child_process.execFile and MUST be required before
// src/clipboard / src/server (which destructure execFile at load time).
const clipstub = require("../helpers/clipstub");
const db = require("../../src/db");
const clip = require("../../src/clipboard");
const srv = require("../../src/server");

// Clipboard reads/writes are now async (execFile, not execSync). The stub
// resolves on process.nextTick, so give pending microtasks a moment to settle
// after emitting a peer "message" event before asserting on side effects.
const flush = () => new Promise((r) => setTimeout(r, 20));

// Counter to guarantee unique clip text per call (avoids anti-smash surprises).
let uniq = 0;
const u = (s) => `${s} ${Date.now()}-${uniq++}`;

beforeEach(() => {
  for (const r of db.all(99999)) db.remove(r.id);
});

// ── getLanIp ─────────────────────────────────────────────────────────────────
describe("getLanIp", () => {
  test("returns a string", () => {
    expect(typeof srv.getLanIp()).toBe("string");
  });

  test("returns a non-internal IPv4 dotted-quad or the literal 'localhost'", () => {
    const ip = srv.getLanIp();
    const isIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
    expect(isIpv4 || ip === "localhost").toBe(true);
  });
});

// ── log ──────────────────────────────────────────────────────────────────────
describe("log", () => {
  test("does not throw", () => {
    expect(() => srv.log("hello from test")).not.toThrow();
  });

  test("writes a [clip]-prefixed line to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    srv.log("a-test-message");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("[clip]");
    expect(spy.mock.calls[0][0]).toContain("a-test-message");
    spy.mockRestore();
  });
});

// ── broadcastToUI / uiClients ────────────────────────────────────────────────
describe("broadcastToUI", () => {
  test("sends the JSON-stringified payload to an OPEN client", () => {
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    srv.broadcastToUI({ type: "x", n: 1 });
    srv.uiClients.delete(fake);
    expect(fake.sent).toHaveLength(1);
    expect(JSON.parse(fake.sent[0])).toEqual({ type: "x", n: 1 });
  });

  test("does NOT send to a non-OPEN (closed) client", () => {
    const closed = { readyState: 3, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(closed);
    srv.broadcastToUI({ type: "y" });
    srv.uiClients.delete(closed);
    expect(closed.sent).toHaveLength(0);
  });

  test("swallows errors thrown by a client's send()", () => {
    const thrower = { readyState: 1, send() { throw new Error("boom"); } };
    srv.uiClients.add(thrower);
    expect(() => srv.broadcastToUI({ type: "z" })).not.toThrow();
    srv.uiClients.delete(thrower);
  });

  test("delivers to all OPEN clients in the set", () => {
    const a = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    const b = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(a);
    srv.uiClients.add(b);
    srv.broadcastToUI({ type: "multi", v: 42 });
    srv.uiClients.delete(a);
    srv.uiClients.delete(b);
    expect(JSON.parse(a.sent[0])).toEqual({ type: "multi", v: 42 });
    expect(JSON.parse(b.sent[0])).toEqual({ type: "multi", v: 42 });
  });
});

// ── addToHistory ─────────────────────────────────────────────────────────────
describe("addToHistory", () => {
  test("inserts a new entry and returns it with the expected shape", () => {
    const text = u("brand new clip");
    const before = db.count();
    const entry = srv.addToHistory(text, "M4");
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({ text, source: "M4" });
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("hash");
    expect(entry.hash).toHaveLength(12);
    expect(entry.length).toBe(text.length);
    expect(db.count()).toBe(before + 1);
  });

  test("records the supplied source", () => {
    const entry = srv.addToHistory(u("source check"), "PEER-HOST");
    expect(entry.source).toBe("PEER-HOST");
  });

  test("trims surrounding whitespace and strips leading whitespace per line", () => {
    const raw = "  \n   line one\n      line two   \n  ";
    const entry = srv.addToHistory(raw, "M4");
    expect(entry.text).toBe("line one\nline two");
  });

  test("anti-smash: identical text re-added within 1s returns null and adds nothing", () => {
    const text = u("smash me");
    const first = srv.addToHistory(text, "M4");
    expect(first).not.toBeNull();
    const after = db.count();
    const second = srv.addToHistory(text, "M4");
    expect(second).toBeNull();
    expect(db.count()).toBe(after);
  });

  test("dedup-bump: re-adding an existing (older) hash moves it to top and broadcasts 'bump'", () => {
    // Seed an existing clip directly in the DB with a known hash. Its text is
    // unique, so anti-smash cannot block the re-add (no filler clip needed — a
    // filler would race the bump on the same-millisecond timestamp and make the
    // "newest row" assertion below nondeterministic).
    const text = "bump target content unique-xyz";
    const h = clip.hash(text).slice(0, 12);
    db.add(makeClip({ text, hash: h, source: "OLD", time: "2000-01-01T00:00:00.000Z" }));

    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    const countBefore = db.count();
    const result = srv.addToHistory(text, "M4");
    srv.uiClients.delete(fake);

    expect(result).not.toBeNull();
    expect(result.source).toBe("M4"); // source updated on bump
    // Existing entry removed + re-added => count unchanged.
    expect(db.count()).toBe(countBefore);
    const bumpMsgs = fake.sent.map((m) => JSON.parse(m)).filter((m) => m.type === "bump");
    expect(bumpMsgs.length).toBe(1);
    expect(bumpMsgs[0].clip.hash).toBe(h);
    // It is now the newest row.
    expect(db.all(1)[0].hash).toBe(h);
  });

  test("broadcasts a 'new-clip' message when inserting a brand new entry", () => {
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    const text = u("fresh broadcast");
    srv.addToHistory(text, "M4");
    srv.uiClients.delete(fake);
    const newMsgs = fake.sent.map((m) => JSON.parse(m)).filter((m) => m.type === "new-clip");
    expect(newMsgs.length).toBe(1);
    expect(newMsgs[0].clip.text).toBe(text);
  });

  test("computes a 12-char hash equal to clip.hash(trimmed).slice(0,12)", () => {
    const text = u("hash equality");
    const entry = srv.addToHistory(text, "M4");
    expect(entry.hash).toBe(clip.hash(text).slice(0, 12));
  });
});

// ── poll (now async — pbpaste is awaited, not executed synchronously) ────────
describe("poll", () => {
  let bin;
  beforeEach(() => { bin = clipstub.setup(); });
  afterEach(() => bin.restore());

  test("adds new clipboard content to history", async () => {
    const text = u("polled clipboard value");
    bin.setClipboard(text);
    const before = db.count();
    await srv.poll();
    expect(db.count()).toBe(before + 1);
    expect(db.all(1)[0].text).toBe(text);
  });

  test("is a no-op when the clipboard is empty", async () => {
    bin.setClipboard("");
    const before = db.count();
    await srv.poll();
    expect(db.count()).toBe(before);
  });

  test("is a no-op when the clipboard hash is unchanged since the last poll", async () => {
    const text = u("repeat clipboard");
    bin.setClipboard(text);
    await srv.poll();                 // records it, updates lastHash
    const after = db.count();
    await srv.poll();                 // same hash → returns early
    expect(db.count()).toBe(after);
  });

  test("a slow-resolving pbpaste can't overlap with itself (re-entrancy guard)", async () => {
    const text = u("overlap guard");
    bin.setClipboard(text);
    const first = srv.poll();
    const second = srv.poll(); // fires while `first` is still in flight — should no-op
    await Promise.all([first, second]);
    expect(db.count()).toBe(1);
  });
});

// ── poll → peer sync ──────────────────────────────────────────────────────────
// Placed BEFORE the handlePeer block on purpose: handlePeer's receive tests set
// the module-level echo cooldown (echoUntil), which would make poll() return
// early. Here echoUntil is still 0, so poll() runs the send-to-peer branch.
describe("poll → peer sync", () => {
  const { EventEmitter } = require("events");
  let bin;
  beforeEach(() => { bin = clipstub.setup(); });
  afterEach(() => bin.restore());

  // Connect an OPEN fake peer so poll()'s `peerWs.readyState === OPEN` branch fires.
  function connectedPeer() {
    const ws = new EventEmitter();
    ws.readyState = 1; // WebSocket.OPEN
    ws.sent = [];
    ws.send = (m) => ws.sent.push(m);
    srv.handlePeer(ws); // sets the module-level peerWs = ws
    return ws;
  }

  test("sends new clipboard content to a connected peer", async () => {
    const ws = connectedPeer();
    const text = u("sync me to the peer");
    bin.setClipboard(text);
    await srv.poll();
    ws.readyState = 3; // CLOSED — so later polls don't re-send to this socket
    const clipMsg = ws.sent.map((m) => JSON.parse(m)).find((m) => m.type === "clip");
    expect(clipMsg).toBeDefined();
    expect(clipMsg.text).toBe(text);
    expect(clipMsg.hash).toBe(clip.hash(text));
  });

  test("records but does NOT send a clip larger than cfg.maxBytes to the peer", async () => {
    const ws = connectedPeer();
    const big = "y".repeat(102401); // > 100KB default
    bin.setClipboard(big);
    const before = db.count();
    await srv.poll();
    ws.readyState = 3;
    expect(db.count()).toBe(before + 1); // still recorded locally
    const clipMsg = ws.sent.map((m) => JSON.parse(m)).find((m) => m.type === "clip");
    expect(clipMsg).toBeUndefined(); // but never forwarded to the peer
  });
});

// ── handlePeer ───────────────────────────────────────────────────────────────
describe("handlePeer", () => {
  const { EventEmitter } = require("events");
  let bin;
  beforeEach(() => { bin = clipstub.setup(); });
  afterEach(() => bin.restore());

  function fakeWs() {
    const ws = new EventEmitter();
    ws.send = () => {};
    return ws;
  }

  test("on connect broadcasts {type:'peer', connected:true}", () => {
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    const ws = fakeWs();
    srv.handlePeer(ws);
    srv.uiClients.delete(fake);
    ws.emit("close");
    const peerMsg = fake.sent.map((m) => JSON.parse(m)).find((m) => m.type === "peer");
    expect(peerMsg).toEqual({ type: "peer", connected: true });
  });

  test("writes a received clip to the clipboard and records it in history", async () => {
    const ws = fakeWs();
    srv.handlePeer(ws);
    const text = u("from peer");
    const hash = clip.hash(text); // distinct from lastHash so it isn't ignored
    const before = db.count();
    ws.emit("message", JSON.stringify({ type: "clip", text, hash }));
    await flush();
    ws.emit("close");
    expect(bin.getWritten()).toBe(text);
    expect(db.count()).toBe(before + 1);
    expect(db.all(1)[0].text).toBe(text);
  });

  test("ignores non-'clip' message types", async () => {
    const ws = fakeWs();
    srv.handlePeer(ws);
    const before = db.count();
    ws.emit("message", JSON.stringify({ type: "ping", text: u("nope"), hash: "abc123def456" }));
    await flush();
    ws.emit("close");
    expect(db.count()).toBe(before);
    expect(bin.getWritten()).toBeNull();
  });

  test("ignores a clip whose text exceeds cfg.maxBytes", async () => {
    const ws = fakeWs();
    srv.handlePeer(ws);
    const big = "x".repeat(102401); // > 100KB default
    const before = db.count();
    ws.emit("message", JSON.stringify({ type: "clip", text: big, hash: clip.hash(big) }));
    await flush();
    ws.emit("close");
    expect(db.count()).toBe(before);
    expect(bin.getWritten()).toBeNull();
  });

  test("ignores a clip whose hash equals the current lastHash (echo guard)", async () => {
    // Prime lastHash by delivering a peer clip with a unique hash (handlePeer
    // sets lastHash = msg.hash). This is independent of poll()/echoUntil state.
    const ws = fakeWs();
    srv.handlePeer(ws);
    const primeText = u("echo prime");
    const primeHash = clip.hash(primeText); // unique → not equal to stale lastHash
    ws.emit("message", JSON.stringify({ type: "clip", text: primeText, hash: primeHash }));
    await flush();
    const before = db.count();
    // Different text but the SAME hash as lastHash → should be ignored.
    ws.emit("message", JSON.stringify({ type: "clip", text: "different payload", hash: primeHash }));
    await flush();
    ws.emit("close");
    expect(db.count()).toBe(before);
  });
});

// ── peer resilience (error path + reconnect guard) ────────────────────────────
describe("peer resilience", () => {
  const { EventEmitter } = require("events");
  let bin;
  beforeEach(() => { bin = clipstub.setup(); });
  afterEach(() => bin.restore());

  test("handlePeer swallows a malformed (non-JSON) peer message without throwing", async () => {
    const ws = new EventEmitter();
    ws.send = () => {};
    srv.handlePeer(ws);
    const before = db.count();
    expect(() => ws.emit("message", "this is not json {")).not.toThrow();
    await flush();
    ws.emit("close");
    expect(db.count()).toBe(before); // nothing recorded
    expect(bin.getWritten()).toBeNull(); // nothing written to the clipboard
  });

  test("connectToPeer does not open a new socket when a peer is already connected", () => {
    const ws = new EventEmitter();
    ws.readyState = 1; // WebSocket.OPEN
    ws.send = () => {};
    srv.handlePeer(ws); // peerWs is now OPEN
    expect(() => srv.connectToPeer()).not.toThrow(); // hits the already-connected guard
    ws.readyState = 3; // CLOSED
  });

  test("peer state resets on close, so connectToPeer no longer hits the already-connected guard", () => {
    const ws = new EventEmitter();
    ws.readyState = 1; // WebSocket.OPEN
    ws.send = () => {};
    srv.handlePeer(ws);
    expect(srv.peerState.peerConnected).toBe(true);

    ws.readyState = 3; // CLOSED
    ws.emit("close");
    expect(srv.peerState.peerConnected).toBe(false);
    expect(srv.peerState.peerWs).toBeNull();
    // With peerWs cleared, connectToPeer's already-connected guard no longer
    // applies — it proceeds to attempt a new outgoing connection (against the
    // dead CLIP_PEER address from this file's env, so it fails async and
    // schedules its own retry; we only assert it doesn't throw synchronously
    // and doesn't short-circuit).
    expect(() => srv.connectToPeer()).not.toThrow();
  });
});
