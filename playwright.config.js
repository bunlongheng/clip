// ── Playwright E2E config — drives the live Clip web UI ──────────────────────
const { defineConfig, devices } = require("@playwright/test");
const path = require("path");

// Isolated test instance: dedicated port, throwaway DB, dead peer, no polling.
const PORT = 4547;
const DB_PATH = path.join(__dirname, "test", ".tmp", "e2e.db");

module.exports = defineConfig({
  testDir: "./test/e2e",
  // The Clip server is a single shared process with one SQLite DB, so tests
  // run serially with one worker to keep seeded state deterministic.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node src/server.js",
    url: `http://localhost:${PORT}/status`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      CLIP_PORT: String(PORT),
      CLIP_DB_PATH: DB_PATH,
      CLIP_PEER: "127.0.0.1:9", // dead address — never connects, stays isolated
      CLIP_POLL_MS: "86400000", // effectively disable clipboard polling during tests
      CLIP_NAME: "TestMachine",
      STICKIES_API_TOKEN: "", // force the no-token path; tests stub /api/stickies
    },
  },
});

module.exports.E2E_PORT = PORT;
module.exports.E2E_DB_PATH = DB_PATH;
