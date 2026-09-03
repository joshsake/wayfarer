import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flightsConfigured, searchFlights } from "@/lib/duffel";
import duffelFixture from "./fixtures/duffel-offer-request.json";

// ---------------------------------------------------------------------------
// The Duffel client, tested without a network.
//
// LEARNING NOTE: `vi.stubGlobal("fetch", ...)` swaps the real fetch for a
// recorder — the client under test can't tell the difference, and we get to
// read back exactly what it would have sent. That's the whole test surface
// for a provider client: the REQUEST it builds (URL, method, headers, body)
// and what it does with the RESPONSE (normalize on 2xx, throw otherwise).
// Compare the Amadeus version of this file (git history): six tests, most of
// them about a token cache. A static bearer token has no cache to get wrong,
// so the client — and its tests — shrank to the essentials.
// ---------------------------------------------------------------------------

const OFFER_REQUESTS_URL =
  "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=10000";

/** A fetch stub that answers every call with the given response. */
function makeFetchMock(response: () => Response) {
  // Typed with fetch's full signature so `mock.calls` records (url, init)
  // pairs — the request-shape test reads the init back out.
  const impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
    async () => response();
  return vi.fn(impl);
}

const fixtureResponse = () =>
  new Response(JSON.stringify(duffelFixture), { status: 200 });

describe("searchFlights", () => {
  beforeEach(() => {
    vi.stubEnv("DUFFEL_ACCESS_TOKEN", "duffel_test_unit-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends exactly one POST matching the Duffel offer-request contract", async () => {
    const fetchMock = makeFetchMock(fixtureResponse);
    vi.stubGlobal("fetch", fetchMock);

    await searchFlights("KIX", "ICN", "2026-11-23");

    // One request, no token dance first.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toBe(OFFER_REQUESTS_URL);
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer duffel_test_unit-token");
    expect(headers["Duffel-Version"]).toBe("v2");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");

    expect(JSON.parse(String(init?.body))).toEqual({
      data: {
        slices: [{ origin: "KIX", destination: "ICN", departure_date: "2026-11-23" }],
        passengers: [{ type: "adult" }],
        cabin_class: "economy",
        max_connections: 1,
      },
    });
  });

  it("rejects when Duffel answers with a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => new Response("rate limited", { status: 429 })),
    );

    await expect(searchFlights("KIX", "ICN", "2026-11-23")).rejects.toThrow(
      "Duffel search failed: 429",
    );
  });

  it("returns the three cheapest normalized offers, cheapest first", async () => {
    vi.stubGlobal("fetch", makeFetchMock(fixtureResponse));

    const offers = await searchFlights("KIX", "ICN", "2026-11-23");

    // The fixture holds four offers, deliberately out of price order
    // (412.60, 298.40, 550.00, 275.10). The 550.00 one must not survive.
    expect(offers.map((o) => o.price)).toEqual(["275.10", "298.40", "412.60"]);
    expect(offers.map((o) => o.stops)).toEqual([1, 1, 0]);
    expect(offers.map((o) => o.segments[0].carrier)).toEqual(["CI", "MU", "KE"]);
  });

  it("refuses to send `Bearer undefined` when the token is missing", async () => {
    vi.stubEnv("DUFFEL_ACCESS_TOKEN", "");
    const fetchMock = makeFetchMock(fixtureResponse);
    vi.stubGlobal("fetch", fetchMock);

    // The route checks flightsConfigured() first, so this is a guard against
    // some FUTURE caller that forgets to — it should fail in the server log,
    // not as a confusing 401 from Duffel.
    await expect(searchFlights("KIX", "ICN", "2026-11-23")).rejects.toThrow(/DUFFEL_ACCESS_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("flightsConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is true only when the token is present and non-empty", () => {
    vi.stubEnv("DUFFEL_ACCESS_TOKEN", "duffel_test_unit-token");
    expect(flightsConfigured()).toBe(true);

    vi.stubEnv("DUFFEL_ACCESS_TOKEN", "");
    expect(flightsConfigured()).toBe(false);

    vi.stubEnv("DUFFEL_ACCESS_TOKEN", undefined);
    expect(flightsConfigured()).toBe(false);
  });
});
