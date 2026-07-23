// ── Integration tests — HTTP routes + WebSocket upgrade on src/server.js ─────
// Token MUST be set before requiring server/config so cfg picks up a known value.
const { tmpDbPath, makeClip } = require("../helpers/factory");

process.env.CLIP_DB_PATH = tmpDbPath();
process.env.CLIP_PEER = "127.0.0.1:9";        // dead peer — connectToPeer never connects
process.env.CLIP_TOKEN = "route-test-token";  // fixed, known token for every request below
process.env.CLIP_ENV_PATH = require("path").join(require("os").tmpdir(), "clip-route-test-env-" + Date.now() + ".env");
process.env.STICKIES_API_TOKEN = "test-token"; // enable the stickies success path
process.env.STICKIES_API_URL = "http://localhost:4444";

const { makeServer, http, HttpResponse, STICKIES_BASE } = require("../msw/handlers");
const db = require("../../src/db");
const cfg = require("../../src/config");
const srv = require("../../src/server");
const WS = require("ws");

const msw = makeServer();

let server, base, port;
const AUTH = { Authorization: `Bearer ${cfg.token}` };

beforeAll(async () => {
  msw.listen({ onUnhandledRequest: "bypass" }); // let our own fetch() pass through
  server = srv.server.listen(0);
  await new Promise((r) => server.once("listening", r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

afterEach(() => msw.resetHandlers());

afterAll(() => {
  msw.close();
  return new Promise((r) => server.close(r));
});

beforeEach(() => {
  for (const r of db.all(99999)) db.remove(r.id);
});

// Helper: seed a clip and return its id.
function seed(spec) {
  const c = makeClip(spec);
  db.add(c);
  return c.id;
}

// ── GET / ────────────────────────────────────────────────────────────────────
describe("GET /", () => {
  test("without a token returns 401 and does NOT leak clip content", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("CLIP_TOKEN");
  });

  test("with the correct bearer token returns 200 HTML containing the document + title", async () => {
    const res = await fetch(`${base}/`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<title>Clip</title>");
  });

  test("with the correct token sets a clip_token cookie for subsequent requests", async () => {
    const res = await fetch(`${base}/?token=${cfg.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") || "").toContain("clip_token=");
  });

  test("with a wrong token returns 401", async () => {
    const res = await fetch(`${base}/?token=not-the-token`);
    expect(res.status).toBe(401);
  });
});

// ── GET /status — intentionally NOT gated (local health check convenience) ───
describe("GET /status", () => {
  test("returns the running status JSON shape with no auth required", async () => {
    const res = await fetch(`${base}/status`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.running).toBe(true);
    expect(j.name).toBe(cfg.name);
    expect(j.peer).toBe(cfg.peer);
    expect(j).toHaveProperty("peerConnected");
    expect(j).toHaveProperty("startedAt");
    expect(j).toHaveProperty("historyCount");
  });

  test("historyCount reflects the live db.count()", async () => {
    seed({ text: "status count one", source: "M4" });
    seed({ text: "status count two", source: "M4" });
    const res = await fetch(`${base}/status`);
    const j = await res.json();
    expect(j.historyCount).toBe(2);
  });
});

// ── /api/* auth gate ─────────────────────────────────────────────────────────
describe("/api/* auth", () => {
  test("GET /api/clips without a token is rejected", async () => {
    const res = await fetch(`${base}/api/clips`);
    expect(res.status).toBe(401);
  });

  test("GET /api/clips with the wrong token is rejected", async () => {
    const res = await fetch(`${base}/api/clips`, { headers: { Authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
  });

  test("GET /api/clips with the correct bearer token succeeds", async () => {
    const res = await fetch(`${base}/api/clips`, { headers: AUTH });
    expect(res.status).toBe(200);
  });
});

// ── GET /api/clips ───────────────────────────────────────────────────────────
describe("GET /api/clips", () => {
  test("returns all clips when no query is given", async () => {
    seed({ text: "all one", source: "M4" });
    seed({ text: "all two", source: "M4" });
    const res = await fetch(`${base}/api/clips`, { headers: AUTH });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.clips)).toBe(true);
    expect(j.clips).toHaveLength(2);
    expect(j.search).toBeUndefined();
  });

  test("returns search results + {search:true, query} when ?q= is provided", async () => {
    seed({ text: "needle haystack", source: "M4" });
    seed({ text: "totally unrelated", source: "M4" });
    const res = await fetch(`${base}/api/clips?q=needle`, { headers: AUTH });
    const j = await res.json();
    expect(j.search).toBe(true);
    expect(j.query).toBe("needle");
    expect(j.clips).toHaveLength(1);
    expect(j.clips[0].text).toBe("needle haystack");
  });

  test("a blank/whitespace query falls back to returning all clips (no search flag)", async () => {
    seed({ text: "blank query a", source: "M4" });
    const res = await fetch(`${base}/api/clips?q=%20%20`, { headers: AUTH });
    const j = await res.json();
    expect(j.search).toBeUndefined();
    expect(j.clips).toHaveLength(1);
  });

  test("returns an empty array when there are no clips", async () => {
    const res = await fetch(`${base}/api/clips`, { headers: AUTH });
    const j = await res.json();
    expect(j.clips).toEqual([]);
  });
});

// ── GET /api/config ──────────────────────────────────────────────────────────
describe("GET /api/config", () => {
  test("returns this machine's name for the client to bootstrap LOCAL_NAME", async () => {
    const res = await fetch(`${base}/api/config`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe(cfg.name);
  });
});

// ── PUT /api/clips/:id ───────────────────────────────────────────────────────
describe("PUT /api/clips/:id", () => {
  test("a successful update returns {ok:true} and mutates the DB row (trimmed)", async () => {
    const id = seed({ text: "before edit", source: "M4" });
    const res = await fetch(`${base}/api/clips/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "  after edit  " }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const row = db.all(99999).find((c) => c.id === id);
    expect(row.text).toBe("after edit"); // trimmed
  });

  test("returns {ok:false} for empty text", async () => {
    const id = seed({ text: "keep me", source: "M4" });
    const res = await fetch(`${base}/api/clips/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "" }),
    });
    expect((await res.json()).ok).toBe(false);
  });

  test("returns {ok:false} for whitespace-only text", async () => {
    const id = seed({ text: "still here", source: "M4" });
    const res = await fetch(`${base}/api/clips/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "   \n  " }),
    });
    expect((await res.json()).ok).toBe(false);
  });

  test("returns {ok:false} for an unknown id (nothing to update)", async () => {
    const res = await fetch(`${base}/api/clips/does-not-exist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "valid text" }),
    });
    expect((await res.json()).ok).toBe(false);
  });

  test("broadcasts an 'updated' message and updates the DB row on success", async () => {
    const id = seed({ text: "broadcast edit", source: "M4" });
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    await fetch(`${base}/api/clips/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "new value" }),
    });
    srv.uiClients.delete(fake);
    const msg = fake.sent.map((m) => JSON.parse(m)).find((m) => m.type === "updated");
    expect(msg).toBeDefined();
    expect(msg.id).toBe(id);
    expect(msg.text).toBe("new value");
    expect(db.all(99999).find((c) => c.id === id).text).toBe("new value");
  });
});

