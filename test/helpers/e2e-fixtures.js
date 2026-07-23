// ── Fixed values shared by playwright.config.js and the e2e specs ────────────
// Not a real credential - a constant used only to authenticate requests against
// the throwaway, isolated e2e test server (see playwright.config.js webServer.env).
const E2E_TOKEN = "e2e-fixed-test-token";

module.exports = { E2E_TOKEN };
