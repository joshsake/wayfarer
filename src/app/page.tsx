import Link from "next/link";

// ---------------------------------------------------------------------------
// The landing page.
//
// LEARNING NOTE: No "use client" here — this is a Server Component. It has
// zero interactivity (just a link), so it renders to plain HTML on the
// server and ships almost no JavaScript. Fast by default.
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="mb-4 text-sm font-medium uppercase tracking-widest text-emerald-700">
        Wayfarer
      </p>
      <h1 className="text-5xl font-semibold tracking-tight text-stone-900 sm:text-6xl">
        Trips that fit <em className="not-italic text-emerald-700">you</em>,
        not the crowd.
      </h1>
      <p className="mt-6 max-w-md text-lg text-stone-500">
        Answer five quick questions — no forms, no overwhelm — and get
        destinations matched to how you actually like to travel.
      </p>
      <Link
        href="/plan"
        data-testid="start-wizard"
        className="mt-10 rounded-full bg-stone-900 px-10 py-4 text-lg font-medium text-white transition-colors hover:bg-stone-700"
      >
        Find my trip →
      </Link>
      <p className="mt-4 text-sm text-stone-400">
        Takes about 30 seconds. Really.
      </p>
    </main>
  );
}
