"use client";

// ---------------------------------------------------------------------------
// One flight strip: the offers for a single transition (home → first stop,
// leg → leg, last stop → home), fetched from our own /api/flights.
//
// LEARNING NOTE: This is a client component embedded in a server-rendered
// page. The plan itself renders instantly on the server; each strip then
// fetches its flights from the browser after mount. That split is deliberate:
// flight lookups are slow, optional, and can fail — none of which should
// delay or break the plan. The server sends finished HTML; the strips fill
// themselves in (or quietly report unavailability) afterwards.
//
// LEARNING NOTE: The cleanup function returned from useEffect aborts the
// in-flight fetch. Without it, navigating away mid-fetch would leave a
// dangling request whose .then() fires against an unmounted component.
// AbortController is the Web-standard way to cancel a fetch.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { FlightOffer, FlightQuery } from "@/lib/types";

type StripState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; offers: FlightOffer[] };

/** "PT7H25M" is for machines; humans get "nonstop" / "1 stop" / "2 stops". */
function stopsLabel(stops: number): string {
  if (stops === 0) return "nonstop";
  return stops === 1 ? "1 stop" : `${stops} stops`;
}

/**
 * "2026-11-23T11:00:00" → "11:00". The slice is deliberate: Duffel's times are
 * already local to their airport, with no zone marker. Passing them through
 * `new Date()` / `toLocaleTimeString()` would REINTERPRET them in the
 * viewer's timezone — an 11:00 Osaka departure would render as some other
 * hour entirely. String surgery keeps them honest.
 */
function localTime(isoLocal: string): string {
  return isoLocal.slice(11, 16);
}

export default function FlightStrip({
  query,
  label,
}: {
  query: FlightQuery;
  label: string;
}) {
  const [state, setState] = useState<StripState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      origin: query.origin,
      dest: query.dest,
      date: query.date,
    });

    fetch(`/api/flights?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`flights request failed: ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        const body = json as { available?: boolean; offers?: FlightOffer[] };
        if (body?.available === true && Array.isArray(body.offers)) {
          // Belt and suspenders: normalizeOffers already guarantees every
          // offer has ≥1 segment server-side, but this component shouldn't
          // crash if that contract ever slips.
          const offers = body.offers.filter(
            (offer) => Array.isArray(offer?.segments) && offer.segments.length > 0,
          );
          setState({ status: "loaded", offers });
        } else {
          setState({ status: "unavailable" });
        }
      })
      .catch(() => {
        // An abort lands here too — skip the state update; we're unmounting.
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      });

    return () => controller.abort();
  }, [query.origin, query.dest, query.date]);

  return (
    <div data-testid="flight-strip" className="mt-4 border-t border-stone-100 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-stone-400">
          {label} · {query.origin} → {query.dest}
        </p>
        {/* Test-mode reality check, aligned over the price column: a Duffel
            test token returns synthetic offers, not bookable prices. */}
        {state.status === "loaded" && state.offers.length > 0 && (
          <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
            test data
          </span>
        )}
      </div>

      {state.status === "loading" && (
        <div
          data-testid="flight-loading"
          role="status"
          aria-busy="true"
          className="mt-2 flex flex-col gap-1.5"
        >
          <div className="h-4 animate-pulse rounded bg-stone-100" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-stone-100" />
        </div>
      )}

      {state.status === "unavailable" && (
        <p data-testid="flight-unavailable" className="mt-2 text-sm text-stone-400">
          Couldn&apos;t fetch flights — plan unaffected.
        </p>
      )}

      {state.status === "loaded" && state.offers.length === 0 && (
        <p className="mt-2 text-sm text-stone-400">No flights found for this day.</p>
      )}

      {state.status === "loaded" && state.offers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {state.offers.map((offer) => {
            const first = offer.segments[0];
            const last = offer.segments[offer.segments.length - 1];
            return (
              <li
                key={`${first.carrier}${first.flightNumber}-${first.departAt}`}
                data-testid="flight-offer"
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="text-stone-700">
                  {first.carrier} {first.flightNumber}
                  <span className="text-stone-400">
                    {" "}
                    · {localTime(first.departAt)}–{localTime(last.arriveAt)} ·{" "}
                    {stopsLabel(offer.stops)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-stone-900">
                  {offer.price}{" "}
                  <span className="font-normal text-stone-500">{offer.currency}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
