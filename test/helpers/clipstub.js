// ── Deterministic clipboard stub — patches child_process.execFile ────────────
// clipboard.js does `const { execFile } = require("child_process")` and wraps
// it with util.promisify, capturing the reference at load time. Requiring
// THIS helper before src/clipboard (or anything that requires it) replaces
// execFile first, so the captured reference is our stub. Unlike a fake
// pbpaste/pbcopy on PATH, this spawns no subprocess, so it is fully
// deterministic while still exercising clipboard.js's real async read/write logic.
const cp = require("child_process");
const util = require("util");

let state = { clipboard: "", written: null, fail: false };
const realExecFile = cp.execFile;

function execFileStub(cmd, args, options, callback) {
  if (typeof options === "function") { callback = options; options = undefined; }
  process.nextTick(() => {
    if (state.fail) return callback(new Error("command failed (stubbed)"));
    if (cmd === "pbpaste") return callback(null, state.clipboard, "");
    if (cmd === "pbcopy") {
      state.written = options && options.input != null ? options.input : "";
      return callback(null, "", "");
    }
    return realExecFile(cmd, args, options, callback);
  });
}
// Node's real execFile resolves { stdout, stderr } when promisified - match that.
execFileStub[util.promisify.custom] = (cmd, args, options) =>
  new Promise((resolve, reject) => {
    execFileStub(cmd, args, options, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout, stderr });
    });
  });

cp.execFile = execFileStub;

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
