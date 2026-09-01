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
  CountryConstraint,
  Destination,
  Preferences,
  Recommendation,
  TripConstraints,
  TripError,
  TripLeg,
  TripResult,
} from "./types";
import { rank } from "./matching";
import { getDestinations } from "./destinations";

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

/** All orderings of the input (n is tiny — a trip has a handful of legs). */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
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
    return fail("bad-input", "Pick at least one country to split days across.");
  }
  // The cap keeps the permutation search below (worst case (n−1)! orders)
  // effectively instant — and honestly, past 8 countries the trip is all
  // airports anyway.
  if (countries.length > 8) {
    return fail(
      "bad-input",
      "That's more countries than one trip can do justice — pick 8 or fewer.",
    );
  }
  for (const c of countries) {
    if (!Number.isInteger(c.minFullDays) || c.minFullDays < 0) {
      return fail(
        "bad-input",
        `The minimum for "${c.country}" must be a whole number of days, 0 or more (got ${c.minFullDays}).`,
      );
    }
  }
  const names = countries.map((c) => c.country);
  if (new Set(names).size !== names.length) {
    return fail("bad-input", "Each country can appear in the trip only once.");
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

  const spare = totalDays - minSum - travelOverhead;

  // Ordering: cheapest total flight distance among candidate orderings.
  // Candidates are generated from a name-sorted list, so ties resolve to the
  // alphabetically-earliest route — deterministic, testable.
  //
  // LEARNING NOTE: with a pinned first country we permute only the other
  // n−1 legs and prepend the pin — never generate all n! orders and filter.
  // Same candidates either way, but a factor of n less work; factorials grow
  // fast enough that at n=10 "generate then filter" costs seconds and a
  // gigabyte of arrays that the filter immediately throws away.
  const sortedCountries = [...countries].sort((a, b) => a.country.localeCompare(b.country));
  let candidates: CountryConstraint[][];
  if (firstCountry === undefined) {
    candidates = permutations(sortedCountries);
  } else {
    const pinned = sortedCountries.find((c) => c.country === firstCountry)!;
    const rest = sortedCountries.filter((c) => c !== pinned);
    candidates = permutations(rest).map((order) => [pinned, ...order]);
  }
  let bestOrder = candidates[0];
  let bestDistance = Infinity;
  for (const order of candidates) {
    let distance = 0;
    for (let i = 0; i + 1 < order.length; i++) {
      distance += distanceKm(
        reps.get(order[i].country)!.destination,
        reps.get(order[i + 1].country)!.destination,
      );
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOrder = order;
    }
  }

  // Spare days beyond the minimums go to countries in proportion to their
  // match scores — the "preference-weighted" half of the design.
  //
  // LEARNING NOTE: naive proportional shares are fractional; you can't spend
  // 0.4 of a day in Seoul. The largest-remainder method fixes that: floor
  // every share, then hand the leftover whole days to the largest fractional
  // parts. Ties break toward earlier legs so the result is deterministic —
  // nondeterministic allocation would make this function untestable.
  const scores = bestOrder.map((c) => reps.get(c.country)!.score);
  const totalScore = scores.reduce((sum, s) => sum + s, 0);
  const quotas = scores.map((s) =>
    totalScore === 0 ? spare / bestOrder.length : (spare * s) / totalScore,
  );
  const spareAlloc = quotas.map(Math.floor);
  let leftover = spare - spareAlloc.reduce((sum, v) => sum + v, 0);
  const byRemainder = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byRemainder) {
    if (leftover === 0) break;
    spareAlloc[i] += 1;
    leftover -= 1;
  }

  const start = parseDay(startDate)!;
  let cursor = start;
  const legs: TripLeg[] = bestOrder.map((c, i) => {
    const rep = reps.get(c.country)!;
    const travelDays = i === bestOrder.length - 1 ? 2 : 1;
    const fullDays = c.minFullDays + spareAlloc[i];
    const legStart = cursor;
    const legEnd = cursor + (fullDays + travelDays - 1) * DAY_MS;
    cursor = legEnd + DAY_MS;
    return {
      country: c.country,
      destination: rep.destination,
      startDate: formatDay(legStart),
      endDate: formatDay(legEnd),
      fullDays,
      travelDays,
      spareDays: spareAlloc[i],
      matchScore: rep.score,
      reasons: rep.reasons,
    };
  });

  return { ok: true, plan: { legs, totalDays, spareDays: spare } };
}

/** Load the catalog and split the trip — the only impure part of this module. */
export async function planTrip(
  constraints: TripConstraints,
  prefs: Preferences,
): Promise<TripResult> {
  const destinations = await getDestinations();
  return splitTrip(constraints, prefs, destinations);
}
