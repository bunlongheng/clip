// ── Shared-token auth — used by HTTP routes, GET /, and both WebSockets ───────
const crypto = require("crypto");
const cfg = require("./config");

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function cookieToken(cookieHeader) {
  if (!cookieHeader) return "";
  const m = cookieHeader.match(/(?:^|;\s*)clip_token=([^;]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return ""; // malformed percent-encoding (e.g. a bare "%") - treat as no cookie
  }
}

// query is an optional plain object (raw http upgrade handlers don't get req.query).
function tokenFromRequest(req, query) {
  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  const q = query || req.query;
  if (q && q.token) return q.token;
  return cookieToken(req.headers && req.headers.cookie);
}

function isAuthed(req, query) {
  return safeEqual(tokenFromRequest(req, query), cfg.token);
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: "unauthorized - missing or invalid token" });
  next();
}

module.exports = { safeEqual, tokenFromRequest, isAuthed, requireAuth };
