# Wayfarer

[![CI](https://github.com/joshsake/wayfarer/actions/workflows/ci.yml/badge.svg)](https://github.com/joshsake/wayfarer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A travel-matching app: answer five questions about how you like to travel, get
three destinations scored against your answers — with the reasons why. It also
splits a multi-country trip: give it your dates, countries, and minimum stays,
and it allocates the days into an ordered itinerary — again with the reasons why.

**[▶ Try it live](https://wayfarer-xi.vercel.app)**

Built with Next.js 16 (App Router), Tailwind v4, Supabase, and Playwright.
Every push runs a production build and the Playwright suite in CI.

| Five questions in | Ranked matches out — with the why |
| --- | --- |
| ![Wayfarer home page](docs/home.png) | ![Results page: destinations scored with match reasons](docs/results.png) |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**The env step is not optional.** The app reads its Supabase connection details
from the environment and throws at startup if they're missing — deliberately,
so a misconfiguration fails immediately and obviously instead of rendering an
empty results page. See [.env.example](.env.example) for where each value
lives in the Supabase dashboard.

## How it fits together

```
src/app/plan       the five-question wizard (client component)
src/app/results    scores and renders matches (server component)
src/app/trip       the trip-splitter form (client component)
src/app/trip/results  runs the split and renders the legs (server component)
src/lib/types.ts   the domain types everything else agrees on
src/lib/matching.ts  rank() — pure scoring; recommend() — fetch + rank
src/lib/trip.ts    splitTrip() — pure day-allocation engine, no I/O
src/lib/destinations.ts  loads the catalog from Supabase, maps rows to types
src/lib/supabase.ts      the shared Supabase client
```

Two design choices worth knowing about:

**Data flows straight into the server component.** `/results` already runs on
the server, so it queries Supabase directly rather than calling an internal API
route. An API route would mean the server making an HTTP request to itself to
reach a database it can already talk to. Route handlers earn their place when a
*browser* or an external caller needs the data.

**The scoring algorithm is pure.** `rank(prefs, destinations)` takes the
catalog as an argument and does no I/O, so it can be unit-tested with a handful
of fake destinations. `recommend()` is the thin async wrapper that fetches real
data and delegates. Keeping I/O at the edges is what makes the interesting
logic testable.

## Database

The destination catalog lives in a Supabase Postgres table. Schema and seed
data live in [supabase/migrations/](supabase/migrations/), so the database is
reproducible rather than hand-edited. The first migration is a *retroactive
baseline* — the project started life in the Supabase dashboard, and that file
captures what existed so every later change has a recorded starting point. To
apply them to a fresh project, paste each file into the Supabase SQL editor in
order, or run `supabase db push` if you have the CLI linked to your project.

The `destinations` table has Row Level Security enabled with a
single policy: anyone may `SELECT`, nobody may write through the API. Writes
happen via migrations.

Score columns carry `CHECK (… between 0 and 100)` constraints — the TypeScript
type documents that range in a comment, but only the database can enforce it.

## Tests

Two runners, split by filename suffix so they never steal each other's files:
`*.test.ts` is Vitest, `*.spec.ts` is Playwright.

```bash
npm run test:unit      # Vitest — pure functions, no browser, milliseconds
```

The unit suite hammers the trip-splitting engine — feasibility math, day
allocation, ordering — which is exactly why `splitTrip()` does no I/O: pure
functions can be tested exhaustively without a database or a browser.

```bash
npm run build          # Playwright serves the production build
npx playwright test
```

Seven end-to-end specs cover the wizard flow, the back button, the
no-splurges path, that results are actually personalized, and the
trip splitter's happy and infeasible paths. Every selector is
a `data-testid` planted in the components, not a CSS path that breaks when a
class changes.

## Deployment

Vercel builds from the GitHub repo: every pull request gets a preview URL,
every merge to `main` ships to production. GitHub Actions is the quality gate
(build + E2E) and runs independently.

Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must
be set in **three** places: `.env.local` for local dev, GitHub repository
secrets for CI, and Vercel project environment variables for deploys.
