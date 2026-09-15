// ── Bonjour peer discovery — find whichever Mac is running clip ───────────────
// Uses the dns-sd binary that ships with macOS, so no extra dependency. The
// point is that neither machine needs CLIP_PEER: each one advertises itself and
// adopts the first other clip it sees, so the link re-forms on its own after a
// DHCP change, a rename, a sleep/wake, or a reboot.
const { spawn } = require("child_process");

const SERVICE = "_clip._tcp";
const RESPAWN_MS = 5000;
const RESOLVE_TIMEOUT_MS = 5000;

// " 7:50:20.589  Add        3   1 local.  _clip._tcp.  M4probe"
const BROWSE_RE = /^\s*[\d:.]+\s+(Add|Rmv)\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+?)\s*$/;
// " 7:50:23.631  M4probe._clip._tcp.local. can be reached at M4.local.:4545 (interface 16)"
const RESOLVE_RE = /can be reached at ([^\s:]+):(\d+)/;

// dns-sd children are not reaped when the parent dies, and an orphaned
// "dns-sd -R" keeps advertising a service whose daemon is gone - the other
// machine then adopts a ghost. Track and kill them on the way out.
const children = new Set();
function track(child) {
  children.add(child);
  child.on("close", () => children.delete(child));
  return child;
}
let reaped = false;
function reap() {
  if (reaped) return;
  reaped = true;
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  children.clear();
}
process.on("exit", reap);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { reap(); process.exit(0); });
}

function parseBrowseLine(line) {
  const m = line.match(BROWSE_RE);
  return m ? { action: m[1], instance: m[2] } : null;
}

function parseResolveLine(line) {
  const m = line.match(RESOLVE_RE);
  return m ? `${m[1].replace(/\.$/, "")}:${m[2]}` : null;
}

// dns-sd blocks forever by design. If it dies (mDNSResponder restart, wake from
// sleep) respawn it, otherwise discovery silently stops working after a lid close.
function keepAlive(args, onLine) {
  let child = null;
  let stopped = false;
  const start = () => {
    if (stopped) return;
    child = track(spawn("dns-sd", args, { stdio: ["ignore", "pipe", "ignore"] }));
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      lines.forEach(onLine);
    });
    child.on("error", () => {}); // no dns-sd (non-macOS) — close handler retries
    child.on("close", () => {
      child = null;
      if (!stopped) setTimeout(start, RESPAWN_MS).unref();
    });
  };
  start();
  return () => { stopped = true; if (child) child.kill(); };
}

function resolveInstance(instance, cb) {
  const child = track(spawn("dns-sd", ["-L", instance, SERVICE, "local"], { stdio: ["ignore", "pipe", "ignore"] }));
  let done = false;
  const finish = (addr) => { if (done) return; done = true; child.kill(); cb(addr); };
  child.stdout.on("data", (d) => {
    const addr = parseResolveLine(d.toString());
    if (addr) finish(addr);
  });
  child.on("error", () => finish(null));
  setTimeout(() => finish(null), RESOLVE_TIMEOUT_MS).unref();
}

// Advertise this machine and adopt the first other one seen. onAdopt(addr,
// instance) / onDrop(instance) are called at most once per peer transition.
function start(cfg, { onAdopt, onDrop } = {}) {
  const stopAdvertise = keepAlive(["-R", cfg.name, SERVICE, "local", String(cfg.port)], () => {});

  let adopted = null;
  const pending = new Set();
  const stopBrowse = keepAlive(["-B", SERVICE, "local"], (line) => {
    const ev = parseBrowseLine(line);
    if (!ev || ev.instance === cfg.name) return; // header line, or ourselves
    if (ev.action === "Rmv") {
      if (adopted === ev.instance) { adopted = null; if (onDrop) onDrop(ev.instance); }
      return;
    }
    // The same service is announced once per interface — resolve it once.
    if (adopted || pending.has(ev.instance)) return;
    pending.add(ev.instance);
    resolveInstance(ev.instance, (addr) => {
      pending.delete(ev.instance);
      if (!addr || adopted) return;
      adopted = ev.instance;
      if (onAdopt) onAdopt(addr, ev.instance);
    });
  });

  return {
    stop: () => { stopAdvertise(); stopBrowse(); },
    // Called when the adopted peer never answers, so a different machine on the
    // network can be picked up instead of retrying a dead address forever.
    release: () => { adopted = null; },
  };
}

module.exports = { start, parseBrowseLine, parseResolveLine, reap, SERVICE };
