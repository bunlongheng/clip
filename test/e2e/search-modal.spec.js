const { test, expect } = require("@playwright/test");
const { seed, reset } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

async function seedThree(page) {
  seed([{ text: "apple pie" }, { text: "banana split" }, { text: "cherry cake" }]);
  await page.goto("/");
}

test("Search header button opens the search modal", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await expect(page.locator("#searchModal")).toHaveClass(/show/);
  await expect(page.locator("#searchModalInput")).toBeFocused();
});

test("Cmd+K opens the search modal", async ({ page }) => {
  await seedThree(page);
  await page.locator("body").click();
  await page.keyboard.press("Meta+k");
  await expect(page.locator("#searchModal")).toHaveClass(/show/);
});

test("opening shows all clips as results", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await expect(page.locator(".search-modal-item")).toHaveCount(3);
});

test("typing filters the results", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await page.locator("#searchModalInput").fill("banana");
  await expect(page.locator(".search-modal-item")).toHaveCount(1);
  await expect(page.locator(".search-modal-item").first()).toContainText("banana split");
});

test("non-matching query shows No results", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await page.locator("#searchModalInput").fill("zzzznope");
  await expect(page.locator(".search-modal-item")).toHaveCount(0);
  await expect(page.locator("#searchModalResults")).toContainText("No results");
});

test("ArrowDown / ArrowUp move the active highlight", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  // first item active by default
  await expect(page.locator(".search-modal-item.active")).toHaveCount(1);
  await expect(page.locator(".search-modal-item").nth(0)).toHaveClass(/active/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".search-modal-item").nth(1)).toHaveClass(/active/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".search-modal-item").nth(2)).toHaveClass(/active/);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".search-modal-item").nth(1)).toHaveClass(/active/);
});

test("Enter selects the active item, closing search and opening the clip modal", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await page.keyboard.press("ArrowDown"); // move to banana split (index 1)
  await page.keyboard.press("Enter");
  await expect(page.locator("#searchModal")).not.toHaveClass(/show/);
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await expect(page.locator("#modalText")).toHaveValue("banana split");
});

test("clicking a result opens that clip in the modal", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await page.locator(".search-modal-item", { hasText: "cherry cake" }).click();
  await expect(page.locator("#searchModal")).not.toHaveClass(/show/);
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await expect(page.locator("#modalText")).toHaveValue("cherry cake");
});

test("Escape closes the search modal", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await expect(page.locator("#searchModal")).toHaveClass(/show/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#searchModal")).not.toHaveClass(/show/);
});

test("clicking the search backdrop closes the modal", async ({ page }) => {
  await seedThree(page);
  await page.locator('.qr-btn[title="Search (Cmd+K)"]').click();
  await page.locator("#searchModal").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#searchModal")).not.toHaveClass(/show/);
});
