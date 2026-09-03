import { describe, expect, it } from "vitest";
import type { Destination, Preferences, TripConstraints } from "@/lib/types";
import { countDays, distanceKm, splitTrip } from "@/lib/trip";

/** Minimal valid destination; override what the test cares about. */
function makeDest(
  overrides: Partial<Destination> &
    Pick<Destination, "id" | "name" | "country" | "lat" | "lng">,
): Destination {
  return {
    tagline: "",
    emoji: "📍",
    scores: {
      localCulture: 50,
      classicSights: 50,
      hotelQuality: 50,
      foodScene: 50,
      experiences: 50,
      transitQuality: 50,
      familyFriendly: 50,
      walkability: 50,
    },
    dailyCost: 150,
    iataCode: "XXX", // default so tests that don't care about flights stay terse
    highlights: [],
    ...overrides,
  };
}

const KYOTO = makeDest({ id: "kyoto", name: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 });
const SEOUL = makeDest({ id: "seoul", name: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 });
const SINGAPORE = makeDest({ id: "singapore", name: "Singapore", country: "Singapore", lat: 1.3521, lng: 103.8198 });
const CATALOG = [KYOTO, SEOUL, SINGAPORE];

const PREFS: Preferences = {
  party: "couple",
  vibe: "mix",
  splurges: ["food"],
  transit: "clean-transit",
  detail: "essentials",
};

/** The motivating trip: Nov 13–29, Japan first, ≥8 Japan / ≥2 each elsewhere. */
const ASIA_TRIP: TripConstraints = {
  startDate: "2026-11-13",
  endDate: "2026-11-29",
  countries: [
    { country: "Japan", minFullDays: 8 },
    { country: "South Korea", minFullDays: 2 },
    { country: "Singapore", minFullDays: 2 },
  ],
  firstCountry: "Japan",
};

describe("countDays", () => {
  it("counts an inclusive range", () => {
    // The motivating trip: Nov 13–29 is 17 calendar days.
    expect(countDays("2026-11-13", "2026-11-29")).toBe(17);
  });

  it("counts a single day as 1", () => {
    expect(countDays("2026-11-13", "2026-11-13")).toBe(1);
  });

  it("crosses a month boundary", () => {
    expect(countDays("2026-11-28", "2026-12-02")).toBe(5);
  });

  it("rejects end before start", () => {
    expect(countDays("2026-11-29", "2026-11-13")).toBeNull();
  });

  it("rejects malformed dates", () => {
    expect(countDays("13/11/2026", "2026-11-29")).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(countDays("2026-02-30", "2026-03-05")).toBeNull();
  });
});

describe("distanceKm", () => {
  const kyoto = { lat: 35.0116, lng: 135.7681 };
  const seoul = { lat: 37.5665, lng: 126.978 };
  const singapore = { lat: 1.3521, lng: 103.8198 };

  it("is zero for the same point", () => {
    expect(distanceKm(kyoto, kyoto)).toBe(0);
  });

  it("is symmetric", () => {
    expect(distanceKm(kyoto, seoul)).toBeCloseTo(distanceKm(seoul, kyoto), 6);
  });

  it("matches known city distances within tolerance", () => {
    // Great-circle references: Kyoto–Seoul ≈ 830 km, Kyoto–Singapore ≈ 4,950 km.
    expect(distanceKm(kyoto, seoul)).toBeGreaterThan(750);
    expect(distanceKm(kyoto, seoul)).toBeLessThan(900);
    expect(distanceKm(kyoto, singapore)).toBeGreaterThan(4700);
    expect(distanceKm(kyoto, singapore)).toBeLessThan(5200);
  });
});

