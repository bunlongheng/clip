const { test, expect } = require("@playwright/test");
const { seed, reset, count } = require("../helpers/seed");

test.beforeEach(async () => { reset(); });

test("clicking a card opens the modal with source, time and text", async ({ page }) => {
  seed([{ text: "hello modal", source: "TestMachine" }]);
  await page.goto("/");
  await page.locator(".clip", { hasText: "hello modal" }).click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await expect(page.locator("#modalSource")).toContainText("TestMachine");
  // ago() renders a relative time like "0s" / "16m" / "2h" / "1d"
  await expect(page.locator("#modalTime")).toContainText(/\d+[smhd]\b/);
  await expect(page.locator("#modalText")).toHaveValue("hello modal");
});

test("modal Copy copies text, toasts Copied and closes the modal", async ({ page }) => {
  seed([{ text: "modal-copy-text" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await page.locator("#clipModal .modal-btn.copy").click();
  await expect(page.locator("#toastMsg")).toHaveText("Copied");
  await expect(page.locator("#clipModal")).not.toHaveClass(/show/);
  const v = await page.evaluate(() => navigator.clipboard.readText());
  expect(v).toBe("modal-copy-text");
});

test("modal Save edits text, toasts Saved and persists after reload", async ({ page }) => {
  seed([{ text: "before-edit" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  const ta = page.locator("#modalText");
  await ta.fill("after-edit-persisted");
  await page.locator('#clipModal .modal-btn[title="Save edits"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("Saved");
  // Card updates live via the "updated" broadcast.
  await expect(page.locator(".clip .text").first()).toContainText("after-edit-persisted");
  // And it persists across a reload.
  await page.reload();
  await expect(page.locator(".clip .text").first()).toContainText("after-edit-persisted");
});

test("modal Save issues a PUT to /api/clips/:id", async ({ page }) => {
  seed([{ text: "track-the-put" }]);
  await page.goto("/");
  let putSeen = false;
  await page.route("**/api/clips/*", (route) => {
    if (route.request().method() === "PUT") putSeen = true;
    route.continue();
  });
  await page.locator(".clip").first().click();
  await page.locator("#modalText").fill("changed-text-here");
  await page.locator('#clipModal .modal-btn[title="Save edits"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("Saved");
  expect(putSeen).toBe(true);
});

test("modal Save error shows Save failed toast", async ({ page }) => {
  seed([{ text: "save-will-fail" }]);
  await page.goto("/");
  await page.route("**/api/clips/*", (route) => {
    if (route.request().method() === "PUT") {
      // Force the fetch to reject so the client hits the catch -> "Save failed".
      return route.abort("failed");
    }
    return route.continue();
  });
  await page.locator(".clip").first().click();
  await page.locator("#modalText").fill("new-value-that-errors");
  await page.locator('#clipModal .modal-btn[title="Save edits"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("Save failed");
});

test("favorite heart toggles Favorited then Unfavorited", async ({ page }) => {
  seed([{ text: "heart-me" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  const heart = page.locator("#modalHeart");
  await heart.click();
  await expect(page.locator("#toastMsg")).toHaveText("Favorited");
  await expect(heart.locator("svg path")).toHaveAttribute("fill", "currentColor");
  await heart.click();
  await expect(page.locator("#toastMsg")).toHaveText("Unfavorited");
  await expect(heart.locator("svg path")).toHaveAttribute("fill", "none");
});

test("modal Delete closes modal and removes the clip", async ({ page }) => {
  seed([{ text: "modal-delete-target" }, { text: "survivor" }]);
  await page.goto("/");
  await page.locator(".clip", { hasText: "modal-delete-target" }).click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await page.locator('#clipModal .modal-btn[title="Delete"]').click();
  await expect(page.locator("#toastMsg")).toHaveText("Deleted");
  await expect(page.locator("#clipModal")).not.toHaveClass(/show/);
  await expect.poll(() => count(), { timeout: 4000 }).toBe(1);
});

test("Open-link button shows for URL clips and opens a new tab", async ({ page, context }) => {
  seed([{ text: "https://example.com" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  const openBtn = page.locator("#modalOpen");
  await expect(openBtn).toBeVisible();
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    openBtn.click(),
  ]);
  expect(popup.url()).toContain("example.com");
  await popup.close();
});

test("Open-link button is hidden for non-URL clips", async ({ page }) => {
  seed([{ text: "just plain text, not a url" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await expect(page.locator("#modalOpen")).toBeHidden();
});

test("clicking the backdrop closes the modal", async ({ page }) => {
  seed([{ text: "close-on-backdrop" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  // click the backdrop near the top edge, away from the inner panel
  await page.locator("#clipModal").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#clipModal")).not.toHaveClass(/show/);
});

test("clicking inside the modal keeps it open", async ({ page }) => {
  seed([{ text: "stay-open-inner-click" }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await page.locator(".clip-modal-inner").click({ position: { x: 10, y: 10 } });
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
});
