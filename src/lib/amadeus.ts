import { normalizeOffers } from "./flights";
import type { FlightOffer } from "./types";

// ---------------------------------------------------------------------------
// The Amadeus client — server-only.
//
// LEARNING NOTE: Contrast this file with supabase.ts, which is its opposite
// on both counts.
//
// 1. These env vars have NO `NEXT_PUBLIC_` prefix, on purpose. The Supabase
//    publishable key is safe in the browser because Row Level Security limits
//    what it can do; the Amadeus client secret is a real credential — anyone
//    holding it can burn our rate limit or run up usage. No prefix means
//    Next.js never inlines it into the browser bundle: it exists only in the
//    server process, and the browser talks to our own /api/flights route
//    instead of to Amadeus directly.
//
// 2. supabase.ts THROWS when its env vars are missing, because the app is
//    useless without a database. Flights are an optional enhancement, so a
//    missing key here degrades instead: amadeusConfigured() lets callers
//    check up front and quietly skip the feature. Build, tests, and the whole
//    app must work with no Amadeus key at all.
// ---------------------------------------------------------------------------

const BASE = "https://test.api.amadeus.com";

export function amadeusConfigured(): boolean {
  return Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const res = await fetch(`${BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID!,
      client_secret: process.env.AMADEUS_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Amadeus auth failed: ${res.status}`);
  const json = await res.json();
  // Refresh 60s early so a token never expires mid-request.
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.token;
}

/** Test hook: forget the cached token. */
export function resetTokenCache(): void {
  cachedToken = null;
}

export async function searchFlights(origin: string, dest: string, date: string): Promise<FlightOffer[]> {
  const token = await getToken();
  const params = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: dest,
    departureDate: date,
    adults: "1",
    max: "3",
    currencyCode: "USD",
  });
  const res = await fetch(`${BASE}/v2/shopping/flight-offers?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Amadeus search failed: ${res.status}`);
  return normalizeOffers(await res.json());
}
