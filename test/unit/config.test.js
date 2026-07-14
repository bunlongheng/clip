// ── Unit tests — src/config.js (env-driven config built at require-time) ──────
// config.js reads env vars when the module is first required. vi.resetModules
// is unreliable for CJS, so we load the config in a fresh child process for
// every assertion and parse the JSON it prints.
const { execFileSync } = require("child_process");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const CLIP_KEYS = [
  "CLIP_NAME",
  "CLIP_PORT",
  "CLIP_PEER",
  "CLIP_TOKEN",
  "CLIP_POLL_MS",
  "CLIP_MAX_BYTES",
  "CLIP_DB_PATH",
];

// Load config in a child process with a fully controlled environment.
// removeKeys: env vars to delete (so defaults kick in).
// overrides: env vars to set.
function loadConfigClean(removeKeys = [], overrides = {}) {
  const env = { ...process.env };
  for (const k of removeKeys) delete env[k];
  Object.assign(env, overrides);
  const out = execFileSync(
    "node",
    ["-e", 'process.stdout.write(JSON.stringify(require("./src/config")))'],
    { cwd: PROJECT_ROOT, env, encoding: "utf8" }
  );
  return JSON.parse(out);
}

// For default assertions, always strip ALL CLIP_* vars the parent shell may
// already have set, so we observe the in-code fallbacks.
function loadDefaults(overrides = {}) {
  return loadConfigClean(CLIP_KEYS, overrides);
}

describe("port", () => {
  test("defaults to 4545", () => {
    expect(loadDefaults().port).toBe(4545);
  });

  test("honors CLIP_PORT override", () => {
    expect(loadDefaults({ CLIP_PORT: "8080" }).port).toBe(8080);
  });

  test("is parsed as an integer (number, not string)", () => {
    const cfg = loadDefaults({ CLIP_PORT: "7000" });
    expect(typeof cfg.port).toBe("number");
    expect(cfg.port).toBe(7000);
  });
});

describe("peer", () => {
  test("defaults to empty (no peer, UI only)", () => {
    expect(loadDefaults().peer).toBe("");
  });

  test("honors CLIP_PEER override", () => {
    expect(loadDefaults({ CLIP_PEER: "192.168.1.5:9000" }).peer).toBe(
      "192.168.1.5:9000"
    );
  });
});

describe("token", () => {
  test("defaults to clip-sync-secret", () => {
    expect(loadDefaults().token).toBe("clip-sync-secret");
  });

  test("honors CLIP_TOKEN override", () => {
    expect(loadDefaults({ CLIP_TOKEN: "supersecret" }).token).toBe("supersecret");
  });
});

describe("pollMs", () => {
  test("defaults to 400", () => {
    expect(loadDefaults().pollMs).toBe(400);
  });

  test("honors CLIP_POLL_MS override and parses to integer", () => {
    const cfg = loadDefaults({ CLIP_POLL_MS: "1000" });
    expect(cfg.pollMs).toBe(1000);
    expect(typeof cfg.pollMs).toBe("number");
  });
});

describe("maxBytes", () => {
  test("defaults to 102400 (100KB)", () => {
    expect(loadDefaults().maxBytes).toBe(102400);
  });

  test("honors CLIP_MAX_BYTES override", () => {
    expect(loadDefaults({ CLIP_MAX_BYTES: "5000" }).maxBytes).toBe(5000);
  });

  test("is a number, not a string", () => {
    expect(typeof loadDefaults().maxBytes).toBe("number");
  });
});

describe("name", () => {
  test("honors CLIP_NAME override", () => {
    expect(loadDefaults({ CLIP_NAME: "my-mac" }).name).toBe("my-mac");
  });

  test("falls back to a non-empty hostname string when CLIP_NAME is removed", () => {
    const cfg = loadDefaults();
    expect(typeof cfg.name).toBe("string");
    expect(cfg.name.length).toBeGreaterThan(0);
  });
});

describe("echoCooldownMs", () => {
  test("is the fixed value 2000 regardless of env", () => {
    expect(loadDefaults().echoCooldownMs).toBe(2000);
    expect(loadDefaults({ CLIP_PORT: "9999" }).echoCooldownMs).toBe(2000);
  });
});

describe("types", () => {
  test("port, pollMs, and maxBytes are all numbers", () => {
    const cfg = loadDefaults();
    expect(typeof cfg.port).toBe("number");
    expect(typeof cfg.pollMs).toBe("number");
    expect(typeof cfg.maxBytes).toBe("number");
  });
});
