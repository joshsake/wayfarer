import Link from "next/link";
import { planTrip } from "@/lib/trip";
import { parsePrefs } from "@/lib/prefs";
import type { TripConstraints } from "@/lib/types";

// ---------------------------------------------------------------------------
// The trip plan, rendered. Server Component, same shape as /results: parse
// the URL, call the engine, render finished HTML. An infeasible trip is a
// first-class outcome here — it renders the arithmetic of why it doesn't
// fit, because "error: invalid input" teaches the user nothing.
// ---------------------------------------------------------------------------

/** Parse trip params. Returns null when required params are absent/mangled —
 *  the page then shows a "start over" prompt instead of guessing. */
function parseConstraints(params: {
  [key: string]: string | string[] | undefined;
}): TripConstraints | null {
  const start = params["start"];
  const end = params["end"];
  const countriesRaw = params["countries"];
  if (typeof start !== "string" || typeof end !== "string" || typeof countriesRaw !== "string") {
    return null;
  }
  const countries = countriesRaw
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [country, min] = pair.split(":");
      return { country, minFullDays: Math.max(0, Math.floor(Number(min) || 0)) };
    });
  const first = params["first"];
  return {
    startDate: start,
    endDate: end,
    countries,
    ...(typeof first === "string" && first.length > 0 ? { firstCountry: first } : {}),
  };
}

/** "2026-11-13" → "Nov 13" (UTC-pinned; see the trip module's date notes). */
function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TripResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const constraints = parseConstraints(params);
  const prefs = parsePrefs(params);
  const result = constraints ? await planTrip(constraints, prefs) : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
        Wayfarer
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900">
        Your days, split.
      </h1>

      {result === null && (
        <p className="mt-6 text-stone-600" data-testid="trip-error">
          This link is missing its trip details.{" "}
          <Link href="/trip" className="font-medium text-emerald-700 hover:text-emerald-800">
            Start a new trip →
          </Link>
        </p>
      )}

      {result && !result.ok && (
        <div
          className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6"
          data-testid="trip-error"
        >
          <h2 className="font-semibold text-amber-900">That doesn&apos;t quite fit.</h2>
          <p className="mt-2 text-amber-800">{result.error.message}</p>
          <Link
            href="/trip"
            className="mt-4 inline-block rounded-full border border-amber-300 px-5 py-2.5 font-medium text-amber-900 hover:bg-amber-100"
          >
            ← Adjust the trip
          </Link>
        </div>
      )}

      {result?.ok && (
        <>
          <p className="mt-3 text-stone-500">
            {result.plan.totalDays} days, {result.plan.legs.length} countries
            {result.plan.spareDays > 0 &&
              ` — ${result.plan.spareDays} flexible ${
                result.plan.spareDays === 1 ? "day" : "days"
              } placed where you match best`}
            .
          </p>

          <ol className="mt-10 flex flex-col gap-6">
            {result.plan.legs.map((leg, index) => (
              <li
                key={leg.country}
                data-testid="trip-leg"
                className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">{leg.destination.emoji}</span>
                    <div>
                      <p className="text-sm font-medium uppercase tracking-wide text-stone-400">
                        Stop {index + 1} · {shortDate(leg.startDate)} – {shortDate(leg.endDate)}
                      </p>
                      <h2 className="text-2xl font-semibold text-stone-900">
                        {leg.country}
                        <span className="ml-2 text-base font-normal text-stone-400">
                          via {leg.destination.name}
                        </span>
                      </h2>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                    {leg.matchScore}% match
                  </div>
                </div>

                <p className="mt-4 text-stone-700" data-testid="trip-leg-days">
                  <span className="font-semibold">{leg.fullDays} full days</span>
                  <span className="text-stone-500">
                    {" "}
                    + {leg.travelDays === 2 ? "arrival & flight home" : "arrival day"}
                    {leg.spareDays > 0 &&
                      ` · includes ${leg.spareDays} flexible ${
                        leg.spareDays === 1 ? "day" : "days"
                      }`}
                  </span>
                </p>

                {leg.reasons.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {leg.reasons.map((reason) => (
                      <li
                        key={reason}
                        className="rounded-full bg-stone-100 px-3 py-1.5 text-sm text-stone-700"
                      >
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-10 flex items-center gap-6">
            <Link
              href="/trip"
              className="rounded-full border border-stone-300 px-6 py-3 font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              ← Adjust the trip
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
