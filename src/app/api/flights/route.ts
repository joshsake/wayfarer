import { amadeusConfigured, searchFlights } from "@/lib/amadeus";

// ---------------------------------------------------------------------------
// The app's first route handler: GET /api/flights?origin=KIX&dest=ICN&date=...
//
// LEARNING NOTE: A route handler is a plain function exported with an HTTP
// method's name from a `route.ts` file under `app/`. It speaks the Web
// standard Request/Response APIs — no Express, no framework request object.
// This one exists so the Amadeus credentials never leave the server: the
// browser asks US, and we ask Amadeus.
//
// Error philosophy: a bad REQUEST is the caller's bug and gets a 400, but a
// missing key or an Amadeus failure returns `{ available: false }` with a
// 200 — flights are optional, and the UI treats "no flights" as a quiet
// shrug, not an error state worth breaking the page over.
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
  if (!amadeusConfigured()) {
    return Response.json({ available: false as const });
  }
  try {
    const offers = await searchFlights(origin, dest, date);
    return Response.json(
      { available: true as const, offers },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("flight search failed:", error); // server log only — never echo Amadeus errors to the client
    return Response.json({ available: false as const });
  }
}
