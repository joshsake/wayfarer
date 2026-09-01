// ---------------------------------------------------------------------------
// Core types for Wayfarer.
//
// LEARNING NOTE: In a TypeScript React app, defining your domain types first
// pays off everywhere — components, scoring logic, and tests all share these,
// and the compiler catches mismatches for you (think of it as static QA).
// ---------------------------------------------------------------------------

/** Who is going on the trip. */
export type TravelParty = "solo" | "couple" | "family";

/** How much the traveler wants classic sights vs. living like a local. */
export type Vibe = "local" | "mix" | "classic";

/** What the traveler is happy to splurge on (multi-select). */
export type Splurge = "hotel" | "food" | "experiences";

/** Comfort level with public transportation. */
export type Transit = "clean-transit" | "rideshare" | "car";

/** How much planning detail they want to see. */
export type Detail = "essentials" | "everything";

/** The complete set of wizard answers. */
export interface Preferences {
  party: TravelParty;
  vibe: Vibe;
  splurges: Splurge[]; // can be empty — that's a budget-conscious traveler
  transit: Transit;
  detail: Detail;
}

/**
 * A destination in our (mock, for now) catalog.
 * Every 0–100 score answers one question a traveler cares about.
 * Later these rows will come from a real database (Supabase) instead.
 */
export interface Destination {
  id: string;
  name: string;
  country: string;
  tagline: string;
  emoji: string;
  scores: {
    localCulture: number; //  authentic neighborhoods, markets, non-touristy food
    classicSights: number; // iconic landmarks and must-see attractions
    hotelQuality: number; //  availability of genuinely nice hotels
    foodScene: number; //     restaurant quality and variety
    experiences: number; //   tours, nature, activities beyond sightseeing
    transitQuality: number; // clean, organized public transportation
    familyFriendly: number;
    walkability: number;
  };
  /** Rough daily cost in USD for a comfortable (not luxury) trip. */
  dailyCost: number;
  /** City coordinates, used to order multi-country trips by flight distance. */
  lat: number;
  lng: number;
  highlights: string[]; // shown only when the user asks for "everything"
}

/** A destination plus the reasons it matched this traveler. */
export interface Recommendation {
  destination: Destination;
  score: number; // 0–100 match percentage
  reasons: string[]; // human-friendly "why this fits you"
}

// --- Trip splitter ---------------------------------------------------------
// Day-counting semantics (see docs/plans/2026-09-01-trip-splitter-design.md):
// every leg's first day is a travel day (arrival) and doesn't count as
// "full"; the trip's final day is the flight home. So a leg's full days =
// allocated days − 1, and the final leg's = allocated days − 2.

/** One country in the trip request, with its minimum full days. */
export interface CountryConstraint {
  country: string;
  minFullDays: number;
}

/** The trip request: an inclusive date range plus country constraints. */
export interface TripConstraints {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; //   "YYYY-MM-DD", inclusive
  countries: CountryConstraint[];
  /** Optional: this country must be the first leg. */
  firstCountry?: string;
}

/** One leg of a computed plan, with concrete dates. */
export interface TripLeg {
  country: string;
  /** The country's best-matching destination for these preferences. */
  destination: Destination;
  startDate: string;
  endDate: string; // inclusive
  fullDays: number;
  travelDays: number; // 1, or 2 on the final leg (arrival + flight home)
  spareDays: number; // how many beyond-minimum days this leg received
  matchScore: number;
  reasons: string[];
}

export interface TripPlan {
  legs: TripLeg[];
  totalDays: number;
  spareDays: number;
}

export interface TripError {
  code: "bad-dates" | "bad-input" | "unknown-country" | "does-not-fit";
  message: string; // ready to render — explains the arithmetic, not just "invalid"
}

/** Result union: infeasible trips are data, not exceptions — the UI explains them. */
export type TripResult =
  | { ok: true; plan: TripPlan }
  | { ok: false; error: TripError };
