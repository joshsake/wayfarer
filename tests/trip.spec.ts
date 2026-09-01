import { expect, test } from "@playwright/test";

// The full trip-splitter journey against the real catalog: the motivating
// Asia trip — Nov 13–29, Japan pinned first, ≥8/2/2 full days.
test("splits the Asia trip across three countries", async ({ page }) => {
  await page.goto("/trip");

  await page.getByTestId("trip-start").fill("2026-11-13");
  await page.getByTestId("trip-end").fill("2026-11-29");
  await page.getByTestId("trip-country-Japan").check();
  await page.getByTestId("trip-country-South Korea").check();
  await page.getByTestId("trip-country-Singapore").check();
  await page.getByTestId("trip-min-Japan").fill("8");
  await page.getByTestId("trip-first").selectOption("Japan");
  await page.getByTestId("trip-submit").click();

  await expect(page.getByTestId("trip-leg")).toHaveCount(3);
  const legs = page.getByTestId("trip-leg");
  await expect(legs.first()).toContainText("Japan");
  await expect(legs.first()).toContainText("Nov 13");
  await expect(legs.last()).toContainText("Nov 29");
});

test("explains a trip that doesn't fit instead of erroring", async ({ page }) => {
  await page.goto("/trip");

  await page.getByTestId("trip-start").fill("2026-11-13");
  await page.getByTestId("trip-end").fill("2026-11-16");
  await page.getByTestId("trip-country-Japan").check();
  await page.getByTestId("trip-min-Japan").fill("10");
  await page.getByTestId("trip-submit").click();

  await expect(page.getByTestId("trip-error")).toBeVisible();
  await expect(page.getByTestId("trip-error")).toContainText("travel days");
});
