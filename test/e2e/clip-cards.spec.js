const { test, expect } = require("@playwright/test");
const { seed, reset, count } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

test("renders one card per clip, newest first", async ({ page }) => {
  // Later specs get more-recent timestamps, so they sort first.
  seed([{ text: "oldest" }, { text: "middle" }, { text: "newest" }]);
  await page.goto("/");
  await expect(page.locator(".clip")).toHaveCount(3);
  const texts = await page.locator(".clip .text").allTextContents();
  expect(texts[0]).toContain("newest");
  expect(texts[2]).toContain("oldest");
});

test("card text is HTML-escaped, not rendered as markup", async ({ page }) => {
  seed([{ text: "<b>bold</b> & <i>x</i>" }]);
  await page.goto("/");
  const cardText = page.locator(".clip .text").first();
  // The literal angle-bracket markup must be shown as text, no <b>/<i> elements.
  await expect(cardText).toContainText("<b>bold</b>");
  await expect(cardText).toContainText("&");
  await expect(cardText.locator("b")).toHaveCount(0);
  await expect(cardText.locator("i")).toHaveCount(0);
});

test("local clip gets m-local class, peer clip gets m-peer", async ({ page }) => {
  seed([
    { text: "from peer machine", source: "OtherMachine" },
    { text: "from this machine", source: "TestMachine" },
  ]);
  await page.goto("/");
  // newest (last seeded) = local TestMachine, first card
  const cards = page.locator(".clip");
  await expect(cards.nth(0)).toHaveClass(/m-local/);
  await expect(cards.nth(1)).toHaveClass(/m-peer/);
});

test("card shows char count and a relative time", async ({ page }) => {
  seed([{ text: "abcdef" }]); // 6 chars
  await page.goto("/");
  const card = page.locator(".clip").first();
  await expect(card).toContainText("6 chars");
  // ago() renders a relative time like "0s" / "16m" / "2h" / "1d"
  await expect(card).toContainText(/\d+[smhd]\b/);
});

test("char count is abbreviated with k for long clips", async ({ page }) => {
  seed([{ text: "x".repeat(1500) }]);
  await page.goto("/");
  await expect(page.locator(".clip").first()).toContainText("1.5k chars");
});

test("quick-copy button copies clip text and toasts Copied", async ({ page }) => {
  seed([{ text: "copy-me-please" }]);
  await page.goto("/");
  await page.locator('.clip .act-btn[title="Copy"]').first().click();
  await expect(page.locator("#toastMsg")).toHaveText("Copied");
  await expect(page.locator("#toast")).toHaveClass(/show/);
  const v = await page.evaluate(() => navigator.clipboard.readText());
  expect(v).toBe("copy-me-please");
});

test("quick-copy does not open the modal", async ({ page }) => {
  seed([{ text: "stay-closed" }]);
  await page.goto("/");
  await page.locator('.clip .act-btn[title="Copy"]').first().click();
  await expect(page.locator("#clipModal")).not.toHaveClass(/show/);
});

test("card delete button removes the clip and toasts Deleted", async ({ page }) => {
  seed([{ text: "delete-me" }, { text: "keep-me" }]);
  await page.goto("/");
  await expect(page.locator(".clip")).toHaveCount(2);
  // first card is keep-me (newest); target delete-me explicitly
  const target = page.locator(".clip", { hasText: "delete-me" });
  await target.locator('.act-btn.del[title="Delete"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("Deleted");
  // WebSocket delete broadcast red-blinks (1s) then fades (.5s) then display:none.
  await expect(target).toBeHidden({ timeout: 4000 });
  // delete persisted in the DB
  await expect.poll(() => count(), { timeout: 4000 }).toBe(1);
});

test("card delete does not open the modal", async ({ page }) => {
  seed([{ text: "no-modal-on-delete" }]);
  await page.goto("/");
  await page.locator('.clip .act-btn.del[title="Delete"]').first().click();
  await expect(page.locator("#clipModal")).not.toHaveClass(/show/);
});
