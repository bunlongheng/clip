// ── Unit tests — src/db.js (better-sqlite3 persistence layer) ─────────────────
// CLIP_DB_PATH must be set BEFORE requiring src/db so the module opens an
// isolated throwaway database for this test file.
const { tmpDbPath, makeClip } = require("../helpers/factory");
process.env.CLIP_DB_PATH = tmpDbPath();
const db = require("../../src/db");

// Helper: produce an ISO timestamp offset (ms) from a fixed base so ordering is
// deterministic. Larger offset => newer.
const BASE = Date.parse("2026-01-01T00:00:00.000Z");
function tAt(offsetMs) {
  return new Date(BASE + offsetMs).toISOString();
}

// Clean slate before each test.
beforeEach(() => {
  for (const r of db.all(99999)) db.remove(r.id);
});

describe("add() + count() + all()", () => {
  test("add inserts a row and count reflects it", () => {
    expect(db.count()).toBe(0);
    db.add(makeClip({ id: "a1", text: "alpha" }));
    expect(db.count()).toBe(1);
  });

  test("all() returns the inserted row with all schema fields", () => {
    db.add(makeClip({ id: "a1", text: "alpha", source: "M4", time: tAt(0) }));
    const rows = db.all();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.id).toBe("a1");
    expect(r.text).toBe("alpha");
    expect(r.preview).toBe("alpha");
    expect(r.length).toBe(5);
    expect(r.source).toBe("M4");
    expect(typeof r.hash).toBe("string");
    expect(r.time).toBe(tAt(0));
  });

  test("adding multiple rows increments count accordingly", () => {
    db.add(makeClip({ id: "a1" }));
    db.add(makeClip({ id: "a2" }));
    db.add(makeClip({ id: "a3" }));
    expect(db.count()).toBe(3);
  });

  test("count() is 0 on an empty table", () => {
    expect(db.count()).toBe(0);
  });
});

describe("add() — INSERT OR IGNORE on duplicate id", () => {
  test("ignores a second insert with the same id (keeps original)", () => {
    db.add(makeClip({ id: "dup", text: "first" }));
    db.add(makeClip({ id: "dup", text: "second" }));
    expect(db.count()).toBe(1);
    expect(db.all()[0].text).toBe("first");
  });
});

describe("all() — limit + ordering", () => {
  test("orders by time DESC (newest first)", () => {
    db.add(makeClip({ id: "old", text: "old", time: tAt(0) }));
    db.add(makeClip({ id: "mid", text: "mid", time: tAt(1000) }));
    db.add(makeClip({ id: "new", text: "new", time: tAt(2000) }));
    const ids = db.all().map((r) => r.id);
    expect(ids).toEqual(["new", "mid", "old"]);
  });

  test("respects the limit argument", () => {
    for (let i = 0; i < 5; i++) {
      db.add(makeClip({ id: "r" + i, time: tAt(i * 1000) }));
    }
    expect(db.all(2)).toHaveLength(2);
  });

  test("default limit is 100 (returns all when fewer than 100 rows)", () => {
    for (let i = 0; i < 10; i++) db.add(makeClip({ id: "r" + i, time: tAt(i * 1000) }));
    expect(db.all()).toHaveLength(10);
  });

  test("limit larger than row count returns all rows", () => {
    db.add(makeClip({ id: "x1" }));
    db.add(makeClip({ id: "x2" }));
    expect(db.all(1000)).toHaveLength(2);
  });

  test("limit of 0 returns no rows", () => {
    db.add(makeClip({ id: "x1" }));
    expect(db.all(0)).toHaveLength(0);
  });

  test("returns an empty array when table is empty", () => {
    expect(db.all()).toEqual([]);
  });
});

