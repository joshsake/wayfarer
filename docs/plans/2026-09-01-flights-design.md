# Flights on the Trip Plan — Design

**Date:** 2026-09-01
**Status:** Approved
**Depends on:** the trip splitter (PR #4, merged)

## Problem

The trip splitter tells you *when* to be *where*, but the transitions between
legs — the flights — are invisible, and they dominate both the budget and the
feel of the trip. Show real flight options for every transition in the plan.

## Decisions (with the user)

1. **Provider: Amadeus Self-Service API.** Google Flights has no public API
   (QPX Express shut down in 2018); scraper services are paid. Amadeus has a
   free self-service test tier. The user signs up and holds the credentials.
2. **Scope: all four flights** — home → first leg, each inter-leg transition,
   last leg → home. The `/trip` form gains one optional "Flying from" IATA
   field; without it, only the inter-leg transitions render.
3. **Architecture: route handler + client fetch.** The plan page renders
   instantly; per-transition client components fetch `/api/flights`. This is
   the app's first API route — justified because the *browser* needs the
   data, per the README's own rule.

## What the user sees

Each leg card gains a flight strip for the flight into that leg; the final
card also gets the flight home. A strip shows up to 3 offers (price, carrier,
times, stops), a loading shimmer before that, and a quiet one-liner on any
failure ("Couldn't fetch flights — plan unaffected"). Prices are labeled as
test data while the key is a sandbox key.

## Data model

Migration `2026...\_airports.sql`: `destinations` gains `iata_code text`
(KIX for Kyoto, ICN Seoul, SIN Singapore, plus the other eight). Applied via
the dashboard SQL editor like the previous migrations. `Destination` and
`TripLeg` carry the airport code through to the UI.

## Components

- **`src/lib/amadeus.ts`** (server-only): client-credentials token fetch,
  cached until expiry; `searchFlights(origin, dest, date)` → normalized
  offers. Reads `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` — deliberately
  NOT `NEXT_PUBLIC_`; these must never reach the browser. Flights are an
  optional enhancement, so a missing key degrades to "unavailable" instead of
  crashing the app (contrast with the Supabase env check, which is
  load-bearing for everything).
- **`src/lib/flights.ts`** (pure): `flightQueries(plan, homeAirport?)` →
  `{origin, dest, date}[]`; Amadeus-response normalizer → `FlightOffer[]`.
  Both unit-testable without network.
- **`src/app/api/flights/route.ts`**: validates params (3-letter IATA, sane
  date), calls the lib, returns JSON with ~10-minute caching (sandbox rate
  limits are tight), never echoes raw Amadeus errors.
- **`src/components/FlightStrip.tsx`** (client): fetch on mount; shimmer →
  offers → quiet failure line.

## Sandbox reality

The Amadeus test environment has limited inventory and indicative prices.
KIX/ICN/SIN are covered routes. UI labels prices "test data" until a
production key exists.

## Testing

- **Vitest:** `flightQueries` (with/without home airport; dates = leg start
  dates), the offer normalizer against a checked-in sandbox-response fixture,
  token caching with injected clock.
- **Playwright:** stub `/api/flights` with `page.route()` (CI has no Amadeus
  key); assert strips render offers and degrade quietly with no key.
- **Manual:** live smoke on the motivating trip once the user's key is in
  `.env.local`.
