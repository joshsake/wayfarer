import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Flight strips, end to end — with /api/flights STUBBED. CI has no Amadeus
// key (and live fares change by the minute), so page.route() intercepts the
// browser's own fetch before it leaves Playwright and answers with canned
// JSON. The route must be registered BEFORE navigation: it patches the page's
// network layer, and a fetch that races ahead of it would hit the real
// handler. Everything else — form, plan, strip rendering — is the real app.
// ---------------------------------------------------------------------------

/** What /api/flights returns on success: already-normalized FlightOffers. */
const cannedOffers = {
  available: true,
  offers: [
    {
      price: "412.60",
      currency: "USD",
      stops: 0,
      duration: "PT1H55M",
      segments: [
        {
          from: "KIX",
          to: "ICN",
          departAt: "2026-11-23T11:00:00",
          arriveAt: "2026-11-23T12:55:00",
          carrier: "KE",
          flightNumber: "724",
        },
      ],
    },
    {
      price: "298.40",
      currency: "USD",
      stops: 1,
      duration: "PT7H25M",
      segments: [
        {
          from: "KIX",
          to: "PVG",
          departAt: "2026-11-23T09:20:00",
          arriveAt: "2026-11-23T11:05:00",
          carrier: "MU",
          flightNumber: "516",
        },
        {
          from: "PVG",
          to: "ICN",
          departAt: "2026-11-23T13:50:00",
          arriveAt: "2026-11-23T16:45:00",
          carrier: "MU",
          flightNumber: "5041",
        },
      ],
    },
  ],
};

/** The motivating Asia trip, plus a home airport. */
async function planAsiaTripFrom(page: import("@playwright/test").Page, home: string) {
  await page.goto("/trip");
  await page.getByTestId("trip-start").fill("2026-11-13");
  await page.getByTestId("trip-end").fill("2026-11-29");
  await page.getByTestId("trip-home").fill(home);
  await page.getByTestId("trip-country-Japan").check();
  await page.getByTestId("trip-country-South Korea").check();
  await page.getByTestId("trip-country-Singapore").check();
  await page.getByTestId("trip-min-Japan").fill("8");
  await page.getByTestId("trip-first").selectOption("Japan");
  await page.getByTestId("trip-submit").click();
}

test("shows flight offers for every transition of the trip", async ({ page }) => {
  await page.route("**/api/flights**", (route) =>
    route.fulfill({ json: cannedOffers }),
  );

  // Typed lowercase on purpose — the form uppercases as you type.
  await planAsiaTripFrom(page, "lax");

  // 3 legs with home known → 4 strips: LAX→first, two inter-leg, last→LAX.
  await expect(page.getByTestId("trip-leg")).toHaveCount(3);
  const strips = page.getByTestId("flight-strip");
  await expect(strips).toHaveCount(4);
  await expect(strips.first()).toContainText("Getting there");
  await expect(strips.last()).toContainText("Heading home");

  // Every strip resolves to offers, each with a visible price.
  for (let i = 0; i < 4; i++) {
    const offers = strips.nth(i).getByTestId("flight-offer");
    await expect(offers).toHaveCount(2);
    await expect(offers.first()).toContainText("412.60");
    await expect(offers.first()).toContainText("USD");
  }

  // Airport-local times, straight from the payload — no timezone drift.
  await expect(strips.first().getByTestId("flight-offer").first()).toContainText(
    "11:00–12:55",
  );
  await expect(strips.first()).toContainText("nonstop");
  await expect(strips.first()).toContainText("1 stop");
});

test("degrades quietly when flights are unavailable", async ({ page }) => {
  await page.route("**/api/flights**", (route) =>
    route.fulfill({ json: { available: false } }),
  );

  await planAsiaTripFrom(page, "LAX");

  // The plan itself is untouched by the flights failure...
  await expect(page.getByTestId("trip-leg")).toHaveCount(3);
  const legs = page.getByTestId("trip-leg");
  await expect(legs.first()).toContainText("Japan");
  await expect(legs.first()).toContainText("Nov 13");
  await expect(legs.last()).toContainText("Nov 29");

  // ...and every strip settles into the quiet unavailable line.
  const unavailable = page.getByTestId("flight-unavailable");
  await expect(unavailable).toHaveCount(4);
  await expect(unavailable.first()).toContainText("plan unaffected");
});
