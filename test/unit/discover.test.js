// ── Unit tests — src/discover.js line parsing + peer adopt/drop ──────────────
// The dns-sd output below is captured verbatim from a real macOS run, so a
// format change in a future macOS breaks these tests rather than discovery.
const discover = require("../../src/discover");
const cfg = require("../../src/config");
const peer = require("../../src/peer");

describe("parseBrowseLine()", () => {
  test("parses an Add", () => {
    expect(discover.parseBrowseLine(" 7:50:20.589  Add        3   1 local.               _clip._tcp.          M4probe"))
      .toEqual({ action: "Add", instance: "M4probe" });
  });

  test("parses a Rmv", () => {
    expect(discover.parseBrowseLine(" 7:51:02.110  Rmv        0  16 local.               _clip._tcp.          MacBook"))
      .toEqual({ action: "Rmv", instance: "MacBook" });
  });

  test("keeps spaces in an instance name", () => {
    expect(discover.parseBrowseLine(" 7:50:20.589  Add        3   1 local.               _clip._tcp.          Bunlong's MacBook Pro").instance)
      .toBe("Bunlong's MacBook Pro");
  });

  test("ignores the header and banner lines", () => {
    expect(discover.parseBrowseLine("Timestamp     A/R    Flags  if Domain               Service Type         Instance Name")).toBeNull();
    expect(discover.parseBrowseLine("Browsing for _clip._tcp.local")).toBeNull();
    expect(discover.parseBrowseLine(" 7:50:19.627  ...STARTING...")).toBeNull();
    expect(discover.parseBrowseLine("")).toBeNull();
  });
});

describe("parseResolveLine()", () => {
  test("extracts host:port and strips the trailing dot", () => {
    expect(discover.parseResolveLine(" 7:50:23.631  M4probe._clip._tcp.local. can be reached at M4.local.:4545 (interface 16) Flags: 1"))
      .toBe("M4.local:4545");
  });

  test("returns null for anything else", () => {
    expect(discover.parseResolveLine("Lookup M4probe._clip._tcp.local")).toBeNull();
  });
});

describe("adoptPeer() / dropPeer()", () => {
  const saved = { peer: cfg.peer, locked: cfg.peerLocked, name: cfg.name };
  afterEach(() => { cfg.peer = saved.peer; cfg.peerLocked = saved.locked; cfg.name = saved.name; });

  test("adopts a discovered address when no CLIP_PEER is pinned", () => {
    cfg.peer = ""; cfg.peerLocked = false; cfg.name = "M4";
    peer.adoptPeer("MacBook.local:4545", "MacBook");
    expect(cfg.peer).toBe("MacBook.local:4545");
  });

  test("an explicit CLIP_PEER wins over discovery", () => {
    cfg.peer = "10.0.0.9:4545"; cfg.peerLocked = true;
    peer.adoptPeer("MacBook.local:4545", "MacBook");
    expect(cfg.peer).toBe("10.0.0.9:4545");
  });

  test("dropPeer clears a discovered peer but never a pinned one", () => {
    cfg.peer = "MacBook.local:4545"; cfg.peerLocked = false;
    peer.dropPeer("MacBook");
    expect(cfg.peer).toBe("");

    cfg.peer = "10.0.0.9:4545"; cfg.peerLocked = true;
    peer.dropPeer("MacBook");
    expect(cfg.peer).toBe("10.0.0.9:4545");
  });
});
