import { flightsConfigured, searchFlights } from "@/lib/duffel";

// ---------------------------------------------------------------------------
// The app's first route handler: GET /api/flights?origin=KIX&dest=ICN&date=...
//
// LEARNING NOTE: A route handler is a plain function exported with an HTTP
// method's name from a `route.ts` file under `app/`. It speaks the Web
// standard Request/Response APIs — no Express, no framework request object.
// This one exists so the Duffel access token never leaves the server: the
// browser asks US, and we ask Duffel.
//
// Error philosophy: a bad REQUEST is the caller's bug and gets a 400, but a
// missing token or a Duffel failure returns `{ available: false }` with a
// 200 — flights are optional, and the UI treats "no flights" as a quiet
// shrug, not an error state worth breaking the page over.
//
// DECISION — no auth, no rate limiting, on purpose (2026-09, reaffirmed at
// the Duffel pivot). This endpoint is open and unthrottled because the whole
// stack tolerates abuse cheaply: it's a personal app, and the token is a
// Duffel TEST token — test-mode searches are free and return synthetic
// offers, so the worst an abuser can do is trip Duffel's rate limit, at
// which point the UI degrades to "unavailable". Revisit before ever pointing
// this at a LIVE token: live-mode searches start costing money once the
// search-to-book ratio exceeds Duffel's allowance, and an open endpoint
// would let a stranger run that ratio up. That's the moment this route
// needs throttling or an auth check.
// ---------------------------------------------------------------------------

const IATA = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = (searchParams.get("origin") ?? "").toUpperCase();
  const dest = (searchParams.get("dest") ?? "").toUpperCase();
  const date = searchParams.get("date") ?? "";
  if (!IATA.test(origin) || !IATA.test(dest) || !DAY.test(date)) {
    return Response.json({ error: "origin, dest (IATA) and date (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (!flightsConfigured()) {
    return Response.json({ available: false as const });
  }
  try {
    const offers = await searchFlights(origin, dest, date);
    return Response.json(
      { available: true as const, offers },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("flight search failed:", error); // server log only — never echo Duffel errors to the client
    return Response.json({ available: false as const });
  }
}