// ── DELETE /api/clips/:id ────────────────────────────────────────────────────
describe("DELETE /api/clips/:id", () => {
  test("deletes an existing clip and returns {ok:true}", async () => {
    const id = seed({ text: "delete me", source: "M4" });
    const res = await fetch(`${base}/api/clips/${id}`, { method: "DELETE", headers: AUTH });
    expect((await res.json()).ok).toBe(true);
    expect(db.all(99999).find((c) => c.id === id)).toBeUndefined();
  });

  test("returns {ok:false} for an unknown id", async () => {
    const res = await fetch(`${base}/api/clips/nope`, { method: "DELETE", headers: AUTH });
    expect((await res.json()).ok).toBe(false);
  });

  test("broadcasts {type:'delete'} on success", async () => {
    const id = seed({ text: "delete broadcast", source: "M4" });
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    await fetch(`${base}/api/clips/${id}`, { method: "DELETE", headers: AUTH });
    srv.uiClients.delete(fake);
    const msg = fake.sent.map((m) => JSON.parse(m)).find((m) => m.type === "delete");
    expect(msg).toEqual({ type: "delete", id });
  });
});

// ── POST /api/stickies ───────────────────────────────────────────────────────
describe("POST /api/stickies", () => {
  test("returns {ok:false} for empty text", async () => {
    const res = await fetch(`${base}/api/stickies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "" }),
    });
    expect((await res.json()).ok).toBe(false);
  });

  test("returns {ok:false, error} when STICKIES_API_TOKEN is not set and minting fails", async () => {
    // Mock the mint endpoint to fail deterministically — bypass mode would
    // otherwise hit whatever is actually listening on :4444 on this machine.
    msw.use(http.post(`${STICKIES_BASE}/api/stickies/keys`, () =>
      HttpResponse.json({ error: "no bootstrap secret" }, { status: 403 })
    ));
    const saved = process.env.STICKIES_API_TOKEN;
    delete process.env.STICKIES_API_TOKEN; // route reads env at request time
    try {
      const res = await fetch(`${base}/api/stickies`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ text: "some note" }),
      });
      const j = await res.json();
      expect(j.ok).toBe(false);
      expect(j.error).toContain("mint failed");
    } finally {
      process.env.STICKIES_API_TOKEN = saved;
    }
  });

  test("returns {ok:true} when Stickies accepts the note (returns a note object)", async () => {
    const res = await fetch(`${base}/api/stickies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "Title line\nbody content" }),
    });
    expect((await res.json()).ok).toBe(true);
  });

  test("returns {ok:false} when Stickies responds without a note object", async () => {
    msw.use(http.post(`${STICKIES_BASE}/api/stickies/ext`, () => HttpResponse.json({})));
    const res = await fetch(`${base}/api/stickies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "no note returned" }),
    });
    expect((await res.json()).ok).toBe(false);
  });

  test("returns {ok:false} when the Stickies call errors (non-ok status)", async () => {
    msw.use(http.post(`${STICKIES_BASE}/api/stickies/ext`, () =>
      HttpResponse.json({ note: { id: 1 } }, { status: 500 })
    ));
    const res = await fetch(`${base}/api/stickies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ text: "server error path" }),
    });
    expect((await res.json()).ok).toBe(false);
  });
});

