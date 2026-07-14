// ── Unit tests — src/clipboard.js (read/write via stubbed execSync, hash) ──
// clipstub patches child_process.execSync and MUST be required before
// src/clipboard, which destructures execSync at load time. This keeps the
// read/write tests deterministic (no subprocess timeout flakiness under load).
const clipstub = require("../helpers/clipstub");
const clip = require("../../src/clipboard");

let bin;
beforeEach(() => {
  bin = clipstub.setup();
});
afterEach(() => bin.restore());

describe("read()", () => {
  test("returns clipboard text", () => {
    bin.setClipboard("hello");
    expect(clip.read()).toBe("hello");
  });

  test("returns '' when pbpaste fails", () => {
    bin.setFail(true);
    expect(clip.read()).toBe("");
  });

  test("reads multi-line + unicode content verbatim", () => {
    const payload = "line1\nline2\nαβγ 🚀";
    bin.setClipboard(payload);
    expect(clip.read()).toBe(payload);
  });

  test("reads empty clipboard as empty string", () => {
    bin.setClipboard("");
    expect(clip.read()).toBe("");
  });
});

describe("write()", () => {
  test("pipes text to pbcopy", () => {
    clip.write("xyz");
    expect(bin.getWritten()).toBe("xyz");
  });

  test("round-trips multi-line + unicode text", () => {
    const payload = "héllo\nworld\n😀✅";
    clip.write(payload);
    expect(bin.getWritten()).toBe(payload);
  });

  test("swallows errors when pbcopy fails (never throws, never writes)", () => {
    bin.setFail(true);
    expect(() => clip.write("nope")).not.toThrow();
    expect(bin.getWritten()).toBe(null); // execSync threw before the write was recorded
  });

  test("written content is readable back through read()", () => {
    // mirror what write() captured into the read side, then read it back
    clip.write("round-trip");
    bin.setClipboard(bin.getWritten());
    expect(clip.read()).toBe("round-trip");
  });
});

describe("hash()", () => {
  test("is deterministic for the same input", () => {
    expect(clip.hash("abc")).toBe(clip.hash("abc"));
  });

  test("produces a 64-char lowercase hex string", () => {
    const h = clip.hash("anything");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h.length).toBe(64);
  });

  test("different inputs produce different hashes", () => {
    expect(clip.hash("foo")).not.toBe(clip.hash("bar"));
  });

  test("matches a known sha256 vector for empty string", () => {
    // sha256("") well-known digest
    expect(clip.hash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  test("handles unicode / emoji input deterministically", () => {
    const input = "αβγ 🚀 héllo";
    const h1 = clip.hash(input);
    const h2 = clip.hash(input);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is sensitive to trailing whitespace differences", () => {
    expect(clip.hash("a")).not.toBe(clip.hash("a "));
  });
});
