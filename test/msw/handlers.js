// ── MSW handlers — mock external services the Clip backend calls ─────────────
// The only outbound call Clip makes is POST {STICKIES_API_URL}/api/stickies/ext
// when forwarding a clip to the Stickies app. Tests use these to avoid hitting
// the real Stickies service.
const { http, HttpResponse } = require("msw");
const { setupServer } = require("msw/node");

const STICKIES_BASE = "http://localhost:4444";

// Default: Stickies accepts the note and echoes a created `note` object.
const handlers = [
  http.post(`${STICKIES_BASE}/api/stickies/ext`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return HttpResponse.json({ ok: true, note: { id: "note-1", title: body.title } });
  }),
];

// Build a server for node-env unit tests.
function makeServer(extra = []) {
  return setupServer(...handlers, ...extra);
}

module.exports = { handlers, makeServer, http, HttpResponse, STICKIES_BASE };