describe("splitTrip validation", () => {
  it("rejects an invalid date range", () => {
    const result = splitTrip({ ...ASIA_TRIP, endDate: "2026-11-01" }, PREFS, CATALOG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad-dates");
  });

  it("rejects an empty country list", () => {
    const result = splitTrip({ ...ASIA_TRIP, countries: [] }, PREFS, CATALOG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad-input");
  });

  it("rejects a country with no catalog destinations", () => {
    const result = splitTrip(
      { ...ASIA_TRIP, countries: [...ASIA_TRIP.countries, { country: "Atlantis", minFullDays: 1 }] },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown-country");
      expect(result.error.message).toContain("Atlantis");
    }
  });

  it("rejects a duplicate country", () => {
    const result = splitTrip(
      { ...ASIA_TRIP, countries: [...ASIA_TRIP.countries, { country: "Japan", minFullDays: 1 }] },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad-input");
  });

  it("rejects a negative minimum", () => {
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: -1 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad-input");
  });

  it("rejects a fractional minimum, naming the country", () => {
    // Fractional days would walk the date cursor off UTC midnight.
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 8 },
          { country: "South Korea", minFullDays: 2.5 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("bad-input");
      expect(result.error.message).toContain("South Korea");
    }
  });

  it("rejects more than 8 countries before anything else runs", () => {
    // Nine made-up countries: the cap must fire before the catalog lookup,
    // so no fixtures are needed — and no permutation search ever starts.
    const nine = Array.from({ length: 9 }, (_, i) => ({
      country: `Country ${i}`,
      minFullDays: 1,
    }));
    const result = splitTrip(
      { startDate: "2026-11-01", endDate: "2026-12-31", countries: nine },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad-input");
  });

  it("handles a pinned 8-country trip quickly", () => {
    // 8 legs pinned → permute only the 7 free legs (5,040 orders), not 8!
    // (40,320) filtered down. 8 minimums + 9 travel days = 17 = the range.
    const bigCatalog = Array.from({ length: 8 }, (_, i) =>
      makeDest({
        id: `city-${i}`,
        name: `City ${i}`,
        country: `Country ${i}`,
        lat: 10 + i * 5,
        lng: 100 + i * 3,
      }),
    );
    const constraints: TripConstraints = {
      startDate: "2026-11-13",
      endDate: "2026-11-29",
      countries: bigCatalog.map((d) => ({ country: d.country, minFullDays: 1 })),
      firstCountry: "Country 4",
    };
    const started = performance.now();
    const result = splitTrip(constraints, PREFS, bigCatalog);
    const elapsedMs = performance.now() - started;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.legs).toHaveLength(8);
      expect(result.plan.legs[0].country).toBe("Country 4");
    }
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("rejects a firstCountry that isn't in the trip", () => {
    const result = splitTrip({ ...ASIA_TRIP, firstCountry: "Singapore City" }, PREFS, CATALOG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown-country");
  });

  it("rejects minimums that don't fit, and shows the arithmetic", () => {
    // 17 days − 4 travel days = 13 full days; ask for 14.
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 10 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("does-not-fit");
      expect(result.error.message).toContain("17");
      expect(result.error.message).toContain("14");
    }
  });

  it("accepts minimums that exactly fit", () => {
    // 13 full days available; ask for exactly 13.
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 9 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(true);
  });
});

describe("splitTrip ordering", () => {
  it("pins the first country and routes the rest by distance", () => {
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Japan → Korea → Singapore heads steadily south (~5,500 km);
      // Japan → Singapore → Korea backtracks (~9,600 km).
      expect(result.plan.legs.map((l) => l.country)).toEqual([
        "Japan",
        "South Korea",
        "Singapore",
      ]);
    }
  });

  it("respects a different pin even when it costs distance", () => {
    const result = splitTrip({ ...ASIA_TRIP, firstCountry: "Singapore" }, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.legs[0].country).toBe("Singapore");
  });

  it("picks the best-matching destination as each country's representative", () => {
    const osaka = makeDest({
      id: "osaka", name: "Osaka", country: "Japan", lat: 34.6937, lng: 135.5023,
      scores: { ...KYOTO.scores, foodScene: 99, transitQuality: 99 },
    });
    // PREFS splurges on food + clean transit, so Osaka outranks default-Kyoto.
    const result = splitTrip(ASIA_TRIP, PREFS, [...CATALOG, osaka]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const japan = result.plan.legs.find((l) => l.country === "Japan");
      expect(japan?.destination.id).toBe("osaka");
    }
  });
});

describe("splitTrip allocation", () => {
  it("gives spare days to the best-matching country (largest remainder)", () => {
    // Make Singapore's rep clearly the strongest match for PREFS.
    const shinySingapore = makeDest({
      ...SINGAPORE,
      scores: { ...SINGAPORE.scores, foodScene: 99, hotelQuality: 99, transitQuality: 99 },
    });
    const result = splitTrip(ASIA_TRIP, PREFS, [KYOTO, SEOUL, shinySingapore]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 17 − 12 minimums − 4 travel = 1 spare day → Singapore.
      const sg = result.plan.legs.find((l) => l.country === "Singapore")!;
      expect(sg.spareDays).toBe(1);
      expect(sg.fullDays).toBe(3);
    }
  });

  it("breaks exact ties toward earlier legs", () => {
    // Identical scores → identical quotas → the tie goes to leg order.
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.legs[0].spareDays).toBe(1);
      expect(result.plan.legs[0].fullDays).toBe(9);
    }
  });

  it("covers every calendar day exactly once, no gaps or overlaps", () => {
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const legs = result.plan.legs;
      expect(legs[0].startDate).toBe("2026-11-13");
      expect(legs[legs.length - 1].endDate).toBe("2026-11-29");
      const allocated = legs.reduce((sum, l) => sum + l.fullDays + l.travelDays, 0);
      expect(allocated).toBe(17);
      for (let i = 0; i + 1 < legs.length; i++) {
        const next = new Date(legs[i].endDate + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        expect(legs[i + 1].startDate).toBe(next.toISOString().slice(0, 10));
      }
    }
  });

  it("honors every minimum in the motivating trip", () => {
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byCountry = Object.fromEntries(result.plan.legs.map((l) => [l.country, l]));
      expect(byCountry["Japan"].fullDays).toBeGreaterThanOrEqual(8);
      expect(byCountry["Singapore"].fullDays).toBeGreaterThanOrEqual(2);
      expect(byCountry["South Korea"].fullDays).toBeGreaterThanOrEqual(2);
    }
  });

  it("is deterministic", () => {
    const a = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    const b = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(a).toEqual(b);
  });

  it("plans a single-country trip as one leg spanning the whole range", () => {
    // Nov 13–20 is 8 days; 1 arrival + flight home = 2 travel days.
    // Minimum 4 + spare 2 (all to the only leg) = 6 full days.
    const result = splitTrip(
      {
        startDate: "2026-11-13",
        endDate: "2026-11-20",
        countries: [{ country: "Japan", minFullDays: 4 }],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.legs).toHaveLength(1);
      const leg = result.plan.legs[0];
      expect(leg.startDate).toBe("2026-11-13");
      expect(leg.endDate).toBe("2026-11-20");
      expect(leg.travelDays).toBe(2);
      expect(leg.fullDays).toBe(6);
    }
  });

  it("splits multiple spare days by exact largest-remainder arithmetic", () => {
    // Uniform scores make a destination's match % equal that score, so reps
    // land at exactly 90 / 60 / 30 (see rank(): every PREFS criterion reads
    // fields that all hold the same value).
    //
    // Hand-computed expectation — 17 days, minimums 4+2+2, 4 travel → spare 5.
    // Leg order (pinned Japan, then by distance): Japan, South Korea, Singapore.
    // Quotas: 5·90/180 = 2.5, 5·60/180 = 1.667, 5·30/180 = 0.833.
    // Floors [2, 1, 0] spend 3; fractions .5 < .667 < .833, so the 2 leftover
    // days go to Singapore (.833) and South Korea (.667): spare = [2, 2, 1].
    const uniform = (v: number) => ({
      localCulture: v, classicSights: v, hotelQuality: v, foodScene: v,
      experiences: v, transitQuality: v, familyFriendly: v, walkability: v,
    });
    const catalog = [
      makeDest({ ...KYOTO, scores: uniform(90) }),
      makeDest({ ...SEOUL, scores: uniform(60) }),
      makeDest({ ...SINGAPORE, scores: uniform(30) }),
    ];
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 4 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      catalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.spareDays).toBe(5);
      expect(result.plan.legs.map((l) => l.spareDays)).toEqual([2, 2, 1]);
      expect(result.plan.legs.map((l) => l.fullDays)).toEqual([6, 4, 3]);
    }
  });

  it("splits spare evenly when every rep scores zero", () => {
    // All-zero scores bottom out every PREFS criterion, so rank() yields 0
    // for each rep and totalScore is 0 — the even-split branch. Spare 5 over
    // 3 legs: quotas all 5/3, floors [1,1,1], and the 2 leftover days break
    // the all-equal-fraction tie toward earlier legs: spare = [2, 2, 1].
    const zero = {
      localCulture: 0, classicSights: 0, hotelQuality: 0, foodScene: 0,
      experiences: 0, transitQuality: 0, familyFriendly: 0, walkability: 0,
    };
    const catalog = [
      makeDest({ ...KYOTO, scores: zero }),
      makeDest({ ...SEOUL, scores: zero }),
      makeDest({ ...SINGAPORE, scores: zero }),
    ];
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 4 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      catalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.legs.map((l) => l.matchScore)).toEqual([0, 0, 0]);
      expect(result.plan.legs.map((l) => l.spareDays)).toEqual([2, 2, 1]);
    }
  });
});
