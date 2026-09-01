import Link from "next/link";
import { recommend } from "@/lib/matching";
import { parsePrefs } from "@/lib/prefs";

// ---------------------------------------------------------------------------
// The results page.
//
// LEARNING NOTE: This is a Server Component that reads the wizard answers
// from the URL. In Next.js 16, `searchParams` is a Promise — you must
// `await` it (a common gotcha if you learned from older tutorials).
// Scoring happens on the server; the browser receives finished HTML.
//
// Note how little changed when the catalog moved to Supabase: `recommend()`
// gained an `await`. That's it. Because this component already runs on the
// server, it queries the database directly — no internal API route, no extra
// network hop, and the credentials never enter the browser bundle.
//
// Progressive disclosure, no JavaScript required: the "essentials" view
// hides highlights behind a native <details> element. The browser does the
// toggling for free — accessible, testable, zero client code.
// ---------------------------------------------------------------------------

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Forward the wizard answers so the trip splitter can weight by them.
  const raw = await searchParams;
  const prefs = parsePrefs(raw);
  const passthrough = new URLSearchParams();
  for (const key of ["party", "vibe", "splurges", "transit", "detail"]) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) passthrough.set(key, value);
  }
  const recommendations = await recommend(prefs, 3);
  const showEverything = prefs.detail === "everything";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
        Wayfarer
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900">
        Your kind of trip.
      </h1>
      <p className="mt-3 text-stone-500">
        Matched to how you travel — not just where everyone else goes.
      </p>

      <div className="mt-10 flex flex-col gap-6">
        {recommendations.map((rec, index) => (
          <article
            key={rec.destination.id}
            data-testid="recommendation-card"
            className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-4xl">{rec.destination.emoji}</span>
                <div>
                  <h2 className="text-2xl font-semibold text-stone-900">
                    {rec.destination.name}
                    <span className="ml-2 text-base font-normal text-stone-400">
                      {rec.destination.country}
                    </span>
                  </h2>
                  <p className="text-stone-500">{rec.destination.tagline}</p>
                </div>
              </div>
              <div
                className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
                  index === 0
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-50 text-emerald-700"
                }`}
                title="How closely this matches your answers"
              >
                {rec.score}% match
              </div>
            </div>

            {/* Why it matched — the personalized part */}
            <ul className="mt-4 flex flex-wrap gap-2">
              {rec.reasons.map((reason) => (
                <li
                  key={reason}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-sm text-stone-700"
                >
                  {reason}
                </li>
              ))}
            </ul>

            {/* Progressive disclosure: open by default only if they asked */}
            <details className="mt-4 group" open={showEverything}>
              <summary className="cursor-pointer list-none text-sm font-medium text-emerald-700 hover:text-emerald-800">
                <span className="group-open:hidden">
                  If you want the details →
                </span>
                <span className="hidden group-open:inline">
                  The details ↓
                </span>
              </summary>
              <ul className="mt-3 space-y-2 border-l-2 border-emerald-100 pl-4 text-sm text-stone-600">
                {rec.destination.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
                <li className="text-stone-400">
                  Rough budget: ~${rec.destination.dailyCost}/day per person
                </li>
              </ul>
            </details>
          </article>
        ))}
      </div>

      <div className="mt-10 flex items-center gap-6">
        <Link
          href="/plan"
          className="rounded-full border border-stone-300 px-6 py-3 font-medium text-stone-700 transition-colors hover:bg-stone-50"
        >
          ← Adjust my answers
        </Link>
        <Link
          href={`/trip?${passthrough.toString()}`}
          data-testid="results-to-trip"
          className="rounded-full border border-stone-300 px-6 py-3 font-medium text-stone-700 transition-colors hover:bg-stone-50"
        >
          Split a real trip&apos;s days →
        </Link>
        <p className="text-sm text-stone-400">
          Not quite right? Two clicks to retune.
        </p>
      </div>
    </main>
  );
}
