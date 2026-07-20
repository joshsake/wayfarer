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
  highlights: string[]; // shown only when the user asks for "everything"
}

/** A destination plus the reasons it matched this traveler. */
export interface Recommendation {
  destination: Destination;
  score: number; // 0–100 match percentage
  reasons: string[]; // human-friendly "why this fits you"
}
