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
    if (!result.ok) expect(result.error.code).toBe("does-not-fit");
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
    if (!result.ok) expect(result.error.code).toBe("unknown-country");
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
