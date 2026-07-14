const { test, expect } = require("@playwright/test");
const { seed, reset } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

test("empty state is visible with no clips", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#emptyState")).toContainText("Copy something to get started");
  await expect(page.locator(".clip")).toHaveCount(0);
});

test("empty state is hidden when clips exist", async ({ page }) => {
  seed([{ text: "hello world" }]);
  await page.goto("/");
  await expect(page.locator(".clip")).toHaveCount(1);
  // display:none -> not visible
  await expect(page.locator("#emptyState")).toBeHidden();
});