// ── GET /manifest.json — static asset, no auth ───────────────────────────────
describe("GET /manifest.json", () => {
  test("returns the PWA manifest JSON", async () => {
    const res = await fetch(`${base}/manifest.json`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.name).toBe("Clip");
    expect(j.short_name).toBe("Clip");
    expect(j.icons[0].src).toBe("/icon.svg");
  });
});

// ── GET /icon.svg — static asset, no auth ────────────────────────────────────
describe("GET /icon.svg", () => {
  test("returns an SVG image", async () => {
    const res = await fetch(`${base}/icon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
  });
});

// ── GET /client.js — static asset, no auth ───────────────────────────────────
describe("GET /client.js", () => {
  test("serves the extracted frontend script", async () => {
    const res = await fetch(`${base}/client.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("function render");
    expect(body).toContain("openModal");
  });
});

// ── GET /api/qr ──────────────────────────────────────────────────────────────
describe("GET /api/qr", () => {
  test("returns {url, ip, port}", async () => {
    const res = await fetch(`${base}/api/qr`, { headers: AUTH });
    const j = await res.json();
    expect(j.port).toBe(cfg.port);
    expect(typeof j.ip).toBe("string");
    expect(j.url).toBe(`http://${j.ip}:${cfg.port}`);
  });
});

// ── GET /api/setup ───────────────────────────────────────────────────────────
describe("GET /api/setup", () => {
  test("returns {status, thisMachine, peer, setup} WITHOUT leaking the token", async () => {
    const res = await fetch(`${base}/api/setup`, { headers: AUTH });
    const j = await res.json();
    expect(["connected", "disconnected"]).toContain(j.status);
    expect(j.thisMachine.name).toBe(cfg.name);
    expect(j.peer.addr).toBe(cfg.peer);
    expect(j.setup).toHaveProperty("instructions");
    expect(j.setup.env.CLIP_TOKEN).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain(cfg.token);
  });
});

// ── POST /api/dedup ──────────────────────────────────────────────────────────
describe("POST /api/dedup", () => {
  test("returns {ok, removed:0, cleaned:0, deduped:0} when there is nothing to remove", async () => {
    seed({ text: "unique dedup one", source: "M4" });
    seed({ text: "unique dedup two", source: "M4" });
    const res = await fetch(`${base}/api/dedup`, { method: "POST", headers: AUTH });
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.removed).toBe(0);
    expect(j.cleaned).toBe(0);
    expect(j.deduped).toBe(0);
  });

  test("removes duplicate-hash clips and reports them in 'deduped' + 'removed'", async () => {
    const text = "dup hash content";
    const h = require("../../src/clipboard").hash(text).slice(0, 12);
    seed({ text, hash: h, source: "M4", id: "dup-a", time: "2024-01-01T00:00:00.000Z" });
    seed({ text, hash: h, source: "M4", id: "dup-b", time: "2024-01-02T00:00:00.000Z" });
    const res = await fetch(`${base}/api/dedup`, { method: "POST", headers: AUTH });
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.removed).toBeGreaterThanOrEqual(1);
    expect(j.deduped).toBeGreaterThanOrEqual(1);
    expect(db.count()).toBe(1);
  });

  test("broadcasts {type:'dedup', removed} when removed > 0", async () => {
    const text = "dup broadcast content";
    const h = require("../../src/clipboard").hash(text).slice(0, 12);
    seed({ text, hash: h, source: "M4", id: "db-a", time: "2024-01-01T00:00:00.000Z" });
    seed({ text, hash: h, source: "M4", id: "db-b", time: "2024-01-02T00:00:00.000Z" });
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    await fetch(`${base}/api/dedup`, { method: "POST", headers: AUTH });
    srv.uiClients.delete(fake);
    const msg = fake.sent.map((m) => JSON.parse(m)).find((m) => m.type === "dedup");
    expect(msg).toBeDefined();
    expect(msg.removed).toBeGreaterThanOrEqual(1);
  });

  test("does NOT broadcast when nothing is removed", async () => {
    seed({ text: "lonely clip", source: "M4" });
    const fake = { readyState: 1, sent: [], send(m) { this.sent.push(m); } };
    srv.uiClients.add(fake);
    await fetch(`${base}/api/dedup`, { method: "POST", headers: AUTH });
    srv.uiClients.delete(fake);
    const msg = fake.sent.map((m) => JSON.parse(m)).find((m) => m.type === "dedup");
    expect(msg).toBeUndefined();
  });
});

