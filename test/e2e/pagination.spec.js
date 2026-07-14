const { test, expect } = require("@playwright/test");
const { seed, reset } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

// PAGE_SIZE = 9 in the UI.
function manyClips(n) {
  return Array.from({ length: n }, (_, i) => ({ text: "clip-number-" + i }));
}

test("pagination bar is hidden with <= 9 clips", async ({ page }) => {
  seed(manyClips(9));
  await page.goto("/");
  await expect(page.locator(".clip")).toHaveCount(9);
  await expect(page.locator("#pagBar")).toBeHidden();
});

test("pagination bar appears with > 9 clips", async ({ page }) => {
  seed(manyClips(15));
  await page.goto("/");
  // first page shows 9
  await expect(page.locator(".clip")).toHaveCount(9);
  await expect(page.locator("#pagBar")).toBeVisible();
  // 2 numbered page buttons (15 clips => 2 pages) plus prev/next chevrons
  await expect(page.locator("#pagBar button", { hasText: /^1$/ })).toHaveCount(1);
  await expect(page.locator("#pagBar button", { hasText: /^2$/ })).toHaveCount(1);
});

test("next chevron advances to page 2 showing remaining clips", async ({ page }) => {
  seed(manyClips(15));
  await page.goto("/");
  // next is the last button in the pag bar
  await page.locator("#pagBar button").last().click();
  // page 2 has 15 - 9 = 6 clips
  await expect(page.locator(".clip")).toHaveCount(6);
});

test("clicking a numbered page button switches pages", async ({ page }) => {
  seed(manyClips(15));
  await page.goto("/");
  await page.locator("#pagBar button", { hasText: /^2$/ }).click();
  await expect(page.locator(".clip")).toHaveCount(6);
  // back to page 1
  await page.locator("#pagBar button", { hasText: /^1$/ }).click();
  await expect(page.locator(".clip")).toHaveCount(9);
});

test("prev chevron returns to the previous page", async ({ page }) => {
  seed(manyClips(15));
  await page.goto("/");
  await page.locator("#pagBar button").last().click(); // go to page 2
  await expect(page.locator(".clip")).toHaveCount(6);
  await page.locator("#pagBar button").first().click(); // prev -> page 1
  await expect(page.locator(".clip")).toHaveCount(9);
});

test("page color theming changes the list border color between pages", async ({ page }) => {
  seed(manyClips(15));
  await page.goto("/");
  const list = page.locator("#clipList");
  const page1Color = await list.evaluate((el) => el.style.getPropertyValue("--pc"));
  await page.locator("#pagBar button", { hasText: /^2$/ }).click();
  const page2Color = await list.evaluate((el) => el.style.getPropertyValue("--pc"));
  expect(page1Color).not.toBe(page2Color);
});
