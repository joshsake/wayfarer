import type { Destination, Preferences, Recommendation } from "./types";
import { getDestinations } from "./destinations";

// ---------------------------------------------------------------------------
// The matching engine.
//
// LEARNING NOTE: This is deliberately plain TypeScript — no React, no
// framework. Pure functions like this are the easiest code in the app to
// unit-test (input in, output out, no side effects). Notice how your QA
// instincts apply directly: you could write a table of preference combos and
// expected top results and turn it straight into a test suite.
//
// The approach: each answer contributes weighted criteria. Every criterion
// reads one destination score (0–100). The final match % is the weighted
// average. Reasons are generated from the criteria that scored highest.
//
// MOVING TO A DATABASE — a deliberate design choice. The obvious migration
// was to make `recommend()` async and have it query Supabase directly. That
// would have quietly destroyed the property the paragraph above brags about:
// a function that touches the network can't be tested with a plain table of
// inputs and expected outputs.
//
// So the logic is split in two:
//
//   rank()      pure, synchronous, no I/O — the actual scoring algorithm
//   recommend() async — fetches the catalog, then delegates to rank()
//
// This is the "keep I/O at the edges" principle. The interesting logic stays
// trivially testable (hand `rank()` three fake destinations and assert the
// order), while the messy part — network, credentials, failure — lives in one
// thin wrapper. You get to test the algorithm without standing up a database.
// ---------------------------------------------------------------------------

interface Criterion {
  weight: number;
  /** Extracts a 0–100 "how well does this destination satisfy me" value. */
  value: (d: Destination) => number;
  /** Reason text shown when this criterion is a strong contributor. */
  reason: (d: Destination) => string;
}

/** Build the criteria list from wizard answers. */
function buildCriteria(prefs: Preferences): Criterion[] {
  const criteria: Criterion[] = [];

  // --- Travel party -------------------------------------------------------
  if (prefs.party === "family") {
    criteria.push({
      weight: 3,
      value: (d) => d.scores.familyFriendly,
      reason: () => "Easy with kids in tow",
    });
  } else if (prefs.party === "couple") {
    criteria.push({
      weight: 1.5,
      value: (d) => (d.scores.foodScene + d.scores.hotelQuality) / 2,
      reason: () => "Great date-night material",
    });
  } else {
    criteria.push({
      weight: 1.5,
      value: (d) => d.scores.walkability,
      reason: () => "Perfect for wandering solo",
    });
  }

  // --- Vibe: local culture vs classic sights ------------------------------
  if (prefs.vibe === "local") {
    criteria.push({
      weight: 3,
      value: (d) => d.scores.localCulture,
      reason: () => "Real neighborhood life, not tour-bus stops",
    });
    // Actively discount tourist-heavy places for "local" travelers:
    criteria.push({
      weight: 1,
      value: (d) => 100 - Math.max(0, d.scores.classicSights - 80) * 3,
      reason: () => "Light on tourist crowds",
    });
  } else if (prefs.vibe === "classic") {
    criteria.push({
      weight: 3,
      value: (d) => d.scores.classicSights,
      reason: () => "The iconic sights you came for",
    });
  } else {
    criteria.push({
      weight: 2,
      value: (d) => (d.scores.localCulture + d.scores.classicSights) / 2,
      reason: () => "Balances big sights with local flavor",
    });
  }

  // --- Splurges -----------------------------------------------------------
  if (prefs.splurges.includes("hotel")) {
    criteria.push({
      weight: 2,
      value: (d) => d.scores.hotelQuality,
      reason: () => "Hotels worth coming back to at 4pm",
    });
  }
  if (prefs.splurges.includes("food")) {
    criteria.push({
      weight: 2,
      value: (d) => d.scores.foodScene,
      reason: () => "A food scene worth the splurge",
    });
  }
  if (prefs.splurges.includes("experiences")) {
    criteria.push({
      weight: 2,
      value: (d) => d.scores.experiences,
      reason: () => "Experiences beyond the checklist",
    });
  }
  // No splurges selected → this traveler is value-conscious. Reward lower
  // daily cost (mapped so ~$90/day ≈ 100 and ~$300/day ≈ 0).
  if (prefs.splurges.length === 0) {
    criteria.push({
      weight: 2,
      value: (d) =>
        Math.max(0, Math.min(100, ((300 - d.dailyCost) / 210) * 100)),
      reason: (d) => `Budget-friendly (~$${d.dailyCost}/day)`,
    });
  }

  // --- Transportation -----------------------------------------------------
  if (prefs.transit === "clean-transit") {
    criteria.push({
      weight: 2.5,
      value: (d) => d.scores.transitQuality,
      reason: () => "Public transit that's clean and actually organized",
    });
  } else if (prefs.transit === "rideshare") {
    // Rideshare travelers care that the city is compact OR transit exists
    // as a backup — walkability is the best proxy in our data.
    criteria.push({
      weight: 1.5,
      value: (d) => d.scores.walkability,
      reason: () => "Compact enough that rides stay short and cheap",
    });
  }
  // "car" travelers: no constraint — every destination works.

  return criteria;
}

/**
 * Score a given set of destinations against the traveler's preferences and
 * return the top matches, best first, each with up to three human-readable
 * reasons.
 *
 * Pure and synchronous: same inputs always produce the same output, and it
 * never touches the network. This is the function to unit-test.
 */
export function rank(
  prefs: Preferences,
  destinations: Destination[],
  limit = 3,
): Recommendation[] {
  const criteria = buildCriteria(prefs);
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);

  const scored = destinations.map((destination) => {
    const contributions = criteria.map((c) => ({
      criterion: c,
      value: c.value(destination),
      weighted: c.value(destination) * c.weight,
    }));

    const score = Math.round(
      contributions.reduce((sum, c) => sum + c.weighted, 0) / totalWeight,
    );

    // Reasons = the criteria this destination satisfies best (value ≥ 80),
    // strongest first, capped at three so the card stays scannable.
    const reasons = contributions
      .filter((c) => c.value >= 80)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((c) => c.criterion.reason(destination));

    return { destination, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Load the catalog from Supabase and rank it for this traveler.
 *
 * The only impure part of this module: everything it does is fetch data and
 * hand it to `rank()`.
 */
export async function recommend(
  prefs: Preferences,
  limit = 3,
): Promise<Recommendation[]> {
  const destinations = await getDestinations();
  return rank(prefs, destinations, limit);
}
