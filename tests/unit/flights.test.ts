import { describe, expect, it } from "vitest";
import type { Destination, TripLeg, TripPlan } from "@/lib/types";
import { flightQueries, normalizeOffers, offerKey } from "@/lib/flights";
import duffelFixture from "./fixtures/duffel-offer-request.json";

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

  // LEARNING NOTE: If home IS the first leg's airport (you live in Kyoto and
  // the trip starts there), a naive derivation asks the provider for
  // KIX→KIX. No airline sells that, so at best it comes back empty and at
  // worst it's a 4xx — either way a request spent for nothing. Degenerate
  // queries must never leave this function.
  it("skips the outbound flight when home equals the first leg's airport", () => {
    expect(flightQueries(THREE_LEG_PLAN, "KIX")).toEqual([
      { origin: "KIX", dest: "ICN", date: "2026-11-23" },
      { origin: "ICN", dest: "SIN", date: "2026-11-27" },
      { origin: "SIN", dest: "KIX", date: "2026-11-29" },
    ]);
  });

  it("skips the return flight when home equals the last leg's airport", () => {
    expect(flightQueries(THREE_LEG_PLAN, "SIN")).toEqual([
      { origin: "SIN", dest: "KIX", date: "2026-11-13" },
      { origin: "KIX", dest: "ICN", date: "2026-11-23" },
      { origin: "ICN", dest: "SIN", date: "2026-11-27" },
    ]);
  });

  it("returns no flights at all for an empty plan", () => {
    expect(flightQueries({ legs: [], totalDays: 0, spareDays: 0 }, "LAX")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeOffers — the Duffel → FlightOffer boundary.
//
// The fixture is a test-mode-shaped offer request holding FIVE offers,
// deliberately out of price order: KE 724 nonstop ("Economy Standard") at
// 412.60, MU via PVG at 298.40, OZ 111 nonstop at 550.00, CI via TPE at
// 275.10, and KE 724 AGAIN as "Economy Basic" at 389.00 — the same physical
// flight, cheaper fare brand. That last one is how Duffel really looks: one
// offer per fare brand, so identical itineraries at different prices are
// normal, not a glitch. "Cheapest three, ascending" therefore has exactly
// one right answer (275.10, 298.40, 389.00), and the 412.60 and 550.00
// offers are the canaries: if either shows up, the cap or the sort is broken.
// ---------------------------------------------------------------------------

type DuffelOffer = Record<string, unknown>;
const fixtureOffers = (duffelFixture as { data: { offers: DuffelOffer[] } }).data.offers;
const [KE_NONSTOP, MU_VIA_PVG, OZ_NONSTOP, CI_VIA_TPE, KE_NONSTOP_BASIC] = fixtureOffers;

/** Wrap raw offers in the envelope Duffel uses: `{ data: { offers } }`. */
function offerRequest(offers: unknown[]): unknown {
  return { data: { offers } };
}

/** The KE nonstop with a different price — for sort-only tests. */
function nonstopAt(price: string, carrier = "KE"): DuffelOffer {
  const offer = structuredClone(KE_NONSTOP);
  offer.total_amount = price;
  const slice = (offer.slices as { segments: Record<string, unknown>[] }[])[0];
  slice.segments[0].marketing_carrier = { iata_code: carrier, name: carrier };
  return offer;
}

describe("normalizeOffers", () => {
  it("keeps the three cheapest offers of the fixture, cheapest first, exactly", () => {
    expect(normalizeOffers(duffelFixture)).toEqual([
      {
        price: "275.10",
        currency: "USD",
        stops: 1,
        duration: "PT8H25M",
        segments: [
          {
            from: "KIX",
            to: "TPE",
            departAt: "2026-11-23T10:15:00",
            arriveAt: "2026-11-23T12:20:00",
            carrier: "CI",
            flightNumber: "157",
          },
          {
            from: "TPE",
            to: "ICN",
            departAt: "2026-11-23T14:10:00",
            arriveAt: "2026-11-23T17:40:00",
            carrier: "CI",
            flightNumber: "160",
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
      {
        // KE 724's cheaper "Economy Basic" fare brand — the Standard one at
        // 412.60 is the same flight and falls outside the top three.
        price: "389.00",
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
    ]);
  });

  it("excludes the two priciest offers", () => {
    const prices = normalizeOffers(duffelFixture).map((o) => o.price);
    expect(prices).not.toContain("412.60");
    expect(prices).not.toContain("550.00");
    expect(prices).toHaveLength(3);
  });

  // LEARNING NOTE: Duffel emits one offer per fare brand, so the SAME
  // physical flight legitimately appears twice at different prices. The
  // normalizer must keep both (they're different purchases), which is
  // exactly why the UI can't key its list on the itinerary alone.
  it("keeps two fare brands of the same physical flight as separate offers", () => {
    const offers = normalizeOffers(offerRequest([KE_NONSTOP, KE_NONSTOP_BASIC]));
    expect(offers).toHaveLength(2);
    expect(offers[0].segments).toEqual(offers[1].segments);
    expect(offers.map((o) => o.price)).toEqual(["389.00", "412.60"]);
  });

  // LEARNING NOTE: Prices arrive as STRINGS ("412.60"), and JavaScript sorts
  // strings character by character — so "1000.00" < "95.00" because "1" <
  // "9". The normalizer must compare Number(price), and this case would
  // catch a lazy `.sort()` with no comparator.
  it("sorts numerically, not lexicographically", () => {
    const offers = normalizeOffers(
      offerRequest([nonstopAt("1000.00"), nonstopAt("95.00"), nonstopAt("412.60")]),
    );
    expect(offers.map((o) => o.price)).toEqual(["95.00", "412.60", "1000.00"]);
  });

  it("keeps input order between equal prices (stable sort)", () => {
    const offers = normalizeOffers(
      offerRequest([nonstopAt("300.00", "ZZ"), nonstopAt("300.00", "AA"), nonstopAt("300.00", "MM")]),
    );
    expect(offers.map((o) => o.segments[0].carrier)).toEqual(["ZZ", "AA", "MM"]);
  });

  it("returns [] for garbage input", () => {
    expect(normalizeOffers(null)).toEqual([]);
    expect(normalizeOffers(undefined)).toEqual([]);
    expect(normalizeOffers("not json we expected")).toEqual([]);
    expect(normalizeOffers(42)).toEqual([]);
    expect(normalizeOffers({})).toEqual([]);
    expect(normalizeOffers({ data: "not an object" })).toEqual([]);
    expect(normalizeOffers({ data: {} })).toEqual([]);
    expect(normalizeOffers({ data: { offers: "not an array" } })).toEqual([]);
    expect(normalizeOffers({ data: { offers: [] } })).toEqual([]);
    // The OLD provider's envelope (`data` was the offers array itself) is
    // now just another wrong shape — it must degrade, not crash.
    expect(normalizeOffers({ data: [] })).toEqual([]);
  });

  // LEARNING NOTE: Number() is far too forgiving for a price: Number("  ")
  // is 0, Number("1e3") is 1000, Number("-5.00") is -5 — all "finite", none
  // a fare. The guard is a strict shape check instead: digits, optionally a
  // dot and more digits, nothing else (after trimming stray whitespace).
  it("drops prices that aren't plain decimal strings", () => {
    for (const bad of ["  ", "", "12,50", "1e3", "-5.00", "412.", "$412", "412.60 USD"]) {
      expect(normalizeOffers(offerRequest([nonstopAt(bad)])), JSON.stringify(bad)).toEqual([]);
    }
    for (const good of ["412.60", "412", " 412.60 "]) {
      const [offer] = normalizeOffers(offerRequest([nonstopAt(good)]));
      expect(offer?.price, JSON.stringify(good)).toBe(good.trim());
    }
  });

  it("skips malformed offers but keeps the valid ones", () => {
    const mangled = offerRequest([
      {}, //                                        no price, no slices
      { total_amount: "99.00", total_currency: "USD" }, //  no slices
      { slices: [{ duration: "PT1H", segments: [] }] }, //  no price, no segments
      { ...KE_NONSTOP, total_amount: "not a number" }, //   unsortable price
      KE_NONSTOP, //                                the real thing
    ]);
    const offers = normalizeOffers(mangled);
    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe("412.60");
  });

  it("drops the whole offer when a mid-journey segment is broken", () => {
    // A 1-stop offer whose SECOND segment is missing its origin: half a
    // journey is nonsense, so the entire offer must go — not just the leg.
    const oneStop = structuredClone(MU_VIA_PVG) as {
      slices: { segments: Record<string, unknown>[] }[];
    };
    delete oneStop.slices[0].segments[1].origin;

    const offers = normalizeOffers(offerRequest([KE_NONSTOP, oneStop]));
    expect(offers).toHaveLength(1);
    expect(offers[0].stops).toBe(0); // only the untouched nonstop survives
  });

  it("ignores every offer field the UI doesn't need", () => {
    // Sanity check on the fixture itself: the extra Duffel fields (ids,
    // conditions, owner, expires_at...) are present, and none leak through.
    expect(OZ_NONSTOP).toHaveProperty("conditions");
    expect(CI_VIA_TPE).toHaveProperty("expires_at");
    const [cheapest] = normalizeOffers(duffelFixture);
    expect(Object.keys(cheapest).sort()).toEqual(
      ["currency", "duration", "price", "segments", "stops"],
    );
  });
});

// ---------------------------------------------------------------------------
// offerKey — what FlightStrip hands to React as each <li>'s `key`.
//
// LEARNING NOTE: React uses `key` to match list items across renders; two
// siblings with the same key make it reuse one DOM node for both, and one
// offer silently vanishes. Keying on the first segment alone collides the
// moment Duffel returns two fare brands of the same flight (see above), so
// the key is the whole itinerary PLUS the price — the pair that actually
// makes an offer distinct.
// ---------------------------------------------------------------------------

describe("offerKey", () => {
  it("is every segment's carrier, number and departure joined by |, then the price", () => {
    const [cheapest, , keBasic] = normalizeOffers(duffelFixture);
    expect(offerKey(cheapest)).toBe(
      "CI1572026-11-23T10:15:00|CI1602026-11-23T14:10:00-275.10",
    );
    expect(offerKey(keBasic)).toBe("KE7242026-11-23T11:00:00-389.00");
  });

  it("tells two fare brands of the same physical flight apart", () => {
    const [basic, standard] = normalizeOffers(offerRequest([KE_NONSTOP, KE_NONSTOP_BASIC]));
    expect(basic.segments).toEqual(standard.segments); // same flight...
    expect(offerKey(basic)).not.toBe(offerKey(standard)); // ...distinct keys
  });

  it("is stable for the same offer", () => {
    const [offer] = normalizeOffers(duffelFixture);
    expect(offerKey(offer)).toBe(offerKey(structuredClone(offer)));
  });
});
