const { test, expect } = require("@playwright/test");
const { seed, reset, count } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

// ── Dedup ────────────────────────────────────────────────────────────────────
test("Dedup removes exact-duplicate clips and toasts the count", async ({ page }) => {
  // 3 identical-text clips collapse to 1; 2 unique survive => 5 -> 3.
  // Identical text => identical hash => hash-based dedup removes 2.
  seed([
    { text: "dupe-text" },
    { text: "dupe-text" },
    { text: "dupe-text" },
    { text: "unique-one" },
    { text: "unique-two" },
  ]);
  await page.goto("/");
  await expect(page.locator(".clip")).toHaveCount(5);
  await page.locator('.qr-btn[title="Remove duplicates"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("2 dupes removed");
  await expect(page.locator(".clip")).toHaveCount(3);
  await expect.poll(() => count(), { timeout: 4000 }).toBe(3);
});

test("Dedup with no duplicates toasts No dupes and keeps all clips", async ({ page }) => {
  seed([{ text: "alpha-unique" }, { text: "beta-unique" }, { text: "gamma-unique" }]);
  await page.goto("/");
  await page.locator('.qr-btn[title="Remove duplicates"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("No dupes");
  await expect(page.locator(".clip")).toHaveCount(3);
});

test("Dedup issues a POST to /api/dedup", async ({ page }) => {
  seed([{ text: "x-one" }, { text: "x-two" }]);
  await page.goto("/");
  let postSeen = false;
  await page.route("**/api/dedup", (route) => {
    if (route.request().method() === "POST") postSeen = true;
    route.continue();
  });
  await page.locator('.qr-btn[title="Remove duplicates"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("No dupes");
  expect(postSeen).toBe(true);
});

// ── QR overlay ────────────────────────────────────────────────────────────────
test("QR button opens overlay with an image and a LAN url", async ({ page }) => {
  await page.goto("/");
  await page.locator('.qr-btn[title="QR Code"]').click();
  await expect(page.locator("#qrOverlay")).toHaveClass(/show/);
  await expect(page.locator("#qrImg")).toHaveAttribute("src", /qrserver\.com/);
  await expect(page.locator("#qrUrl")).toHaveText(/^http:\/\/.+:\d+$/);
});

test("QR copy-url button copies the url and toasts URL copied", async ({ page }) => {
  await page.goto("/");
  await page.locator('.qr-btn[title="QR Code"]').click();
  await expect(page.locator("#qrOverlay")).toHaveClass(/show/);
  const url = await page.locator("#qrUrl").textContent();
  await page.locator("#qrOverlay .copy-url").click();
  await expect(page.locator("#toastMsg")).toHaveText("URL copied");
  const v = await page.evaluate(() => navigator.clipboard.readText());
  expect(v).toBe(url);
});

test("QR overlay closes on backdrop click", async ({ page }) => {
  await page.goto("/");
  await page.locator('.qr-btn[title="QR Code"]').click();
  await expect(page.locator("#qrOverlay")).toHaveClass(/show/);
  // backdrop click (onclick removes show); click top-left away from url row
  await page.locator("#qrOverlay").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#qrOverlay")).not.toHaveClass(/show/);
});

test("Escape closes the QR overlay without throwing", async ({ page }) => {
  // The keydown Escape handler calls clearSearch() (now null-safe) and then
  // removes the overlay's `show` class. No pageerror should fire.
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  await page.goto("/");
  await page.locator('.qr-btn[title="QR Code"]').click();
  await expect(page.locator("#qrOverlay")).toHaveClass(/show/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#qrOverlay")).not.toHaveClass(/show/);
  expect(errors).toHaveLength(0);
});
