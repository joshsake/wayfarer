import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/flights/route";
import { searchFlights } from "@/lib/duffel";
import type { FlightOffer } from "@/lib/types";

// ---------------------------------------------------------------------------
// The /api/flights route handler, unit-tested.
//
// LEARNING NOTE: Because a Next.js route handler is just an exported function
// taking a Web-standard Request, we can call it directly in Vitest — no
// server, no supertest. The paths worth pinning here are the ones with no
// Duffel involved at all: bad params (400) and a missing token (200 with
// { available: false } — flights are optional, so "not configured" is a
// quiet shrug, never an error the UI has to handle).
//
// LEARNING NOTE: For the paths that DO reach the provider, `vi.mock` swaps
// the duffel module's searchFlights for a fake we script per test — resolve
// with offers, or reject like a real failure — while `importOriginal` keeps
// flightsConfigured real, so the env var still decides "configured or not".
// That's the boundary from FlightStrip's point of view: the route's contract
// is what the strip renders, so every branch of it is pinned here.
// ---------------------------------------------------------------------------

vi.mock("@/lib/duffel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/duffel")>();
  return { ...actual, searchFlights: vi.fn() };
});
const search = vi.mocked(searchFlights);

function flightsRequest(query: string): Request {
  return new Request(`http://localhost/api/flights?${query}`);
}

const OFFERS: FlightOffer[] = [
  {
    price: "412.60",
    currency: "USD",
    stops: 0,
    duration: "PT1H55M",
    segments: [
      {
        from: "KIX",
        to: "ICN",
        departAt: "2026-11-23T11:00:00",
        arriveAt: "2026-11-23T12:55:00",
        carrier: "KE",
        flightNumber: "724",
      },
    ],
  },
];

describe("GET /api/flights", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects bad params with a 400", async () => {
    const cases = [
      "", //                                        everything missing
      "origin=KIX&dest=ICN", //                     no date
      "origin=K1X&dest=ICN&date=2026-11-23", //     digit in an IATA code
      "origin=KIX&dest=SEOUL&date=2026-11-23", //   wrong length
      "origin=KIX&dest=ICN&date=Nov+23", //         not YYYY-MM-DD
    ];
    for (const query of cases) {
      const res = await GET(flightsRequest(query));
      expect(res.status).toBe(400);
    }
  });

  it("returns 200 { available: false } when Duffel isn't configured", async () => {
    vi.stubEnv("DUFFEL_ACCESS_TOKEN", "");

    const res = await GET(flightsRequest("origin=KIX&dest=ICN&date=2026-11-23"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(search).not.toHaveBeenCalled();
  });
});

describe("GET /api/flights with a configured token", () => {
  beforeEach(() => {
    vi.stubEnv("DUFFEL_ACCESS_TOKEN", "duffel_test_unit-token");
    search.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("turns a Duffel failure into 200 { available: false }, uncached, logged server-side", async () => {
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => {});
    search.mockRejectedValueOnce(new Error("Duffel search failed: 500 — upstream exploded"));

    const res = await GET(flightsRequest("origin=KIX&dest=ICN&date=2026-11-23"));

    expect(res.status).toBe(200);
    // Exact equality: nothing about the failure leaks into the body.
    expect(await res.json()).toEqual({ available: false });
    // A failure must not be cached for ten minutes — the next request
    // should get a fresh chance.
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(serverLog).toHaveBeenCalledOnce();
  });

  it("returns the offers with a 10-minute shared cache on success", async () => {
    search.mockResolvedValueOnce(OFFERS);

    // Lowercase on purpose: the route uppercases before the provider sees it.
    const res = await GET(flightsRequest("origin=kix&dest=icn&date=2026-11-23"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, offers: OFFERS });
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=600");
    expect(search).toHaveBeenCalledWith("KIX", "ICN", "2026-11-23");
  });
});
