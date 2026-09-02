import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTokenCache, searchFlights, amadeusConfigured } from "@/lib/amadeus";
import amadeusFixture from "./fixtures/amadeus-flight-offers.json";

// ---------------------------------------------------------------------------
// The Amadeus client's token cache, tested without a network.
//
// LEARNING NOTE: `vi.stubGlobal("fetch", ...)` swaps the real fetch for a
// recorder — the client under test can't tell the difference, and we get to
// count exactly which endpoints it hit. The cache is module-level state,
// which is why amadeus.ts exports resetTokenCache(): without it, whichever
// test ran first would leave a warm token behind for the others, and test
// order would start to matter (the classic shared-state smell).
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://test.api.amadeus.com/v1/security/oauth2/token";

/** A fetch stub that answers the token endpoint and the search endpoint. */
function makeFetchMock(expiresIn = 1799) {
  // Typed with fetch's full signature so `mock.calls` records (url, init)
  // pairs — the bearer-token test reads the init back out.
  const impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
    async (input) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        return new Response(
          JSON.stringify({ access_token: "test-token", expires_in: expiresIn }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(amadeusFixture), { status: 200 });
    };
  return vi.fn(impl);
}

describe("searchFlights token cache", () => {
  beforeEach(() => {
    vi.stubEnv("AMADEUS_CLIENT_ID", "test-id");
    vi.stubEnv("AMADEUS_CLIENT_SECRET", "test-secret");
    resetTokenCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetches the token once across two searches", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const first = await searchFlights("KIX", "ICN", "2026-11-23");
    const second = await searchFlights("ICN", "SIN", "2026-11-27");

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((u) => u === TOKEN_URL)).toHaveLength(1);
    expect(urls.filter((u) => u.includes("/v2/shopping/flight-offers"))).toHaveLength(2);

    // And the searches actually returned normalized offers.
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });

  it("shares one token request between concurrent searches on a cold cache", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    // Both start before either token response lands — the FlightStrip
    // reality, where every strip on the results page fetches at once.
    await Promise.all([
      searchFlights("KIX", "ICN", "2026-11-23"),
      searchFlights("ICN", "SIN", "2026-11-27"),
    ]);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((u) => u === TOKEN_URL)).toHaveLength(1);
    expect(urls.filter((u) => u.includes("/v2/shopping/flight-offers"))).toHaveLength(2);
  });

  it("recovers after a failed token fetch instead of caching the rejection", async () => {
    let tokenCalls = 0;
    const impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
      async (input) => {
        const url = String(input);
        if (url === TOKEN_URL) {
          tokenCalls += 1;
          if (tokenCalls === 1) return new Response("boom", { status: 500 });
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 1799 }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(amadeusFixture), { status: 200 });
      };
    vi.stubGlobal("fetch", vi.fn(impl));

    await expect(searchFlights("KIX", "ICN", "2026-11-23")).rejects.toThrow(
      "Amadeus auth failed: 500",
    );
    // The failure must not stick: the next call tries again and succeeds.
    const offers = await searchFlights("KIX", "ICN", "2026-11-23");
    expect(offers).toHaveLength(2);
    expect(tokenCalls).toBe(2);
  });

  it("rejects loudly when the token response body is malformed", async () => {
    const impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
      async (input) => {
        if (String(input) === TOKEN_URL) {
          // 200 OK but not the shape we need — no access_token at all.
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify(amadeusFixture), { status: 200 });
      };
    vi.stubGlobal("fetch", vi.fn(impl));

    // Without validation this would silently send "Bearer undefined".
    await expect(searchFlights("KIX", "ICN", "2026-11-23")).rejects.toThrow(
      /access_token|expires_in/,
    );
  });

  it("re-fetches the token once it has expired", async () => {
    vi.useFakeTimers(); // fakes Date.now() too, so the cache's clock is ours
    const fetchMock = makeFetchMock(1799);
    vi.stubGlobal("fetch", fetchMock);

    await searchFlights("KIX", "ICN", "2026-11-23");

    // The client refreshes 60s early, so the cached token dies at
    // (1799 - 60) seconds. Step just past that.
    vi.advanceTimersByTime(1740 * 1000);
    await searchFlights("KIX", "ICN", "2026-11-23");

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((u) => u === TOKEN_URL)).toHaveLength(2);
    expect(urls.filter((u) => u.includes("/v2/shopping/flight-offers"))).toHaveLength(2);
  });

  it("passes our query and the bearer token to the search endpoint", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await searchFlights("KIX", "ICN", "2026-11-23");

    const searchCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/v2/shopping/flight-offers"),
    )!;
    const url = new URL(String(searchCall[0]));
    expect(url.searchParams.get("originLocationCode")).toBe("KIX");
    expect(url.searchParams.get("destinationLocationCode")).toBe("ICN");
    expect(url.searchParams.get("departureDate")).toBe("2026-11-23");
    expect(url.searchParams.get("max")).toBe("3");

    const headers = searchCall[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });
});

describe("amadeusConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is true only when both env vars are present", () => {
    vi.stubEnv("AMADEUS_CLIENT_ID", "test-id");
    vi.stubEnv("AMADEUS_CLIENT_SECRET", "test-secret");
    expect(amadeusConfigured()).toBe(true);

    vi.stubEnv("AMADEUS_CLIENT_SECRET", "");
    expect(amadeusConfigured()).toBe(false);
  });
});