describe("search()", () => {
  beforeEach(() => {
    db.add(makeClip({ id: "s1", text: "hello world", time: tAt(0) }));
    db.add(makeClip({ id: "s2", text: "goodbye world", time: tAt(1000) }));
    db.add(makeClip({ id: "s3", text: "totally different", time: tAt(2000) }));
  });

  test("matches a substring (LIKE %query%)", () => {
    const ids = db.search("world").map((r) => r.id).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });

  test("matches a unique substring returning a single row", () => {
    const rows = db.search("goodbye");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("s2");
  });

  test("returns [] when nothing matches", () => {
    expect(db.search("zzz-nomatch")).toEqual([]);
  });

  test("orders matches by time DESC", () => {
    const ids = db.search("world").map((r) => r.id);
    expect(ids).toEqual(["s2", "s1"]); // s2 newer than s1
  });

  test("respects the limit argument", () => {
    expect(db.search("world", 1)).toHaveLength(1);
  });

  test("is case-sensitive for non-ASCII-default LIKE on mixed case", () => {
    // SQLite LIKE is case-insensitive for ASCII by default, so "HELLO" matches.
    expect(db.search("HELLO").map((r) => r.id)).toEqual(["s1"]);
  });

  test("empty query matches every row (wildcard %%)", () => {
    expect(db.search("")).toHaveLength(3);
  });
});

describe("remove()", () => {
  test("returns true and deletes when the row exists", () => {
    db.add(makeClip({ id: "del1" }));
    expect(db.remove("del1")).toBe(true);
    expect(db.count()).toBe(0);
  });

  test("returns false when the id does not exist", () => {
    expect(db.remove("nope")).toBe(false);
  });

  test("only removes the targeted row", () => {
    db.add(makeClip({ id: "keep" }));
    db.add(makeClip({ id: "drop" }));
    db.remove("drop");
    expect(db.all().map((r) => r.id)).toEqual(["keep"]);
  });
});

describe("update()", () => {
  test("changes text, preview, and length; returns true", () => {
    db.add(makeClip({ id: "u1", text: "old" }));
    expect(db.update("u1", "brand new value")).toBe(true);
    const r = db.all()[0];
    expect(r.text).toBe("brand new value");
    expect(r.preview).toBe("brand new value");
    expect(r.length).toBe("brand new value".length);
  });

  test("returns false for an unknown id", () => {
    expect(db.update("missing", "whatever")).toBe(false);
  });

  test("truncates preview to 2000 chars while text keeps full length", () => {
    db.add(makeClip({ id: "u2", text: "x" }));
    const big = "y".repeat(5000);
    expect(db.update("u2", big)).toBe(true);
    const r = db.all()[0];
    expect(r.text).toBe(big);
    expect(r.text.length).toBe(5000);
    expect(r.preview.length).toBe(2000);
    expect(r.length).toBe(5000);
  });

  test("does not affect other rows", () => {
    db.add(makeClip({ id: "a", text: "aaa", time: tAt(0) }));
    db.add(makeClip({ id: "b", text: "bbb", time: tAt(1000) }));
    db.update("a", "changed");
    const byId = Object.fromEntries(db.all().map((r) => [r.id, r.text]));
    expect(byId.a).toBe("changed");
    expect(byId.b).toBe("bbb");
  });

  test("preview equals text when text is shorter than 2000 chars", () => {
    db.add(makeClip({ id: "u3", text: "abc" }));
    db.update("u3", "short value");
    expect(db.all()[0].preview).toBe("short value");
  });
});

