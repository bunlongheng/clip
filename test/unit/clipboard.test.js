// ── Unit tests — src/clipboard.js (async read/write via stubbed execFile, hash) ──
// clipstub patches child_process.execFile and MUST be required before
// src/clipboard, which destructures execFile at load time. This keeps the
// read/write tests deterministic (no subprocess timeout flakiness under load).
const clipstub = require("../helpers/clipstub");
const clip = require("../../src/clipboard");

let bin;
beforeEach(() => {
  bin = clipstub.setup();
});
afterEach(() => bin.restore());

describe("read()", () => {
  test("returns clipboard text", async () => {
    bin.setClipboard("hello");
    expect(await clip.read()).toBe("hello");
  });

  test("returns '' when pbpaste fails", async () => {
    bin.setFail(true);
    expect(await clip.read()).toBe("");
  });

  test("reads multi-line + unicode content verbatim", async () => {
    const payload = "line1\nline2\nαβγ 🚀";
    bin.setClipboard(payload);
    expect(await clip.read()).toBe(payload);
  });

  test("reads empty clipboard as empty string", async () => {
    bin.setClipboard("");
    expect(await clip.read()).toBe("");
  });
});

describe("write()", () => {
  test("pipes text to pbcopy", async () => {
    await clip.write("xyz");
    expect(bin.getWritten()).toBe("xyz");
  });

  test("round-trips multi-line + unicode text", async () => {
    const payload = "héllo\nworld\n😀✅";
    await clip.write(payload);
    expect(bin.getWritten()).toBe(payload);
  });

  test("swallows errors when pbcopy fails (never throws, never writes)", async () => {
    bin.setFail(true);
    await expect(clip.write("nope")).resolves.not.toThrow();
    expect(bin.getWritten()).toBe(null); // execFile failed before the write was recorded
  });

  test("written content is readable back through read()", async () => {
    // mirror what write() captured into the read side, then read it back
    await clip.write("round-trip");
    bin.setClipboard(bin.getWritten());
    expect(await clip.read()).toBe("round-trip");
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
