// ── Clipboard — read/write via macOS pbpaste/pbcopy ─────────────────────────
const { execSync } = require("child_process");
const crypto = require("crypto");

function read() {
  try {
    return execSync("pbpaste", { encoding: "utf8", timeout: 2000, env: { ...process.env, LANG: "en_US.UTF-8" } });
  } catch {
    return "";
  }
}

function write(text) {
  try {
    execSync("pbcopy", { input: text, encoding: "utf8", timeout: 2000, env: { ...process.env, LANG: "en_US.UTF-8" } });
  } catch {}
}

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

module.exports = { read, write, hash };
