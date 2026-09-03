import type { FlightOffer, FlightQuery, FlightSegment, TripPlan } from "./types";

// ---------------------------------------------------------------------------
// Pure flight logic: which flights a plan implies, and how to read Duffel.
//
// LEARNING NOTE: Nothing in this file touches the network. Deriving queries
// from a plan and normalizing an API response are both plain data
// transformations, so they live here where Vitest can hammer them with
// fixtures. The fetch itself (auth header, timeouts, status codes) belongs
// to duffel.ts — keeping the two apart means the tricky logic is testable
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
 *
 * LEARNING NOTE: A query whose origin equals its destination (home is the
 * first leg's own airport — you live in Kyoto and the trip starts there) is
 * never emitted. No airline sells KIX→KIX: at best the provider returns
 * nothing, at worst a 4xx, and either way it's a request spent for nothing,
 * so the guard lives here at the source rather than in every caller.
 */
export function flightQueries(plan: TripPlan, homeAirport?: string): FlightQuery[] {
  const { legs } = plan;
  if (legs.length === 0) return [];

  const home =
    homeAirport && IATA.test(homeAirport) ? homeAirport.toUpperCase() : undefined;

  const queries: FlightQuery[] = [];

  if (home && home !== legs[0].destination.iataCode) {
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

  const last = legs.at(-1)!;
  if (home && home !== last.destination.iataCode) {
    queries.push({
      origin: last.destination.iataCode,
      dest: home,
      date: last.endDate,
    });
  }

  return queries;
}

// --- Duffel response normalization -----------------------------------------
// LEARNING NOTE: An external API's response is untrusted input, exactly like
// a form field. We type it as `unknown` and prove each field exists before
// touching it — a malformed offer is skipped, never thrown, because one bad
// entry in a list shouldn't blank the whole flight strip.
//
// LEARNING NOTE: This section is the ONLY code in the app that knows Duffel's
// field names. When the provider changed from Amadeus (September 2026), the
// functions below were rewritten field-for-field — `price.grandTotal` became
// `total_amount`, `itineraries[0]` became `slices[0]`, `departure.at` became
// `departing_at` — and every consumer of FlightOffer carried on unchanged.
// That is the payoff of normalizing at the boundary instead of letting the
// raw API shape leak into components.

/** How many offers a flight strip shows. Duffel returns far more. */
const MAX_OFFERS = 3;

/** A fare as Duffel quotes it: digits, optionally a dot and more digits. */
const PRICE = /^\d+(\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One Duffel segment → our FlightSegment, or undefined if anything is off. */
function toSegment(raw: unknown): FlightSegment | undefined {
  if (!isRecord(raw)) return undefined;
  const origin = isRecord(raw.origin) ? raw.origin : undefined;
  const destination = isRecord(raw.destination) ? raw.destination : undefined;
  const marketingCarrier = isRecord(raw.marketing_carrier) ? raw.marketing_carrier : undefined;

  const from = origin && asString(origin.iata_code);
  const to = destination && asString(destination.iata_code);
  const departAt = asString(raw.departing_at);
  const arriveAt = asString(raw.arriving_at);
  const carrier = marketingCarrier && asString(marketingCarrier.iata_code);
  const flightNumber = asString(raw.marketing_carrier_flight_number);

  if (!from || !to || !departAt || !arriveAt || !carrier || !flightNumber) {
    return undefined;
  }
  return { from, to, departAt, arriveAt, carrier, flightNumber };
}

/** One Duffel offer → our FlightOffer, or undefined if malformed. */
function toOffer(raw: unknown): FlightOffer | undefined {
  if (!isRecord(raw)) return undefined;

  // Trimmed, so a stray space can neither reach the UI nor dodge the check.
  const price = asString(raw.total_amount)?.trim();
  const currency = asString(raw.total_currency);

  // We ask for one slice (one-way), so slices[0] is the whole journey.
  const slice = Array.isArray(raw.slices) && isRecord(raw.slices[0]) ? raw.slices[0] : undefined;
  const duration = slice && asString(slice.duration);
  const rawSegments = slice && Array.isArray(slice.segments) ? slice.segments : undefined;

  if (!price || !currency || !duration || !rawSegments || rawSegments.length === 0) {
    return undefined;
  }
  // A strict shape check, not Number(): Number("  ") is 0, Number("1e3") is
  // 1000 and Number("-5.00") is -5 — all finite, none a fare. And a price we
  // can't rank would poison the sort below (NaN compares as neither less
  // nor greater than anything), so the offer goes.
  if (!PRICE.test(price)) return undefined;

  const segments: FlightSegment[] = [];
  for (const rawSegment of rawSegments) {
    const segment = toSegment(rawSegment);
    if (!segment) return undefined; // a hole mid-journey makes the offer nonsense
    segments.push(segment);
  }

  return {
    price,
    currency,
    stops: segments.length - 1,
    duration,
    segments,
  };
}

/**
 * The raw Duffel offer-request response (`{ data: { offers: [...] } }`) →
 * the cheapest `MAX_OFFERS` as clean `FlightOffer[]`, ascending by price.
 * Anything unrecognizable — wrong shape, missing fields — yields `[]` or
 * a shorter list, never an exception.
 *
 * LEARNING NOTE: `total_amount` is a string ("412.60"), kept as one so the
 * UI shows exactly what the API quoted — but strings sort character by
 * character ("1000.00" < "95.00"), so the comparator converts with Number()
 * first. Array.prototype.sort is stable, so equal prices keep Duffel's order.
 */
export function normalizeOffers(apiJson: unknown): FlightOffer[] {
  if (!isRecord(apiJson) || !isRecord(apiJson.data) || !Array.isArray(apiJson.data.offers)) {
    return [];
  }

  const offers: FlightOffer[] = [];
  for (const entry of apiJson.data.offers) {
    const offer = toOffer(entry);
    if (offer) offers.push(offer);
  }
  return offers
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, MAX_OFFERS);
}

/**
 * A React `key` for an offer: every segment's carrier + flight number +
 * departure time joined by "|", then "-" and the price.
 *
 * LEARNING NOTE: React uses `key` to match list items across renders, and
 * two siblings with the same key get folded into one DOM node — an offer
 * silently disappears. The first segment alone isn't unique: Duffel returns
 * one offer PER FARE BRAND, so the same physical KE 724 shows up twice at
 * different prices ("Basic" and "Standard"). Itinerary plus price is what
 * actually makes an offer distinct, so that's the key. It lives here rather
 * than in FlightStrip so the collision case is provable in Vitest without
 * rendering anything.
 */
export function offerKey(offer: FlightOffer): string {
  return (
    offer.segments.map((s) => s.carrier + s.flightNumber + s.departAt).join("|") +
    "-" +
    offer.price
  );
}
