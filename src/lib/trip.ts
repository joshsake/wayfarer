// ---------------------------------------------------------------------------
// The trip splitter — date math foundation.
//
// LEARNING NOTE: All date arithmetic here is UTC-midnight timestamps
// (numbers), never local `new Date(...)`. Local time has DST jumps where a
// "day" is 23 or 25 hours; UTC days are always exactly 86,400,000 ms, which
// makes day counting plain integer math. Dates cross the API boundary as
// "YYYY-MM-DD" strings and only become numbers inside this module.
// ---------------------------------------------------------------------------

import type {
  Destination,
  Preferences,
  Recommendation,
  TripConstraints,
  TripError,
  TripLeg,
  TripResult,
} from "./types";
import { rank } from "./matching";

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" into a UTC-midnight timestamp, or null if invalid. */
function parseDay(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ts = Date.UTC(year, month - 1, day);
  // Date.UTC silently rolls over impossible dates (Feb 30 → Mar 2).
  // Round-trip the result to catch that.
  const roundTrip = new Date(ts);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return null;
  }
  return ts;
}

/** Format a UTC-midnight timestamp back to "YYYY-MM-DD". */
function formatDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Inclusive day count of a date range, or null if the range is invalid. */
export function countDays(startDate: string, endDate: string): number | null {
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  if (start === null || end === null || end < start) return null;
  return (end - start) / DAY_MS + 1;
}

/** A point on the globe, in decimal degrees. */
interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance between two points, in kilometers (haversine).
 *
 * LEARNING NOTE: We only ever *compare* route lengths, so any monotonic
 * distance would do — but haversine is the standard, cheap, and easy to
 * sanity-check against real city pairs in tests.
 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const EARTH_RADIUS_KM = 6371;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function fail(code: TripError["code"], message: string): TripResult {
  return { ok: false, error: { code, message } };
}

/**
 * Split a trip's days across countries. Pure and synchronous — the algorithm
 * half of the same pattern as rank()/recommend().
 *
 * LEARNING NOTE: invalid input comes back as a TripResult with ok: false,
 * not an exception. Infeasible constraints are an *expected* outcome the UI
 * must explain ("your minimums need 14 days, you have 13"), and expected
 * outcomes are data. Exceptions are for the unexpected.
 */
export function splitTrip(
  constraints: TripConstraints,
  prefs: Preferences,
  destinations: Destination[],
): TripResult {
  const { startDate, endDate, countries, firstCountry } = constraints;

  const totalDays = countDays(startDate, endDate);
  if (totalDays === null) {
    return fail(
      "bad-dates",
      `"${startDate}" to "${endDate}" isn't a valid date range — use YYYY-MM-DD with the end date on or after the start.`,
    );
  }
  if (countries.length === 0) {
    return fail("does-not-fit", "Pick at least one country to split days across.");
  }
  const names = countries.map((c) => c.country);
  if (new Set(names).size !== names.length) {
    return fail("unknown-country", "Each country can appear in the trip only once.");
  }
  if (firstCountry !== undefined && !names.includes(firstCountry)) {
    return fail(
      "unknown-country",
      `"${firstCountry}" is pinned as the first stop but isn't one of the trip's countries.`,
    );
  }

  // Each country is represented by its best-matching destination for these
  // preferences — rank() is already sorted best-first, so the first
  // destination we see per country is its representative.
  const reps = new Map<string, Recommendation>();
  for (const rec of rank(prefs, destinations, destinations.length)) {
    if (!reps.has(rec.destination.country)) reps.set(rec.destination.country, rec);
  }
  for (const name of names) {
    if (!reps.has(name)) {
      return fail("unknown-country", `The catalog has no destinations in "${name}" yet.`);
    }
  }

  // Feasibility. Every leg burns its arrival day, and the trip's last day is
  // the flight home: countries.length + 1 travel days total.
  const travelOverhead = countries.length + 1;
  const minSum = countries.reduce((sum, c) => sum + c.minFullDays, 0);
  if (minSum + travelOverhead > totalDays) {
    return fail(
      "does-not-fit",
      `This trip is ${totalDays} days, but ${minSum} minimum full days + ` +
        `${travelOverhead} travel days (${countries.length} arrivals + the flight home) ` +
        `needs ${minSum + travelOverhead}. Trim the minimums or extend the dates.`,
    );
  }

  // Ordering + allocation follow in the next tasks; return a placeholder
  // single-leg plan so the exactly-fits test can pass meaningfully? No —
  // implement fully in Tasks 7–8. For THIS task, return ok with an empty
  // legs array; Task 7 replaces it.
  return { ok: true, plan: { legs: [], totalDays, spareDays: totalDays - minSum - travelOverhead } };
}
