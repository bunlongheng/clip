// ── Deterministic clipboard stub — patches child_process.execSync ────────────
// clipboard.js does `const { execSync } = require("child_process")`, capturing
// the reference at load time. Requiring THIS helper before src/clipboard (or
// src/server) replaces execSync first, so the captured reference is our stub.
// Unlike a fake pbpaste/pbcopy on PATH, this spawns no subprocess, so it is
// fully deterministic (no execSync timeout flakiness under load) while still
// exercising clipboard.js's real read/write/error-handling logic.
const cp = require("child_process");

let state = { clipboard: "", written: null, fail: false };
const realExecSync = cp.execSync;

cp.execSync = (cmd, opts) => {
  if (state.fail) throw new Error("command failed (stubbed)");
  if (cmd === "pbpaste") return state.clipboard;
  if (cmd === "pbcopy") {
    state.written = opts && opts.input != null ? opts.input : "";
    return "";
  }
  return realExecSync(cmd, opts);
};

function reset() {
  state = { clipboard: "", written: null, fail: false };
}

// setup() returns per-test controls for the stubbed clipboard.
function setup() {
  reset();
  return {
    setClipboard: (t) => { state.clipboard = t; },
    getWritten: () => state.written,
    setFail: (on) => { state.fail = !!on; },
    restore: reset,
  };
}

module.exports = { setup, reset };
