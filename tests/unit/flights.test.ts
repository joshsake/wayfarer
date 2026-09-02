import { describe, expect, it } from "vitest";
import type { Destination, TripLeg, TripPlan } from "@/lib/types";
import { flightQueries, normalizeOffers } from "@/lib/flights";
import amadeusFixture from "./fixtures/amadeus-flight-offers.json";

// ---------------------------------------------------------------------------
// Fixtures. Same makeDest pattern as trip.test.ts, but flights only care
// about the airport code, so that's the field each destination pins down.
// ---------------------------------------------------------------------------

/** Minimal valid destination; override what the test cares about. */
function makeDest(
  overrides: Partial<Destination> &
    Pick<Destination, "id" | "name" | "country" | "iataCode">,
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
    lat: 0,
    lng: 0,
    highlights: [],
    ...overrides,
  };
}

/** A leg with real dates; flights read destination.iataCode and the dates. */
function makeLeg(
  destination: Destination,
  startDate: string,
  endDate: string,
): TripLeg {
  return {
    country: destination.country,
    destination,
    startDate,
    endDate,
    fullDays: 1,
    travelDays: 1,
    spareDays: 0,
    matchScore: 50,
    reasons: [],
  };
}

const KYOTO = makeDest({ id: "kyoto", name: "Kyoto", country: "Japan", iataCode: "KIX" });
const SEOUL = makeDest({ id: "seoul", name: "Seoul", country: "South Korea", iataCode: "ICN" });
const SINGAPORE = makeDest({ id: "singapore", name: "Singapore", country: "Singapore", iataCode: "SIN" });

/** The motivating trip's shape: Nov 13–29, Kyoto → Seoul → Singapore. */
const THREE_LEG_PLAN: TripPlan = {
  legs: [
    makeLeg(KYOTO, "2026-11-13", "2026-11-22"),
    makeLeg(SEOUL, "2026-11-23", "2026-11-26"),
    makeLeg(SINGAPORE, "2026-11-27", "2026-11-29"),
  ],
  totalDays: 17,
  spareDays: 1,
};

const SINGLE_LEG_PLAN: TripPlan = {
  legs: [makeLeg(KYOTO, "2026-11-13", "2026-11-20")],
  totalDays: 8,
  spareDays: 2,
};

describe("flightQueries", () => {
  it("derives all four flights for a 3-leg plan with a home airport", () => {
    expect(flightQueries(THREE_LEG_PLAN, "LAX")).toEqual([
      { origin: "LAX", dest: "KIX", date: "2026-11-13" }, // fly out on day 1
      { origin: "KIX", dest: "ICN", date: "2026-11-23" }, // leg 2's arrival day
      { origin: "ICN", dest: "SIN", date: "2026-11-27" }, // leg 3's arrival day
      { origin: "SIN", dest: "LAX", date: "2026-11-29" }, // fly home on the last day
    ]);
  });

  it("derives only inter-leg transitions without a home airport", () => {
    expect(flightQueries(THREE_LEG_PLAN)).toEqual([
      { origin: "KIX", dest: "ICN", date: "2026-11-23" },
      { origin: "ICN", dest: "SIN", date: "2026-11-27" },
    ]);
  });

  it("accepts a lowercase home airport and uppercases it", () => {
    const queries = flightQueries(THREE_LEG_PLAN, "lax");
    expect(queries).toHaveLength(4);
    expect(queries[0].origin).toBe("LAX");
    expect(queries[3].dest).toBe("LAX");
  });

  it("ignores a home airport with a digit in it", () => {
    expect(flightQueries(THREE_LEG_PLAN, "L1X")).toEqual(flightQueries(THREE_LEG_PLAN));
  });

  it("ignores a home airport of the wrong length", () => {
    expect(flightQueries(THREE_LEG_PLAN, "LAXX")).toEqual(flightQueries(THREE_LEG_PLAN));
  });

  it("gives a single-leg plan just the there-and-back pair with a home airport", () => {
    expect(flightQueries(SINGLE_LEG_PLAN, "LAX")).toEqual([
      { origin: "LAX", dest: "KIX", date: "2026-11-13" },
      { origin: "KIX", dest: "LAX", date: "2026-11-20" },
    ]);
  });

  it("gives a single-leg plan no flights without a home airport", () => {
    expect(flightQueries(SINGLE_LEG_PLAN)).toEqual([]);
  });
});

describe("normalizeOffers", () => {
  it("normalizes the sandbox fixture exactly", () => {
    expect(normalizeOffers(amadeusFixture)).toEqual([
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
    ]);
  });

  it("returns [] for garbage input", () => {
    expect(normalizeOffers(null)).toEqual([]);
    expect(normalizeOffers(undefined)).toEqual([]);
    expect(normalizeOffers("not json we expected")).toEqual([]);
    expect(normalizeOffers(42)).toEqual([]);
    expect(normalizeOffers({})).toEqual([]);
    expect(normalizeOffers({ data: "not an array" })).toEqual([]);
    expect(normalizeOffers({ data: [] })).toEqual([]);
  });

  it("skips malformed offers but keeps the valid ones", () => {
    const good = (amadeusFixture as { data: unknown[] }).data[0];
    const mangled = {
      data: [
        {}, //                                      no price, no itineraries
        { price: { grandTotal: "99.00" } }, //      no itineraries
        { itineraries: [{ segments: [] }] }, //     no price, no segments
        good, //                                    the real thing
      ],
    };
    const offers = normalizeOffers(mangled);
    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe("412.60");
  });
});
