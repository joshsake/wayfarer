import { normalizeOffers } from "./flights";
import type { FlightOffer } from "./types";

// ---------------------------------------------------------------------------
// The Duffel client — server-only.
//
// LEARNING NOTE: Contrast this file with supabase.ts, which is its opposite
// on both counts.
//
// 1. The env var has NO `NEXT_PUBLIC_` prefix, on purpose. The Supabase
//    publishable key is safe in the browser because Row Level Security limits
//    what it can do; a Duffel access token is a real credential — anyone
//    holding it can search (and, in live mode, BOOK and PAY) as us. No prefix
//    means Next.js never inlines it into the browser bundle: it exists only
//    in the server process, and the browser talks to our own /api/flights
//    route instead of to Duffel directly.
//
// 2. supabase.ts THROWS when its env vars are missing, because the app is
//    useless without a database. Flights are an optional enhancement, so a
//    missing token here degrades instead: flightsConfigured() lets callers
//    check up front and quietly skip the feature. Build, tests, and the whole
//    app must work with no Duffel token at all.
//
// LEARNING NOTE — the provider pivot (September 2026). This file replaced
// amadeus.ts after Amadeus shut its self-service developer portal, taking the
// free sandbox with it. Two things are worth noticing about the swap:
//
//   - It got SIMPLER. Amadeus used OAuth client-credentials, which meant a
//     token endpoint, an expiry clock, and a cache (with a thundering-herd
//     guard) just to make one search. Duffel hands you a static bearer
//     token, so the whole search is a single POST. Fewer moving parts, fewer
//     tests, nothing to invalidate.
//   - It was CONTAINED. The route handler, FlightStrip, the trip form, and
//     flightQueries never learned what Amadeus looked like — they only ever
//     saw our own FlightOffer type. So swapping providers meant rewriting
//     this file and the field mapping in normalizeOffers, and nothing else.
//     That's what a mapping boundary buys you.
// ---------------------------------------------------------------------------

// `return_offers=true` inlines the offers in the create response (otherwise
// it's a second GET). `supplier_timeout` caps how long Duffel waits on slow
// airlines, in ms — a strip that hangs for a minute is worse than one with
// two fewer offers.
const OFFER_REQUESTS_URL =
  "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=10000";

export function flightsConfigured(): boolean {
  return Boolean(process.env.DUFFEL_ACCESS_TOKEN);
}

/**
 * One-way, one adult, economy, at most one connection: the cheapest three
 * offers for `origin` → `dest` on `date`, or a thrown Error the route
 * handler turns into `{ available: false }`.
 */
export async function searchFlights(
  origin: string,
  dest: string,
  date: string,
): Promise<FlightOffer[]> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  // The route checks flightsConfigured() first; this guards any future
  // caller that doesn't, so the failure is a clear message in OUR log rather
  // than a puzzling 401 caused by an `Authorization: Bearer undefined` header.
  if (!token) throw new Error("DUFFEL_ACCESS_TOKEN is not set");

  const res = await fetch(OFFER_REQUESTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Duffel-Version": "v2",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      data: {
        slices: [{ origin, destination: dest, departure_date: date }],
        passengers: [{ type: "adult" }],
        cabin_class: "economy",
        max_connections: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Duffel search failed: ${res.status}`);
  return normalizeOffers(await res.json());
}
