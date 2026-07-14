// ── Vitest config — unit/integration tests for the Clip backend ─────────────
const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    // Node env: Clip is a vanilla Node daemon (no React/DOM modules to import).
    environment: "node",
    globals: true,
    include: ["test/unit/**/*.test.js"],
    // better-sqlite3 is a native addon — child-process isolation per file is
    // both safer than worker threads and gives each test file a clean DB.
    pool: "forks",
    // Run test files one at a time. Several suites shell out (fake pbpaste/pbcopy,
    // child-process config loads, HTTP servers); running files in parallel put
    // enough load on the box to occasionally trip clipboard.js's 2s execSync
    // timeout. Sequential files keep the suite deterministic (100% green).
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.js"],
      // src/server.js embeds the entire web UI as a template-literal string;
      // that client JS is exercised by the Playwright E2E suite, not Vitest.
      all: true,
    },
  },
});
