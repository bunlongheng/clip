// ── ESLint flat config — src/ (Node CJS) + public/ (browser globals) ─────────
module.exports = [
  {
    ignores: ["node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", "docs/**"],
  },
  {
    files: ["src/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "writable", exports: "writable", __dirname: "readonly",
        process: "readonly", console: "readonly", setTimeout: "readonly", setInterval: "readonly",
        clearTimeout: "readonly", clearInterval: "readonly", Buffer: "readonly", fetch: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "writable", exports: "writable", __dirname: "readonly",
        process: "readonly", console: "readonly", setTimeout: "readonly", setInterval: "readonly",
        clearTimeout: "readonly", clearInterval: "readonly", Buffer: "readonly", fetch: "readonly",
        URL: "readonly", describe: "readonly", test: "readonly", expect: "readonly",
        beforeEach: "readonly", afterEach: "readonly", beforeAll: "readonly", afterAll: "readonly", vi: "readonly",
        // Playwright page.evaluate() callbacks run in the browser, not Node.
        navigator: "readonly", window: "readonly", document: "readonly", location: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly", location: "readonly",
        fetch: "readonly", WebSocket: "readonly", AudioContext: "readonly", requestAnimationFrame: "readonly",
        setTimeout: "readonly", setInterval: "readonly", clearTimeout: "readonly", console: "readonly",
      },
    },
    rules: {
      // Most top-level functions here are invoked from inline onclick="" attributes
      // in index.html, which static analysis can't see - only catch truly local
      // unused vars, not top-level function declarations.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", vars: "local" }],
      "no-undef": "error",
    },
  },
];