// ── Unknown route ────────────────────────────────────────────────────────────
describe("unknown route", () => {
  test("returns 404 for an unmapped path", async () => {
    const res = await fetch(`${base}/totally/not/a/route`);
    expect(res.status).toBe(404);
  });
});

// ── WebSocket upgrade ────────────────────────────────────────────────────────
describe("WebSocket upgrade", () => {
  const sockets = [];
  function track(ws) {
    // Swallow late async errors (e.g. closing a still-connecting socket).
    ws.on("error", () => {});
    sockets.push(ws);
    return ws;
  }
  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      try {
        // CONNECTING(0) sockets can't be terminated cleanly; wait for them to
        // resolve one way or the other, then close, swallowing any error.
        if (ws.readyState === WS.OPEN) ws.close();
        else if (ws.readyState === WS.CONNECTING) {
          await new Promise((r) => {
            const done = () => r();
            ws.once("open", () => { ws.close(); r(); });
            ws.once("close", done);
            ws.once("error", done);
            setTimeout(done, 500);
          });
        }
      } catch {}
    }
  });

  test("/ui without a token is rejected (connection fails/closes)", async () => {
    const ws = track(new WS(`ws://127.0.0.1:${port}/ui`));
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve("no-open"), 4000);
      ws.on("open", () => { clearTimeout(t); resolve("opened"); });
      ws.on("error", () => { clearTimeout(t); resolve("error"); });
      ws.on("unexpected-response", () => { clearTimeout(t); resolve("unexpected-response"); });
    });
    expect(result).not.toBe("opened");
  });

  test("/ui with the correct token accepts the connection and sends an initial {type:'state'} message", async () => {
    const ws = track(new WS(`ws://127.0.0.1:${port}/ui?token=${cfg.token}`));
    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for state")), 4000);
      ws.on("message", (data) => { clearTimeout(t); resolve(JSON.parse(data.toString())); });
      ws.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    expect(msg.type).toBe("state");
    expect(msg.name).toBe(cfg.name);
    expect(msg.peer).toBe(cfg.peer);
  });

  test("/ui registers the socket in uiClients and removes it on close", async () => {
    const ws = track(new WS(`ws://127.0.0.1:${port}/ui?token=${cfg.token}`));
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout open")), 4000);
      ws.on("open", () => { clearTimeout(t); resolve(); });
      ws.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    // Give the server a tick to register, then assert it is tracked.
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.uiClients.size).toBeGreaterThanOrEqual(1);
    const closed = new Promise((r) => ws.on("close", r));
    ws.close();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.uiClients.size).toBe(0);
  });

  test("/ws without a token is rejected (connection fails/closes)", async () => {
    const ws = track(new WS(`ws://127.0.0.1:${port}/ws`));
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve("no-open"), 4000);
      ws.on("open", () => { clearTimeout(t); resolve("opened"); });
      ws.on("error", () => { clearTimeout(t); resolve("error"); });
      ws.on("unexpected-response", () => { clearTimeout(t); resolve("unexpected-response"); });
    });
    expect(result).not.toBe("opened");
  });

  test("/ws with the correct token upgrades successfully", async () => {
    const ws = track(new WS(`ws://127.0.0.1:${port}/ws?token=${cfg.token}`));
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve("no-open"), 4000);
      ws.on("open", () => { clearTimeout(t); resolve("opened"); });
      ws.on("error", () => { clearTimeout(t); resolve("error"); });
      ws.on("unexpected-response", () => { clearTimeout(t); resolve("unexpected-response"); });
    });
    expect(result).toBe("opened");
  });

  test("an unknown ws path is destroyed (no successful upgrade)", async () => {
    const ws = track(new WS(`ws://127.0.0.1:${port}/garbage`));
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve("no-open"), 4000);
      ws.on("open", () => { clearTimeout(t); resolve("opened"); });
      ws.on("error", () => { clearTimeout(t); resolve("error"); });
      ws.on("close", () => { clearTimeout(t); resolve("closed"); });
    });
    expect(result).not.toBe("opened");
  });

  test("/ui with a malformed percent-encoded cookie does not crash the server (rejected, not a 500/hang)", async () => {
    // decodeURIComponent("%") throws — auth.js's cookieToken must swallow it,
    // not let it escape the pre-auth upgrade handler and kill the process.
    const ws = track(new WS(`ws://127.0.0.1:${port}/ui`, { headers: { Cookie: "clip_token=%" } }));
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve("no-open"), 4000);
      ws.on("open", () => { clearTimeout(t); resolve("opened"); });
      ws.on("error", () => { clearTimeout(t); resolve("error"); });
      ws.on("unexpected-response", () => { clearTimeout(t); resolve("unexpected-response"); });
    });
    expect(result).not.toBe("opened"); // treated as unauthenticated, not a crash

    // The server must still be alive and answering afterward.
    const res = await fetch(`${base}/status`);
    expect(res.status).toBe(200);
  });

  test("a raw upgrade request with a malformed Host header does not crash the server", async () => {
    // `new URL(req.url, "http://" + req.headers.host)` throws on a bad Host -
    // this must be caught, not left to kill the whole process.
    const net = require("net");
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write(
          "GET /ui HTTP/1.1\r\n" +
          "Host: [not a valid host\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "\r\n"
        );
      });
      const t = setTimeout(() => { socket.destroy(); resolve("timeout"); }, 4000);
      socket.on("close", () => { clearTimeout(t); resolve("closed"); });
      socket.on("error", () => { clearTimeout(t); resolve("closed"); });
    });
    expect(result).toBe("closed"); // socket destroyed, not left hanging or crashing the process

    // The server must still be alive and answering afterward.
    const res = await fetch(`${base}/status`);
    expect(res.status).toBe(200);
  });
});