describe("add() — prune to max 500 newest by time", () => {
  test("keeps exactly 500 rows and drops the oldest when 505 are added", () => {
    // Insert 505 rows with strictly increasing time. r0 is oldest, r504 newest.
    for (let i = 0; i < 505; i++) {
      db.add(makeClip({ id: "p" + i, text: "row" + i, time: tAt(i * 1000) }));
    }
    expect(db.count()).toBe(500);
    const ids = new Set(db.all(99999).map((r) => r.id));
    // Oldest 5 should be pruned.
    expect(ids.has("p0")).toBe(false);
    expect(ids.has("p4")).toBe(false);
    // The 5th-oldest kept and newest kept.
    expect(ids.has("p5")).toBe(true);
    expect(ids.has("p504")).toBe(true);
  });

  test("does not prune when at or below 500 rows", () => {
    for (let i = 0; i < 500; i++) {
      db.add(makeClip({ id: "q" + i, time: tAt(i * 1000) }));
    }
    expect(db.count()).toBe(500);
    expect(db.all(99999)).toHaveLength(500);
  });

  test("newest row survives pruning when added last", () => {
    for (let i = 0; i < 510; i++) {
      db.add(makeClip({ id: "z" + i, time: tAt(i * 1000) }));
    }
    expect(db.count()).toBe(500);
    expect(db.all(1)[0].id).toBe("z509");
  });
});

describe("dedup() — exact hash duplicates", () => {
  test("removes exact-hash duplicates keeping one, returns removed count", () => {
    db.add(makeClip({ id: "h1", text: "same", hash: "HASHX", time: tAt(0) }));
    db.add(makeClip({ id: "h2", text: "same", hash: "HASHX", time: tAt(1000) }));
    db.add(makeClip({ id: "h3", text: "same", hash: "HASHX", time: tAt(2000) }));
    const removed = db.dedup();
    expect(removed).toBe(2);
    expect(db.count()).toBe(1);
  });

  test("keeps the first-seen (newest by time DESC) of a hash group", () => {
    db.add(makeClip({ id: "h1", text: "v", hash: "H", time: tAt(0) }));
    db.add(makeClip({ id: "h2", text: "v", hash: "H", time: tAt(5000) }));
    db.dedup();
    // all() orders DESC, so h2 (newest) is iterated first and kept.
    expect(db.all().map((r) => r.id)).toEqual(["h2"]);
  });

  test("leaves rows with distinct hashes untouched", () => {
    db.add(makeClip({ id: "d1", text: "a", hash: "HA" }));
    db.add(makeClip({ id: "d2", text: "b", hash: "HB" }));
    expect(db.dedup()).toBe(0);
    expect(db.count()).toBe(2);
  });
});

describe("dedup() — fuzzy prefix (first 60 chars)", () => {
  test("keeps the LONGEST of clips sharing the same 60-char prefix", () => {
    const prefix = "P".repeat(60);
    db.add(makeClip({ id: "f1", text: prefix + "short", length: prefix.length + 5, hash: "FH1", time: tAt(0) }));
    db.add(makeClip({ id: "f2", text: prefix + "the longest tail here", length: prefix.length + 21, hash: "FH2", time: tAt(1000) }));
    db.add(makeClip({ id: "f3", text: prefix + "mid", length: prefix.length + 3, hash: "FH3", time: tAt(2000) }));
    const removed = db.dedup();
    expect(removed).toBe(2);
    expect(db.all().map((r) => r.id)).toEqual(["f2"]);
  });

  test("does not group clips whose first 60 chars differ", () => {
    db.add(makeClip({ id: "g1", text: "A".repeat(60) + "x", hash: "GH1" }));
    db.add(makeClip({ id: "g2", text: "B".repeat(60) + "x", hash: "GH2" }));
    expect(db.dedup()).toBe(0);
    expect(db.count()).toBe(2);
  });

  test("short clips (under 60 chars) only group on identical text prefix", () => {
    // Two different short texts -> different slice keys -> no dedup.
    db.add(makeClip({ id: "s1", text: "apple", hash: "SH1" }));
    db.add(makeClip({ id: "s2", text: "apricot", hash: "SH2" }));
    expect(db.dedup()).toBe(0);
    expect(db.count()).toBe(2);
  });

  test("hash dedup and fuzzy dedup combine in a single pass", () => {
    const prefix = "Q".repeat(60);
    // Two share a hash (exact dup), plus a third shares the prefix but is longer.
    db.add(makeClip({ id: "c1", text: prefix + "a", length: prefix.length + 1, hash: "CH", time: tAt(0) }));
    db.add(makeClip({ id: "c2", text: prefix + "a", length: prefix.length + 1, hash: "CH", time: tAt(1000) }));
    db.add(makeClip({ id: "c3", text: prefix + "longer-tail", length: prefix.length + 11, hash: "CH2", time: tAt(2000) }));
    const removed = db.dedup();
    // c1/c2 collapse to one by hash, then fuzzy keeps the longest (c3).
    expect(removed).toBe(2);
    expect(db.all().map((r) => r.id)).toEqual(["c3"]);
  });

  test("returns 0 when there is nothing to dedup", () => {
    db.add(makeClip({ id: "u1", text: "unique-one", hash: "U1" }));
    db.add(makeClip({ id: "u2", text: "unique-two", hash: "U2" }));
    expect(db.dedup()).toBe(0);
    expect(db.count()).toBe(2);
  });

  test("returns 0 on an empty table", () => {
    expect(db.dedup()).toBe(0);
  });

  test("ties on length keep exactly one row in the group", () => {
    const prefix = "T".repeat(60);
    db.add(makeClip({ id: "t1", text: prefix + "AA", length: prefix.length + 2, hash: "TH1", time: tAt(0) }));
    db.add(makeClip({ id: "t2", text: prefix + "BB", length: prefix.length + 2, hash: "TH2", time: tAt(1000) }));
    const removed = db.dedup();
    expect(removed).toBe(1);
    expect(db.count()).toBe(1);
  });
});

