import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/flights/route";

// ---------------------------------------------------------------------------
// The /api/flights route handler, unit-tested.
//
// LEARNING NOTE: Because a Next.js route handler is just an exported function
// taking a Web-standard Request, we can call it directly in Vitest — no
// server, no supertest. The paths worth pinning here are the ones with no
// Duffel involved at all: bad params (400) and a missing token (200 with
// { available: false } — flights are optional, so "not configured" is a
// quiet shrug, never an error the UI has to handle).
// ---------------------------------------------------------------------------

function flightsRequest(query: string): Request {
  return new Request(`http://localhost/api/flights?${query}`);
}

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
  });
});
