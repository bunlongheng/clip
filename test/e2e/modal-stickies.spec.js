const { test, expect } = require("@playwright/test");
const { seed, reset } = require("../helpers/seed");

const LONG = "L".repeat(200); // > 150 chars triggers the Stickies button
const SHORT = "short text";

test.beforeEach(async () => { reset(); });

test("Send-to-Stickies button is hidden for short clips", async ({ page }) => {
  seed([{ text: SHORT }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  await expect(page.locator("#clipModal")).toHaveClass(/show/);
  await expect(page.locator("#modalStickies")).toBeHidden();
});

test("Send-to-Stickies button is shown for long clips", async ({ page }) => {
  seed([{ text: LONG }]);
  await page.goto("/");
  await page.locator(".clip").first().click();
  await expect(page.locator("#modalStickies")).toBeVisible();
});

test("Send-to-Stickies success toasts Sent to Stickies", async ({ page }) => {
  seed([{ text: LONG }]);
  await page.goto("/");
  await page.route("**/api/stickies", (r) => r.fulfill({ json: { ok: true } }));
  await page.locator(".clip").first().click();
  await page.locator("#modalStickies").click();
  await expect(page.locator("#toastMsg")).toHaveText("Sent to Stickies", { timeout: 4000 });
});

test("Send-to-Stickies error toasts Stickies failed", async ({ page }) => {
  seed([{ text: LONG }]);
  await page.goto("/");
  await page.route("**/api/stickies", (r) => r.fulfill({ json: { ok: false } }));
  await page.locator(".clip").first().click();
  await page.locator("#modalStickies").click();
  await expect(page.locator("#toastMsg")).toHaveText("Stickies failed", { timeout: 4000 });
});

test("Send-to-Stickies shows a loading spinner before the success toast", async ({ page }) => {
  seed([{ text: LONG }]);
  await page.goto("/");
  // Delay the response so the spinner is observable.
  await page.route("**/api/stickies", (r) => {
    setTimeout(() => r.fulfill({ json: { ok: true } }), 400);
  });
  await page.locator(".clip").first().click();
  await page.locator("#modalStickies").click();
  // Spinner svg.spin appears inside the button while in flight.
  await expect(page.locator("#modalStickies svg.spin")).toBeVisible();
  // Intermediate "Sending to Stickies..." toast is shown immediately.
  await expect(page.locator("#toastMsg")).toHaveText("Sending to Stickies...");
  // Then resolves to success.
  await expect(page.locator("#toastMsg")).toHaveText("Sent to Stickies", { timeout: 4000 });
});