describe("cleanup()", () => {
  test("removes clips where more than 30% of chars are '?'", () => {
    // 4 of 5 chars are '?' => ratio 0.8 > 0.3
    db.add(makeClip({ id: "bad1", text: "????x", hash: "B1" }));
    const removed = db.cleanup();
    expect(removed).toBe(1);
    expect(db.count()).toBe(0);
  });

  test("keeps normal clips with few or no '?' chars", () => {
    db.add(makeClip({ id: "ok1", text: "hello world", hash: "O1" }));
    db.add(makeClip({ id: "ok2", text: "what? a single question mark in a long sentence is fine", hash: "O2" }));
    expect(db.cleanup()).toBe(0);
    expect(db.count()).toBe(2);
  });

  test("returns the number of clips removed", () => {
    db.add(makeClip({ id: "b1", text: "?????", hash: "C1" }));
    db.add(makeClip({ id: "b2", text: "??x", hash: "C2" })); // 2/3 = 0.66 > 0.3
    db.add(makeClip({ id: "g1", text: "perfectly normal text", hash: "C3" }));
    expect(db.cleanup()).toBe(2);
    expect(db.all().map((r) => r.id)).toEqual(["g1"]);
  });

  test("removes clips containing mojibake double-encoded UTF-8", () => {
    // Two consecutive chars from the mojibake set (e.g. ÄÄ) match.
    db.add(makeClip({ id: "moji", text: "headerÄÄfooter", hash: "M1" }));
    expect(db.cleanup()).toBe(1);
    expect(db.count()).toBe(0);
  });

  test("a clip exactly at 30% '?' ratio is NOT removed (strictly greater)", () => {
    // 3 of 10 chars are '?' => ratio exactly 0.3, not > 0.3
    db.add(makeClip({ id: "edge", text: "???abcdefg", hash: "E1" }));
    expect(db.cleanup()).toBe(0);
    expect(db.count()).toBe(1);
  });

  test("returns 0 when there is nothing to clean", () => {
    db.add(makeClip({ id: "clean", text: "all good here", hash: "CL1" }));
    expect(db.cleanup()).toBe(0);
    expect(db.count()).toBe(1);
  });

  test("does not treat a single mojibake char as corruption", () => {
    // Single Ä (only one of the set) should NOT match the {2} regex.
    db.add(makeClip({ id: "one", text: "cafÄ normal text here", hash: "ONE" }));
    expect(db.cleanup()).toBe(0);
    expect(db.count()).toBe(1);
  });
});
