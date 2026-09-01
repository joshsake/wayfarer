"use client";

// ---------------------------------------------------------------------------
// The trip form. Unlike the wizard (one question per screen), this is a
// single screen: dates, countries, minimums, pin. It's a request you compose,
// not a conversation — different interaction, different layout.
//
// State lands in the URL on submit, same as the wizard: shareable,
// refresh-proof, and the server component on the other end stays stateless.
// Encoding: countries=Japan:8,Singapore:2 — "name:minFullDays" pairs.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CountryChoice {
  included: boolean;
  /** Kept as the raw typed string so the field can be cleared mid-edit;
   *  coerced to a whole number (empty → 0) only at submit time. */
  minFullDays: string;
}

/** "":"" → 0, "2.9" → 2, "-1" → 0 — the same flooring the results page applies. */
function coerceMin(raw: string): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export default function TripForm({
  countries,
  prefs,
}: {
  countries: string[];
  prefs: Record<string, string>;
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [choices, setChoices] = useState<Record<string, CountryChoice>>(
    Object.fromEntries(countries.map((c) => [c, { included: false, minFullDays: "2" }])),
  );
  const [firstCountry, setFirstCountry] = useState("");

  const included = countries.filter((c) => choices[c].included);
  const canSubmit = startDate !== "" && endDate !== "" && included.length > 0;

  function toggle(country: string) {
    const next = { ...choices, [country]: { ...choices[country], included: !choices[country].included } };
    setChoices(next);
    // Un-including the pinned country clears the pin.
    if (!next[country].included && firstCountry === country) setFirstCountry("");
  }

  function setMin(country: string, raw: string) {
    // Store what was typed — snapping to a number here would make the field
    // impossible to clear and retype. Coercion happens in submit().
    setChoices({ ...choices, [country]: { ...choices[country], minFullDays: raw } });
  }

  function submit() {
    const params = new URLSearchParams(prefs);
    params.set("start", startDate);
    params.set("end", endDate);
    params.set("countries", included.map((c) => `${c}:${coerceMin(choices[c].minFullDays)}`).join(","));
    if (firstCountry) params.set("first", firstCountry);
    router.push(`/trip/results?${params.toString()}`);
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-14">
      <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
        Wayfarer
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900">
        Split your days.
      </h1>
      <p className="mt-3 text-stone-500">
        You know where you&apos;re going — we&apos;ll work out how long to stay in each place.
      </p>

      <section className="mt-10">
        <h2 className="font-medium text-stone-900">When?</h2>
        <div className="mt-3 flex gap-4">
          <label className="flex-1 text-sm text-stone-500">
            First day
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-testid="trip-start"
              className="mt-1 w-full rounded-xl border-2 border-stone-200 bg-white p-3 text-stone-900"
            />
          </label>
          <label className="flex-1 text-sm text-stone-500">
            Last day
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              data-testid="trip-end"
              className="mt-1 w-full rounded-xl border-2 border-stone-200 bg-white p-3 text-stone-900"
            />
          </label>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-stone-900">Where?</h2>
        <p className="text-sm text-stone-500">
          Pick your countries, and set the fewest full days you&apos;d accept in each.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {countries.map((country) => (
            <div
              key={country}
              className={`flex items-center justify-between rounded-2xl border-2 p-3 transition-colors ${
                choices[country].included
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-stone-200 bg-white"
              }`}
            >
              <label className="flex flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={choices[country].included}
                  onChange={() => toggle(country)}
                  data-testid={`trip-country-${country}`}
                  className="h-5 w-5 accent-emerald-600"
                />
                <span className="font-medium text-stone-900">{country}</span>
              </label>
              {choices[country].included && (
                <label className="flex items-center gap-2 text-sm text-stone-500">
                  at least
                  <input
                    type="number"
                    min={0}
                    value={choices[country].minFullDays}
                    onChange={(e) => setMin(country, e.target.value)}
                    data-testid={`trip-min-${country}`}
                    className="w-16 rounded-lg border-2 border-stone-200 bg-white p-2 text-center text-stone-900"
                  />
                  full days
                </label>
              )}
            </div>
          ))}
        </div>
      </section>

      {included.length > 1 && (
        <section className="mt-8">
          <h2 className="font-medium text-stone-900">Anywhere first?</h2>
          <select
            value={firstCountry}
            onChange={(e) => setFirstCountry(e.target.value)}
            aria-label="Which country to start in"
            data-testid="trip-first"
            className="mt-3 w-full rounded-xl border-2 border-stone-200 bg-white p-3 text-stone-900"
          >
            <option value="">No preference — route it for me</option>
            {included.map((country) => (
              <option key={country} value={country}>
                Start in {country}
              </option>
            ))}
          </select>
        </section>
      )}

      <button
        onClick={submit}
        disabled={!canSubmit}
        data-testid="trip-submit"
        className="mt-10 w-full rounded-full bg-stone-900 px-8 py-3.5 font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        Split my days
      </button>
    </main>
  );
}
