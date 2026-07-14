const { test, expect } = require("@playwright/test");
const { seed, reset } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

test("page has title Clip", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Clip");
});

test("header logo, name and the three header buttons render", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".logo .logo-icon")).toBeVisible();
  await expect(page.locator(".logo span", { hasText: "Clip" }).first()).toBeVisible();
  // The three .qr-btn header buttons: Search, Dedup, QR
  await expect(page.locator('.qr-btn[title="Search (Cmd+K)"]')).toBeVisible();
  await expect(page.locator('.qr-btn[title="Remove duplicates"]')).toBeVisible();
  await expect(page.locator('.qr-btn[title="QR Code"]')).toBeVisible();
});

test("status bar shows the clip count", async ({ page }) => {
  seed([{ text: "alpha" }, { text: "beta" }]);
  await page.goto("/");
  await expect(page.locator("#statusBar")).toBeVisible();
  await expect(page.locator("#sClips")).toHaveText("2");
});

test("status count is zero when DB is empty", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sClips")).toHaveText("0");
});
