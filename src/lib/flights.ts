import type { FlightOffer, FlightQuery, FlightSegment, TripPlan } from "./types";

// ---------------------------------------------------------------------------
// Pure flight logic: which flights a plan implies, and how to read Amadeus.
//
// LEARNING NOTE: Nothing in this file touches the network. Deriving queries
// from a plan and normalizing an API response are both plain data
// transformations, so they live here where Vitest can hammer them with
// fixtures. The fetch itself (OAuth, rate limits, retries) belongs to
// amadeus.ts — keeping the two apart means the tricky logic is testable
// without mocking a single HTTP call.
// ---------------------------------------------------------------------------

/** Three letters, either case — "lax" is a person typing, not an error. */
const IATA = /^[A-Za-z]{3}$/;

/**
 * Every flight a trip plan implies: home → first leg (if we know home),
 * each inter-leg transition, and last leg → home (again, if known).
 *
 * Dates follow the day-counting semantics from the trip splitter: a leg's
 * startDate IS its arrival/travel day, so that's the day to fly; the trip's
 * final day is the flight home.
 *
 * An invalid home airport is ignored rather than thrown — flights are an
 * optional enhancement, and a typo in an optional field shouldn't take the
 * inter-leg flights down with it.
 */
export function flightQueries(plan: TripPlan, homeAirport?: string): FlightQuery[] {
  const { legs } = plan;
  if (legs.length === 0) return [];

  const home =
    homeAirport && IATA.test(homeAirport) ? homeAirport.toUpperCase() : undefined;

  const queries: FlightQuery[] = [];

  if (home) {
    queries.push({
      origin: home,
      dest: legs[0].destination.iataCode,
      date: legs[0].startDate,
    });
  }

  for (let i = 0; i + 1 < legs.length; i++) {
    queries.push({
      origin: legs[i].destination.iataCode,
      dest: legs[i + 1].destination.iataCode,
      date: legs[i + 1].startDate,
    });
  }

  if (home) {
    const last = legs.at(-1)!;
    queries.push({
      origin: last.destination.iataCode,
      dest: home,
      date: last.endDate,
    });
  }

  return queries;
}

// --- Amadeus response normalization ----------------------------------------
// LEARNING NOTE: An external API's response is untrusted input, exactly like
// a form field. We type it as `unknown` and prove each field exists before
// touching it — a malformed offer is skipped, never thrown, because one bad
// entry in a list of three shouldn't blank the whole flight strip.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One Amadeus segment → our FlightSegment, or undefined if anything is off. */
function toSegment(raw: unknown): FlightSegment | undefined {
  if (!isRecord(raw)) return undefined;
  const departure = isRecord(raw.departure) ? raw.departure : undefined;
  const arrival = isRecord(raw.arrival) ? raw.arrival : undefined;

  const from = departure && asString(departure.iataCode);
  const departAt = departure && asString(departure.at);
  const to = arrival && asString(arrival.iataCode);
  const arriveAt = arrival && asString(arrival.at);
  const carrier = asString(raw.carrierCode);
  const flightNumber = asString(raw.number);

  if (!from || !to || !departAt || !arriveAt || !carrier || !flightNumber) {
    return undefined;
  }
  return { from, to, departAt, arriveAt, carrier, flightNumber };
}

/** One Amadeus offer → our FlightOffer, or undefined if malformed. */
function toOffer(raw: unknown): FlightOffer | undefined {
  if (!isRecord(raw)) return undefined;

  const price = isRecord(raw.price) ? raw.price : undefined;
  const grandTotal = price && asString(price.grandTotal);
  const currency = price && asString(price.currency);

  const itinerary =
    Array.isArray(raw.itineraries) && isRecord(raw.itineraries[0])
      ? raw.itineraries[0]
      : undefined;
  const duration = itinerary && asString(itinerary.duration);
  const rawSegments =
    itinerary && Array.isArray(itinerary.segments) ? itinerary.segments : undefined;

  if (!grandTotal || !currency || !duration || !rawSegments || rawSegments.length === 0) {
    return undefined;
  }

  const segments: FlightSegment[] = [];
  for (const rawSegment of rawSegments) {
    const segment = toSegment(rawSegment);
    if (!segment) return undefined; // a hole mid-journey makes the offer nonsense
    segments.push(segment);
  }

  return {
    price: grandTotal,
    currency,
    stops: segments.length - 1,
    duration,
    segments,
  };
}

/**
 * The raw Amadeus flight-offers-search response → clean `FlightOffer[]`.
 * Anything unrecognizable — wrong shape, missing fields — yields `[]` or
 * a shorter list, never an exception.
 */
export function normalizeOffers(apiJson: unknown): FlightOffer[] {
  if (!isRecord(apiJson) || !Array.isArray(apiJson.data)) return [];

  const offers: FlightOffer[] = [];
  for (const entry of apiJson.data) {
    const offer = toOffer(entry);
    if (offer) offers.push(offer);
  }
  return offers;
}
