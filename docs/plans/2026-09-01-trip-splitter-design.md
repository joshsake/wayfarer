# Trip Splitter — Design

**Date:** 2026-09-01
**Status:** Approved
**Motivating trip:** Japan → (Korea | Singapore), Nov 13–29 2026, ≥8 full days
Japan, ≥2 full days Singapore, Japan pinned first.

## Problem

Wayfarer answers "where should I go?" It cannot answer "I know where I'm
going — how do I split my days?" It has no concept of dates, multi-country
routing, or day allocation.

## Scope decisions (with the user)

1. **Product shape: trip splitter.** Input: date range, countries, ordering
   pins, per-country minimum full days. Output: an ordered plan with days
   allocated per country and the reasoning shown. Not a day-by-day itinerary
   (no activities catalog — deferred), not saved/shareable trips (deferred).
2. **Allocation logic: preference-weighted.** Spare days beyond the minimums
   go to countries in proportion to their existing `rank()` match scores.
   Ordering (where not pinned) minimizes total flight distance.
3. **Day counting: travel day = arrival country's, not "full".**

## Day-counting semantics

A trip is an inclusive date range → *D* calendar days. Every calendar day
belongs to exactly one leg.

- The first day of every leg is a **travel day** (arrival) and does not count
  toward that leg's full days.
- The final day of the trip is also a travel day (departure home).
- A leg's **full days** = allocated days − 1; final leg: − 2.

Worked example (the motivating trip): Nov 13–29 = 17 days, 3 legs →
4 travel days → 13 full days. Minimums 8 + 2 + 2 = 12 → 1 spare day.

Feasibility inequality: `Σ minFullDays + (legs + 1) ≤ D`.

## Data model + migrations

New `supabase/migrations/` directory **checked into the repo**. The README
already claims the database is reproducible from migrations, but none were
ever committed — this fixes that gap.

- `0001_baseline.sql` — reconstructs the existing `destinations` schema, RLS
  policy (public SELECT only), and seed rows. Documented as retroactive.
- `0002_trip_splitter.sql` — `ALTER TABLE destinations ADD COLUMN lat/lng`
  (numeric, NOT NULL after backfill), coordinates for existing rows, and a
  **Singapore** seed row (catalog has Kyoto and Seoul but no Singapore).

`Destination` (TypeScript) gains `lat`/`lng`; the mapping lives only in
`toDestination()` as designed.

## Core algorithm — `src/lib/trip.ts`

Mirrors the `rank()`/`recommend()` split: `splitTrip(constraints, prefs,
destinations)` is pure and synchronous; async `planTrip()` fetches the catalog
and delegates.

1. **Validate.** Dates parse and are ordered; countries exist in the catalog;
   feasibility inequality holds. Violations return typed errors (a result
   union, not throws) so the UI can explain *why* a trip doesn't fit.
2. **Order.** Enumerate permutations honoring pins; choose the permutation
   minimizing total great-circle (haversine) distance between consecutive
   legs' representative destinations (each country's best-matching
   destination per `rank()`). Deterministic tie-break: lexicographic.
3. **Allocate.** Each leg gets its minimum full days + travel overhead. Spare
   days distribute proportionally to match scores via largest-remainder;
   deterministic tie-break by leg order.
4. **Output.** `TripPlan`: per-leg country, representative destination,
   concrete start/end dates, full-day count, match score, human-readable
   reasons (including where spare days went and why).

## UI

- **`/trip`** — client-component form: start/end dates, countries drawn from
  the catalog, per-country minimum full days, "must be first" pin. Navigates
  to `/trip/results?…` with everything in query params (same pattern as the
  wizard → `/results`).
- **`/trip/results`** — server component; parses params, calls `planTrip()`,
  renders a date-labeled timeline of legs with scores and reasoning.
  Infeasible constraints render the arithmetic of why it doesn't fit.
- Entry point: "Plan a trip with these answers" link on `/results`, carrying
  the pref params through.

## Testing

- **Vitest (new dev dependency).** The repo has only Playwright today;
  `splitTrip()` is exactly what unit tests are for: day-counting rules,
  feasibility edges (D one short vs. exactly enough), ordering choice,
  largest-remainder allocation, determinism.
- **Playwright.** One E2E spec: fill the `/trip` form, assert a rendered plan
  (requires the live database).

## Known infrastructure notes

- The Supabase project was auto-paused (free tier) and unpaused on
  2026-09-01; migrations 0001 (as baseline record) and 0002 must be applied
  to it.
- Migration 0001 is retroactive documentation of schema that was originally
  applied via the dashboard.
