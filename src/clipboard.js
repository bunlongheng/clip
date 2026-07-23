// ── Clipboard — read/write via macOS pbpaste/pbcopy ─────────────────────────
const { execFile } = require("child_process");
const { promisify } = require("util");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);
const OPTS = { encoding: "utf8", timeout: 2000, env: { ...process.env, LANG: "en_US.UTF-8" } };

async function read() {
  try {
    const { stdout } = await execFileAsync("pbpaste", [], OPTS);
    return stdout;
  } catch (e) {
    console.error("[clip] pbpaste failed:", e.message);
    return "";
  }
}

async function write(text) {
  try {
    await execFileAsync("pbcopy", [], { ...OPTS, input: text });
  } catch (e) {
    console.error("[clip] pbcopy failed:", e.message);
  }
}

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

module.exports = { read, write, hash };
