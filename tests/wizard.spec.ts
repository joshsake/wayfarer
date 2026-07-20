import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E tests for the Wayfarer wizard.
//
// LEARNING NOTE: Notice every selector is a data-testid we planted in the
// components as we built them. Designing for testability from the first
// commit — rather than bolting selectors on later — is the QA habit most
// developers wish they had. You already have it.
// ---------------------------------------------------------------------------

test.describe("preference wizard", () => {
  test("landing page leads into the wizard", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /trips that fit/i }),
    ).toBeVisible();
    await page.getByTestId("start-wizard").click();
    await expect(page).toHaveURL(/\/plan/);
    await expect(page.getByTestId("wizard-progress")).toHaveText("1 of 5");
  });

  test("full flow: local-culture couple reaches personalized results", async ({
    page,
  }) => {
    await page.goto("/plan");

    // Step 1: who's going — single-select auto-advances.
    await page.getByTestId("option-couple").click();
    await expect(page.getByTestId("wizard-progress")).toHaveText("2 of 5");

    // Step 2: vibe.
    await page.getByTestId("option-local").click();

    // Step 3: splurges — multi-select needs explicit continue.
    await page.getByTestId("option-food").click();
    await page.getByTestId("option-hotel").click();
    await page.getByTestId("wizard-continue").click();

    // Step 4: transit.
    await page.getByTestId("option-clean-transit").click();

    // Step 5: detail level — last step navigates to results.
    await page.getByTestId("option-essentials").click();

    // Results: URL carries the answers (shareable!), three cards render.
    await expect(page).toHaveURL(/\/results\?/);
    await expect(page).toHaveURL(/party=couple/);
    await expect(page).toHaveURL(/splurges=food%2Chotel|splurges=food,hotel/);
    const cards = page.getByTestId("recommendation-card");
    await expect(cards).toHaveCount(3);

    // Every card shows a match percentage.
    await expect(cards.first()).toContainText(/% match/);
  });

  test("back button returns to the previous question", async ({ page }) => {
    await page.goto("/plan");
    await page.getByTestId("option-solo").click();
    await expect(page.getByTestId("wizard-progress")).toHaveText("2 of 5");
    await page.getByTestId("wizard-back").click();
    await expect(page.getByTestId("wizard-progress")).toHaveText("1 of 5");
    // The earlier answer is remembered and shown as selected.
    await expect(page.getByTestId("option-solo")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("skipping all splurges is a valid, budget-conscious path", async ({
    page,
  }) => {
    await page.goto("/plan");
    await page.getByTestId("option-solo").click();
    await page.getByTestId("option-local").click();
    // Splurge step: select nothing — button copy acknowledges the choice.
    await expect(page.getByTestId("wizard-continue")).toContainText(
      /keep it lean/i,
    );
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("option-car").click();
    await page.getByTestId("option-everything").click();

    await expect(page).toHaveURL(/\/results/);
    // "Show me everything" means details are expanded without a click.
    const cards = page.getByTestId("recommendation-card");
    await expect(cards).toHaveCount(3);
    await expect(
      cards.first().locator("details[open]"),
    ).toBeVisible();
  });

  test("results are personalized: transit lovers see transit-strong cities", async ({
    page,
  }) => {
    // Directly hitting the results URL — state-in-URL makes this testable
    // without driving the whole wizard every time.
    await page.goto(
      "/results?party=solo&vibe=local&splurges=&transit=clean-transit&detail=essentials",
    );
    const cards = page.getByTestId("recommendation-card");
    await expect(cards).toHaveCount(3);
    // Hội An has beautiful culture but ~no transit; with clean-transit
    // weighted heavily it should not make the podium.
    await expect(page.locator("main")).not.toContainText("Hội An");
  });
});
