# Trip Splitter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Given a date range, countries, ordering pins, and per-country minimum full days, produce an ordered trip plan with days allocated per country — preference-weighted via the existing `rank()` scores.

**Architecture:** Pure `splitTrip()` in `src/lib/trip.ts` mirroring the `rank()`/`recommend()` split (I/O at the edges); a thin async `planTrip()` wrapper; `/trip` client form → `/trip/results` server component via query params (same pattern as wizard → `/results`). Committed SQL migrations add lat/lng + a Singapore row to the Supabase catalog.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Supabase (Postgres + RLS), Vitest (new), Playwright.

**Design doc:** `docs/plans/2026-09-01-trip-splitter-design.md` (approved). Day-counting semantics, allocation rules, and scope decisions live there — read it first.

**Conventions in this repo:**
- Unit tests (new): `tests/unit/*.test.ts` run by Vitest. E2E: `tests/*.spec.ts` run by Playwright. The suffixes are load-bearing (Task 1 pins Playwright's `testMatch`).
- `@/` path alias → `src/` (see `tsconfig.json`).
- Files carry `LEARNING NOTE` comments explaining the *why* — keep that voice when adding code.
- Never bare `git stash` (shared stack across worktrees).

---

### Task 1: Vitest setup + test/spec separation

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/smoke.test.ts` (deleted again in Task 2)
- Modify: `package.json` (scripts + devDependency)
- Modify: `playwright.config.ts:19` (add `testMatch`)
- Modify: `.github/workflows/ci.yml` (unit-test step)

**Step 1: Install Vitest**

```bash
npm install -D vitest
```

**Step 2: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ---------------------------------------------------------------------------
// Vitest config — unit tests only.
//
// LEARNING NOTE: Two test runners, split by filename suffix:
//   *.test.ts  → Vitest   (pure functions, no browser, milliseconds)
//   *.spec.ts  → Playwright (real browser against the built app)
// playwright.config.ts pins testMatch to *.spec.ts so the runners never
// steal each other's files.
//
// The env block exists because src/lib/supabase.ts deliberately throws at
// import time when the Supabase env vars are missing. Unit tests import the
// matching engine (which transitively imports that module) but never open a
// connection — dummy values satisfy the startup check without touching the
// network. If a unit test ever actually queries, it fails loudly on this
// invalid URL, which is exactly what we want.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://unit-tests-never-connect.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "unit-test-dummy-key",
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

**Step 3: Pin Playwright to `*.spec.ts`**

In `playwright.config.ts`, inside `defineConfig({`, directly under `testDir: "./tests",` add:

```ts
  // Vitest owns *.test.ts (see vitest.config.ts); Playwright owns *.spec.ts.
  testMatch: "**/*.spec.ts",
```

**Step 4: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "test:unit": "vitest run"
```

**Step 5: Write a smoke test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest wiring", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 6: Verify both runners see the right files**

Run: `npm run test:unit`
Expected: 1 passed.

Run: `npx playwright test --list`
Expected: only the five wizard specs from `tests/wizard.spec.ts` — `smoke.test.ts` must NOT appear.

**Step 7: Add CI step**

In `.github/workflows/ci.yml`, after the `Install Playwright browsers` step and before `Build`, add:

```yaml
      - name: Run unit tests
        run: npm run test:unit
```

**Step 8: Commit**

```bash
git add vitest.config.ts tests/unit/smoke.test.ts package.json package-lock.json playwright.config.ts .github/workflows/ci.yml
git commit -m "Add Vitest for unit tests, split runners by filename suffix"
```

---

### Task 2: Date helpers (TDD starts here)

**Files:**
- Create: `tests/unit/trip.test.ts`
- Create: `src/lib/trip.ts`
- Delete: `tests/unit/smoke.test.ts`

**Step 1: Write failing tests**

`tests/unit/trip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countDays } from "@/lib/trip";

describe("countDays", () => {
  it("counts an inclusive range", () => {
    // The motivating trip: Nov 13–29 is 17 calendar days.
    expect(countDays("2026-11-13", "2026-11-29")).toBe(17);
  });

  it("counts a single day as 1", () => {
    expect(countDays("2026-11-13", "2026-11-13")).toBe(1);
  });

  it("crosses a month boundary", () => {
    expect(countDays("2026-11-28", "2026-12-02")).toBe(5);
  });

  it("rejects end before start", () => {
    expect(countDays("2026-11-29", "2026-11-13")).toBeNull();
  });

  it("rejects malformed dates", () => {
    expect(countDays("13/11/2026", "2026-11-29")).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(countDays("2026-02-30", "2026-03-05")).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `@/lib/trip`.

**Step 3: Implement**

`src/lib/trip.ts`:

```ts
// ---------------------------------------------------------------------------
// The trip splitter — date math foundation.
//
// LEARNING NOTE: All date arithmetic here is UTC-midnight timestamps
// (numbers), never local `new Date(...)`. Local time has DST jumps where a
// "day" is 23 or 25 hours; UTC days are always exactly 86,400,000 ms, which
// makes day counting plain integer math. Dates cross the API boundary as
// "YYYY-MM-DD" strings and only become numbers inside this module.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" into a UTC-midnight timestamp, or null if invalid. */
function parseDay(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ts = Date.UTC(year, month - 1, day);
  // Date.UTC silently rolls over impossible dates (Feb 30 → Mar 2).
  // Round-trip the result to catch that.
  const roundTrip = new Date(ts);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return null;
  }
  return ts;
}

/** Format a UTC-midnight timestamp back to "YYYY-MM-DD". */
function formatDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Inclusive day count of a date range, or null if the range is invalid. */
export function countDays(startDate: string, endDate: string): number | null {
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  if (start === null || end === null || end < start) return null;
  return (end - start) / DAY_MS + 1;
}
```

(`parseDay`/`formatDay`/`DAY_MS` stay module-private; later tasks in this same file use them.)

**Step 4: Run to verify pass**

Run: `npm run test:unit`
Expected: 6 passed.

**Step 5: Delete the smoke test and commit**

```bash
git rm tests/unit/smoke.test.ts
git add tests/unit/trip.test.ts src/lib/trip.ts
git commit -m "Add UTC-safe date helpers for the trip splitter"
```

---

### Task 3: Haversine distance

**Files:**
- Modify: `tests/unit/trip.test.ts`
- Modify: `src/lib/trip.ts`

**Step 1: Write failing tests** (append to `tests/unit/trip.test.ts`; add `distanceKm` to the import)

```ts
describe("distanceKm", () => {
  const kyoto = { lat: 35.0116, lng: 135.7681 };
  const seoul = { lat: 37.5665, lng: 126.978 };
  const singapore = { lat: 1.3521, lng: 103.8198 };

  it("is zero for the same point", () => {
    expect(distanceKm(kyoto, kyoto)).toBe(0);
  });

  it("is symmetric", () => {
    expect(distanceKm(kyoto, seoul)).toBeCloseTo(distanceKm(seoul, kyoto), 6);
  });

  it("matches known city distances within tolerance", () => {
    // Great-circle references: Kyoto–Seoul ≈ 830 km, Kyoto–Singapore ≈ 4,950 km.
    expect(distanceKm(kyoto, seoul)).toBeGreaterThan(750);
    expect(distanceKm(kyoto, seoul)).toBeLessThan(900);
    expect(distanceKm(kyoto, singapore)).toBeGreaterThan(4700);
    expect(distanceKm(kyoto, singapore)).toBeLessThan(5200);
  });
});
```

**Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — `distanceKm` is not exported.

**Step 3: Implement** (append to `src/lib/trip.ts`)

```ts
/** A point on the globe, in decimal degrees. */
interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance between two points, in kilometers (haversine).
 *
 * LEARNING NOTE: We only ever *compare* route lengths, so any monotonic
 * distance would do — but haversine is the standard, cheap, and easy to
 * sanity-check against real city pairs in tests.
 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const EARTH_RADIUS_KM = 6371;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
```

**Step 4: Run to verify pass**

Run: `npm run test:unit`
Expected: all passed.

**Step 5: Commit**

```bash
git add tests/unit/trip.test.ts src/lib/trip.ts
git commit -m "Add haversine distance for route ordering"
```

---

### Task 4: Migrations — baseline + lat/lng + Singapore

**Precondition:** the Supabase project must be live (it was unpaused 2026-09-01; restore takes minutes). Verify first:

```bash
node --env-file=.env.local -e "fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/destinations?select=id', { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }).then(r => r.text()).then(console.log)"
```

Expected: a JSON array of ids. If you get a Cloudflare 521 page, the restore isn't done — wait and retry.

**Files:**
- Create: `scripts/generate-baseline-seed.mjs`
- Create: `supabase/migrations/20260720000000_baseline.sql`
- Create: `supabase/migrations/20260901000000_trip_splitter.sql`

(Timestamped names follow the Supabase CLI convention so `supabase db push` works if the project is ever linked to the CLI.)

**Step 1: Dump the live catalog to generate the baseline seed**

`scripts/generate-baseline-seed.mjs`:

```js
// One-shot: dumps the live destinations table as INSERT statements for the
// retroactive baseline migration. Run: node --env-file=.env.local scripts/generate-baseline-seed.mjs
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const res = await fetch(`${url}/rest/v1/destinations?select=*&order=id`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const rows = await res.json();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const cols = [
  "id", "name", "country", "tagline", "emoji", "local_culture",
  "classic_sights", "hotel_quality", "food_scene", "experiences",
  "transit_quality", "family_friendly", "walkability", "daily_cost", "highlights",
];
for (const row of rows) {
  const vals = cols.map((c) =>
    c === "highlights"
      ? `array[${row[c].map(q).join(", ")}]`
      : typeof row[c] === "number" ? row[c] : q(row[c]),
  );
  console.log(`insert into public.destinations (${cols.join(", ")})\nvalues (${vals.join(", ")})\non conflict (id) do nothing;\n`);
}
```

Run: `node --env-file=.env.local scripts/generate-baseline-seed.mjs > /tmp/seed.sql` — then inspect it. Expected: ~10 INSERTs (kyoto, lisbon, mexico-city, copenhagen, rome, seoul, oaxaca, london, hoi-an, vienna).

*Fallback if the DB is somehow empty:* the same rows exist in git history — `git show 6e5a7c2~1:src/lib/destinations.ts` — convert the mock array by hand.

**Step 2: Write the baseline migration**

`supabase/migrations/20260720000000_baseline.sql` — header comment, then schema, then paste the generated INSERTs:

```sql
-- ---------------------------------------------------------------------------
-- RETROACTIVE BASELINE. This schema was originally applied via the Supabase
-- dashboard on 2026-07-20 and never committed — this file reconstructs it so
-- the README's claim ("the database is reproducible from migrations") is
-- actually true. Idempotent by design: safe to run against the live project
-- (IF NOT EXISTS / ON CONFLICT DO NOTHING throughout).
-- ---------------------------------------------------------------------------

create table if not exists public.destinations (
  id text primary key,
  name text not null,
  country text not null,
  tagline text not null,
  emoji text not null,
  local_culture integer not null check (local_culture between 0 and 100),
  classic_sights integer not null check (classic_sights between 0 and 100),
  hotel_quality integer not null check (hotel_quality between 0 and 100),
  food_scene integer not null check (food_scene between 0 and 100),
  experiences integer not null check (experiences between 0 and 100),
  transit_quality integer not null check (transit_quality between 0 and 100),
  family_friendly integer not null check (family_friendly between 0 and 100),
  walkability integer not null check (walkability between 0 and 100),
  daily_cost integer not null,
  highlights text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.destinations enable row level security;

-- Guarded by "any SELECT policy exists", not by policy name — the original
-- was created in the dashboard and its exact name isn't recorded anywhere.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'destinations' and cmd = 'SELECT'
  ) then
    create policy "public read" on public.destinations for select using (true);
  end if;
end $$;

-- Seed (generated from the live table by scripts/generate-baseline-seed.mjs):
-- << paste the generated INSERTs here >>
```

**Step 3: Write the trip-splitter migration**

`supabase/migrations/20260901000000_trip_splitter.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Trip splitter: coordinates for route ordering + Singapore.
-- The final SET NOT NULL fails loudly if any row was missed a coordinate —
-- deliberate: a silent null would surface later as NaN distances.
-- ---------------------------------------------------------------------------

alter table public.destinations
  add column if not exists lat double precision,
  add column if not exists lng double precision;

update public.destinations set lat = 35.0116,  lng = 135.7681 where id = 'kyoto';
update public.destinations set lat = 38.7223,  lng = -9.1393  where id = 'lisbon';
update public.destinations set lat = 19.4326,  lng = -99.1332 where id = 'mexico-city';
update public.destinations set lat = 55.6761,  lng = 12.5683  where id = 'copenhagen';
update public.destinations set lat = 41.9028,  lng = 12.4964  where id = 'rome';
update public.destinations set lat = 37.5665,  lng = 126.9780 where id = 'seoul';
update public.destinations set lat = 17.0732,  lng = -96.7266 where id = 'oaxaca';
update public.destinations set lat = 51.5074,  lng = -0.1278  where id = 'london';
update public.destinations set lat = 15.8801,  lng = 108.3380 where id = 'hoi-an';
update public.destinations set lat = 48.2082,  lng = 16.3738  where id = 'vienna';

insert into public.destinations
  (id, name, country, tagline, emoji,
   local_culture, classic_sights, hotel_quality, food_scene, experiences,
   transit_quality, family_friendly, walkability, daily_cost, highlights, lat, lng)
values
  ('singapore', 'Singapore', 'Singapore',
   'Hawker stalls to sky gardens in one spotless city', '🦁',
   62, 78, 95, 96, 82, 98, 92, 74, 190,
   array[
     'Eat across Maxwell and Lau Pa Sat hawker centres',
     'Gardens by the Bay light show at dusk',
     'Kampong Glam, Little India and Katong shophouses',
     'A day on Sentosa or the Southern Ridges walk'
   ],
   1.3521, 103.8198)
on conflict (id) do nothing;

alter table public.destinations
  alter column lat set not null,
  alter column lng set not null;
```

If Step 1's dump revealed rows beyond the ten listed above, add UPDATE lines for them before the SET NOT NULL.

**Step 4: Apply both migrations**

The publishable key cannot run DDL (by design). Apply via the Supabase dashboard: SQL Editor → paste `20260720000000_baseline.sql` → Run → expect "Success". Repeat for `20260901000000_trip_splitter.sql`. This is a user step — pause and ask Josh to run them, or walk him through it.

**Step 5: Verify against the live database**

```bash
node --env-file=.env.local -e "fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/destinations?select=id,country,lat,lng', { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }).then(r => r.json()).then(rows => { console.log(rows.length, 'rows'); console.log(rows.filter(r => r.lat == null).length, 'missing coords'); console.log(rows.some(r => r.id === 'singapore') ? 'singapore: yes' : 'singapore: MISSING'); })"
```

Expected: `11 rows`, `0 missing coords`, `singapore: yes`.

**Step 6: Commit**

```bash
git add supabase/migrations scripts/generate-baseline-seed.mjs
git commit -m "Add committed migrations: retroactive baseline + coordinates + Singapore"
```

---

### Task 5: Types + row mapping for lat/lng

**Files:**
- Modify: `src/lib/types.ts` (Destination + trip types)
- Modify: `src/lib/destinations.ts` (row shape, mapping, select list)

**Step 1: Extend `Destination`** — in `src/lib/types.ts`, after the `dailyCost` field:

```ts
  /** City coordinates, used to order multi-country trips by flight distance. */
  lat: number;
  lng: number;
```

**Step 2: Add trip domain types** — append to `src/lib/types.ts`:

```ts
// --- Trip splitter ---------------------------------------------------------
// Day-counting semantics (see docs/plans/2026-09-01-trip-splitter-design.md):
// every leg's first day is a travel day (arrival) and doesn't count as
// "full"; the trip's final day is the flight home. So a leg's full days =
// allocated days − 1, and the final leg's = allocated days − 2.

/** One country in the trip request, with its minimum full days. */
export interface CountryConstraint {
  country: string;
  minFullDays: number;
}

/** The trip request: an inclusive date range plus country constraints. */
export interface TripConstraints {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; //   "YYYY-MM-DD", inclusive
  countries: CountryConstraint[];
  /** Optional: this country must be the first leg. */
  firstCountry?: string;
}

/** One leg of a computed plan, with concrete dates. */
export interface TripLeg {
  country: string;
  /** The country's best-matching destination for these preferences. */
  destination: Destination;
  startDate: string;
  endDate: string; // inclusive
  fullDays: number;
  travelDays: number; // 1, or 2 on the final leg (arrival + flight home)
  spareDays: number; // how many beyond-minimum days this leg received
  matchScore: number;
  reasons: string[];
}

export interface TripPlan {
  legs: TripLeg[];
  totalDays: number;
  spareDays: number;
}

export interface TripError {
  code: "bad-dates" | "unknown-country" | "does-not-fit";
  message: string; // ready to render — explains the arithmetic, not just "invalid"
}

/** Result union: infeasible trips are data, not exceptions — the UI explains them. */
export type TripResult =
  | { ok: true; plan: TripPlan }
  | { ok: false; error: TripError };
```

**Step 3: Map the new columns** — in `src/lib/destinations.ts`:
- `DestinationRow`: add `lat: number;` and `lng: number;` after `daily_cost`.
- `toDestination()`: add `lat: row.lat,` and `lng: row.lng,` after `dailyCost`.
- The `.select("…")` string literal: append `, lat, lng` before the closing quote (it must stay one literal — see the NOTE above it).

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Unit-test fixtures don't exist yet for the new fields — that's next task.)

**Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/destinations.ts
git commit -m "Add coordinates to Destination and the trip domain types"
```

---

### Task 6: `splitTrip` — validation

**Files:**
- Modify: `tests/unit/trip.test.ts`
- Modify: `src/lib/trip.ts`

**Step 1: Add the shared test fixtures** — near the top of `tests/unit/trip.test.ts`:

```ts
import type { Destination, Preferences, TripConstraints } from "@/lib/types";
import { countDays, distanceKm, splitTrip } from "@/lib/trip";

/** Minimal valid destination; override what the test cares about. */
function makeDest(
  overrides: Partial<Destination> &
    Pick<Destination, "id" | "name" | "country" | "lat" | "lng">,
): Destination {
  return {
    tagline: "",
    emoji: "📍",
    scores: {
      localCulture: 50,
      classicSights: 50,
      hotelQuality: 50,
      foodScene: 50,
      experiences: 50,
      transitQuality: 50,
      familyFriendly: 50,
      walkability: 50,
    },
    dailyCost: 150,
    highlights: [],
    ...overrides,
  };
}

const KYOTO = makeDest({ id: "kyoto", name: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 });
const SEOUL = makeDest({ id: "seoul", name: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 });
const SINGAPORE = makeDest({ id: "singapore", name: "Singapore", country: "Singapore", lat: 1.3521, lng: 103.8198 });
const CATALOG = [KYOTO, SEOUL, SINGAPORE];

const PREFS: Preferences = {
  party: "couple",
  vibe: "mix",
  splurges: ["food"],
  transit: "clean-transit",
  detail: "essentials",
};

/** The motivating trip: Nov 13–29, Japan first, ≥8 Japan / ≥2 each elsewhere. */
const ASIA_TRIP: TripConstraints = {
  startDate: "2026-11-13",
  endDate: "2026-11-29",
  countries: [
    { country: "Japan", minFullDays: 8 },
    { country: "South Korea", minFullDays: 2 },
    { country: "Singapore", minFullDays: 2 },
  ],
  firstCountry: "Japan",
};
```

**Step 2: Write failing validation tests**

```ts
describe("splitTrip validation", () => {
  it("rejects an invalid date range", () => {
    const result = splitTrip({ ...ASIA_TRIP, endDate: "2026-11-01" }, PREFS, CATALOG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bad-dates");
  });

  it("rejects an empty country list", () => {
    const result = splitTrip({ ...ASIA_TRIP, countries: [] }, PREFS, CATALOG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("does-not-fit");
  });

  it("rejects a country with no catalog destinations", () => {
    const result = splitTrip(
      { ...ASIA_TRIP, countries: [...ASIA_TRIP.countries, { country: "Atlantis", minFullDays: 1 }] },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown-country");
      expect(result.error.message).toContain("Atlantis");
    }
  });

  it("rejects a duplicate country", () => {
    const result = splitTrip(
      { ...ASIA_TRIP, countries: [...ASIA_TRIP.countries, { country: "Japan", minFullDays: 1 }] },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown-country");
  });

  it("rejects a firstCountry that isn't in the trip", () => {
    const result = splitTrip({ ...ASIA_TRIP, firstCountry: "Singapore City" }, PREFS, CATALOG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown-country");
  });

  it("rejects minimums that don't fit, and shows the arithmetic", () => {
    // 17 days − 4 travel days = 13 full days; ask for 14.
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 10 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("does-not-fit");
      expect(result.error.message).toContain("17");
      expect(result.error.message).toContain("14");
    }
  });

  it("accepts minimums that exactly fit", () => {
    // 13 full days available; ask for exactly 13.
    const result = splitTrip(
      {
        ...ASIA_TRIP,
        countries: [
          { country: "Japan", minFullDays: 9 },
          { country: "South Korea", minFullDays: 2 },
          { country: "Singapore", minFullDays: 2 },
        ],
      },
      PREFS,
      CATALOG,
    );
    expect(result.ok).toBe(true);
  });
});
```

**Step 3: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — `splitTrip` is not exported.

**Step 4: Implement `splitTrip` validation + a walking skeleton**

Append to `src/lib/trip.ts` (imports at top of file):

```ts
import type {
  Destination,
  Preferences,
  Recommendation,
  TripConstraints,
  TripError,
  TripLeg,
  TripResult,
} from "./types";
import { rank } from "./matching";
```

(`Recommendation` must be exported from types.ts — it already is.)

```ts
function fail(code: TripError["code"], message: string): TripResult {
  return { ok: false, error: { code, message } };
}

/**
 * Split a trip's days across countries. Pure and synchronous — the algorithm
 * half of the same pattern as rank()/recommend().
 *
 * LEARNING NOTE: invalid input comes back as a TripResult with ok: false,
 * not an exception. Infeasible constraints are an *expected* outcome the UI
 * must explain ("your minimums need 14 days, you have 13"), and expected
 * outcomes are data. Exceptions are for the unexpected.
 */
export function splitTrip(
  constraints: TripConstraints,
  prefs: Preferences,
  destinations: Destination[],
): TripResult {
  const { startDate, endDate, countries, firstCountry } = constraints;

  const totalDays = countDays(startDate, endDate);
  if (totalDays === null) {
    return fail(
      "bad-dates",
      `"${startDate}" to "${endDate}" isn't a valid date range — use YYYY-MM-DD with the end date on or after the start.`,
    );
  }
  if (countries.length === 0) {
    return fail("does-not-fit", "Pick at least one country to split days across.");
  }
  const names = countries.map((c) => c.country);
  if (new Set(names).size !== names.length) {
    return fail("unknown-country", "Each country can appear in the trip only once.");
  }
  if (firstCountry !== undefined && !names.includes(firstCountry)) {
    return fail(
      "unknown-country",
      `"${firstCountry}" is pinned as the first stop but isn't one of the trip's countries.`,
    );
  }

  // Each country is represented by its best-matching destination for these
  // preferences — rank() is already sorted best-first, so the first
  // destination we see per country is its representative.
  const reps = new Map<string, Recommendation>();
  for (const rec of rank(prefs, destinations, destinations.length)) {
    if (!reps.has(rec.destination.country)) reps.set(rec.destination.country, rec);
  }
  for (const name of names) {
    if (!reps.has(name)) {
      return fail("unknown-country", `The catalog has no destinations in "${name}" yet.`);
    }
  }

  // Feasibility. Every leg burns its arrival day, and the trip's last day is
  // the flight home: countries.length + 1 travel days total.
  const travelOverhead = countries.length + 1;
  const minSum = countries.reduce((sum, c) => sum + c.minFullDays, 0);
  if (minSum + travelOverhead > totalDays) {
    return fail(
      "does-not-fit",
      `This trip is ${totalDays} days, but ${minSum} minimum full days + ` +
        `${travelOverhead} travel days (${countries.length} arrivals + the flight home) ` +
        `needs ${minSum + travelOverhead}. Trim the minimums or extend the dates.`,
    );
  }

  // Ordering + allocation follow in the next tasks; return a placeholder
  // single-leg plan so the exactly-fits test can pass meaningfully? No —
  // implement fully in Tasks 7–8. For THIS task, return ok with an empty
  // legs array; Task 7 replaces it.
  return { ok: true, plan: { legs: [], totalDays, spareDays: totalDays - minSum - travelOverhead } };
}
```

**Step 5: Run to verify pass**

Run: `npm run test:unit`
Expected: all passed (the exactly-fits test only asserts `ok: true`).

**Step 6: Commit**

```bash
git add tests/unit/trip.test.ts src/lib/trip.ts
git commit -m "Validate trip constraints with explanatory errors"
```

---

### Task 7: `splitTrip` — ordering by flight distance

**Files:**
- Modify: `tests/unit/trip.test.ts`
- Modify: `src/lib/trip.ts`

**Step 1: Write failing tests**

```ts
describe("splitTrip ordering", () => {
  it("pins the first country and routes the rest by distance", () => {
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Japan → Korea → Singapore heads steadily south (~5,500 km);
      // Japan → Singapore → Korea backtracks (~9,600 km).
      expect(result.plan.legs.map((l) => l.country)).toEqual([
        "Japan",
        "South Korea",
        "Singapore",
      ]);
    }
  });

  it("respects a different pin even when it costs distance", () => {
    const result = splitTrip({ ...ASIA_TRIP, firstCountry: "Singapore" }, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.legs[0].country).toBe("Singapore");
  });

  it("picks the best-matching destination as each country's representative", () => {
    const osaka = makeDest({
      id: "osaka", name: "Osaka", country: "Japan", lat: 34.6937, lng: 135.5023,
      scores: { ...KYOTO.scores, foodScene: 99, transitQuality: 99 },
    });
    // PREFS splurges on food + clean transit, so Osaka outranks default-Kyoto.
    const result = splitTrip(ASIA_TRIP, PREFS, [...CATALOG, osaka]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const japan = result.plan.legs.find((l) => l.country === "Japan");
      expect(japan?.destination.id).toBe("osaka");
    }
  });
});
```

**Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — legs is `[]`.

**Step 3: Implement ordering** — in `src/lib/trip.ts`, add the helper above `splitTrip`:

```ts
/** All orderings of the input (n is tiny — a trip has a handful of legs). */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}
```

Replace the placeholder `return` at the end of `splitTrip` with:

```ts
  const spare = totalDays - minSum - travelOverhead;

  // Ordering: cheapest total flight distance among permutations honoring the
  // pin. Candidates are generated from a name-sorted list, so ties resolve
  // to the alphabetically-earliest route — deterministic, testable.
  const sortedCountries = [...countries].sort((a, b) => a.country.localeCompare(b.country));
  const candidates = permutations(sortedCountries).filter(
    (order) => firstCountry === undefined || order[0].country === firstCountry,
  );
  let bestOrder = candidates[0];
  let bestDistance = Infinity;
  for (const order of candidates) {
    let distance = 0;
    for (let i = 0; i + 1 < order.length; i++) {
      distance += distanceKm(
        reps.get(order[i].country)!.destination,
        reps.get(order[i + 1].country)!.destination,
      );
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOrder = order;
    }
  }

  // Allocation (Task 8 refines): minimums only for now, spare unassigned.
  const start = parseDay(startDate)!;
  let cursor = start;
  const legs: TripLeg[] = bestOrder.map((c, i) => {
    const rep = reps.get(c.country)!;
    const travelDays = i === bestOrder.length - 1 ? 2 : 1;
    const fullDays = c.minFullDays;
    const legStart = cursor;
    const legEnd = cursor + (fullDays + travelDays - 1) * DAY_MS;
    cursor = legEnd + DAY_MS;
    return {
      country: c.country,
      destination: rep.destination,
      startDate: formatDay(legStart),
      endDate: formatDay(legEnd),
      fullDays,
      travelDays,
      spareDays: 0,
      matchScore: rep.score,
      reasons: rep.reasons,
    };
  });

  return { ok: true, plan: { legs, totalDays, spareDays: spare } };
```

**Step 4: Run to verify pass**

Run: `npm run test:unit`
Expected: all passed.

**Step 5: Commit**

```bash
git add tests/unit/trip.test.ts src/lib/trip.ts
git commit -m "Order trip legs by total flight distance, honoring pins"
```

---

### Task 8: `splitTrip` — preference-weighted spare days + date integrity

**Files:**
- Modify: `tests/unit/trip.test.ts`
- Modify: `src/lib/trip.ts`

**Step 1: Write failing tests**

```ts
describe("splitTrip allocation", () => {
  it("gives spare days to the best-matching country (largest remainder)", () => {
    // Make Singapore's rep clearly the strongest match for PREFS.
    const shinySingapore = makeDest({
      ...SINGAPORE,
      scores: { ...SINGAPORE.scores, foodScene: 99, hotelQuality: 99, transitQuality: 99 },
    });
    const result = splitTrip(ASIA_TRIP, PREFS, [KYOTO, SEOUL, shinySingapore]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 17 − 12 minimums − 4 travel = 1 spare day → Singapore.
      const sg = result.plan.legs.find((l) => l.country === "Singapore")!;
      expect(sg.spareDays).toBe(1);
      expect(sg.fullDays).toBe(3);
    }
  });

  it("breaks exact ties toward earlier legs", () => {
    // Identical scores → identical quotas → the tie goes to leg order.
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.legs[0].spareDays).toBe(1);
      expect(result.plan.legs[0].fullDays).toBe(9);
    }
  });

  it("covers every calendar day exactly once, no gaps or overlaps", () => {
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const legs = result.plan.legs;
      expect(legs[0].startDate).toBe("2026-11-13");
      expect(legs[legs.length - 1].endDate).toBe("2026-11-29");
      const allocated = legs.reduce((sum, l) => sum + l.fullDays + l.travelDays, 0);
      expect(allocated).toBe(17);
      for (let i = 0; i + 1 < legs.length; i++) {
        const next = new Date(legs[i].endDate + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        expect(legs[i + 1].startDate).toBe(next.toISOString().slice(0, 10));
      }
    }
  });

  it("honors every minimum in the motivating trip", () => {
    const result = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byCountry = Object.fromEntries(result.plan.legs.map((l) => [l.country, l]));
      expect(byCountry["Japan"].fullDays).toBeGreaterThanOrEqual(8);
      expect(byCountry["Singapore"].fullDays).toBeGreaterThanOrEqual(2);
      expect(byCountry["South Korea"].fullDays).toBeGreaterThanOrEqual(2);
    }
  });

  it("is deterministic", () => {
    const a = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    const b = splitTrip(ASIA_TRIP, PREFS, CATALOG);
    expect(a).toEqual(b);
  });
});
```

**Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — spare days are never assigned (`spareDays: 0` everywhere).

**Step 3: Implement allocation** — in `splitTrip`, between the ordering block and the legs-assembly block, insert:

```ts
  // Spare days beyond the minimums go to countries in proportion to their
  // match scores — the "preference-weighted" half of the design.
  //
  // LEARNING NOTE: naive proportional shares are fractional; you can't spend
  // 0.4 of a day in Seoul. The largest-remainder method fixes that: floor
  // every share, then hand the leftover whole days to the largest fractional
  // parts. Ties break toward earlier legs so the result is deterministic —
  // nondeterministic allocation would make this function untestable.
  const scores = bestOrder.map((c) => reps.get(c.country)!.score);
  const totalScore = scores.reduce((sum, s) => sum + s, 0);
  const quotas = scores.map((s) =>
    totalScore === 0 ? spare / bestOrder.length : (spare * s) / totalScore,
  );
  const spareAlloc = quotas.map(Math.floor);
  let leftover = spare - spareAlloc.reduce((sum, v) => sum + v, 0);
  const byRemainder = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byRemainder) {
    if (leftover === 0) break;
    spareAlloc[i] += 1;
    leftover -= 1;
  }
```

Then in the legs-assembly `map`, change:

```ts
    const fullDays = c.minFullDays;
```

to:

```ts
    const fullDays = c.minFullDays + spareAlloc[i];
```

and `spareDays: 0,` to `spareDays: spareAlloc[i],`.

**Step 4: Run to verify pass**

Run: `npm run test:unit`
Expected: all passed. If the tie-break test fails, check that `permutations` receives the name-sorted list and that the remainder sort is `|| a.i - b.i`.

**Step 5: Commit**

```bash
git add tests/unit/trip.test.ts src/lib/trip.ts
git commit -m "Allocate spare days by match score via largest remainder"
```

---

### Task 9: `planTrip` wrapper + shared prefs parser

**Files:**
- Modify: `src/lib/trip.ts`
- Create: `src/lib/prefs.ts`
- Modify: `src/app/results/page.tsx` (delete local `parsePrefs`, import shared one)

**Step 1: Add the async wrapper** — append to `src/lib/trip.ts`:

```ts
import { getDestinations } from "./destinations";
```

(with the other imports), and:

```ts
/** Load the catalog and split the trip — the only impure part of this module. */
export async function planTrip(
  constraints: TripConstraints,
  prefs: Preferences,
): Promise<TripResult> {
  const destinations = await getDestinations();
  return splitTrip(constraints, prefs, destinations);
}
```

**Step 2: Extract `parsePrefs`** — create `src/lib/prefs.ts` by moving the function verbatim from `src/app/results/page.tsx:24-40`, exported, with a note:

```ts
import type { Preferences, Splurge } from "./types";

// Shared by /results and /trip/results — both read wizard answers from the
// URL. LEARNING NOTE: extracted the moment a second caller appeared, not
// before (YAGNI), and kept the safe-fallback behavior: a hand-edited or
// truncated URL degrades to defaults instead of crashing.

/** Parse raw query params into typed Preferences, with safe fallbacks. */
export function parsePrefs(params: {
  [key: string]: string | string[] | undefined;
}): Preferences {
  const get = (key: string, fallback: string): string => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
  };
  return {
    party: get("party", "solo") as Preferences["party"],
    vibe: get("vibe", "mix") as Preferences["vibe"],
    splurges: get("splurges", "")
      .split(",")
      .filter(Boolean) as Splurge[],
    transit: get("transit", "car") as Preferences["transit"],
    detail: get("detail", "essentials") as Preferences["detail"],
  };
}
```

In `src/app/results/page.tsx`: delete the local `parsePrefs` and its `Splurge` import; add `import { parsePrefs } from "@/lib/prefs";`.

**Step 3: Verify**

Run: `npm run test:unit` — all passed.
Run: `npx tsc --noEmit` — no errors.

**Step 4: Commit**

```bash
git add src/lib/trip.ts src/lib/prefs.ts src/app/results/page.tsx
git commit -m "Add planTrip wrapper and share the prefs parser"
```

---

### Task 10: `/trip` form page

**Files:**
- Create: `src/app/trip/page.tsx`
- Create: `src/components/TripForm.tsx`

**Step 1: Server page** — `src/app/trip/page.tsx`:

```tsx
import TripForm from "@/components/TripForm";
import { getDestinations } from "@/lib/destinations";

// ---------------------------------------------------------------------------
// The trip form's server half: fetch what the form needs (the list of
// countries actually in the catalog) and pass it down. The interactive form
// itself is a Client Component — same division of labor as the wizard.
// Wizard answers arrive as query params (via the /results link) and are
// forwarded so the plan can be preference-weighted.
// ---------------------------------------------------------------------------

const PREF_KEYS = ["party", "vibe", "splurges", "transit", "detail"] as const;

export default async function TripPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const destinations = await getDestinations();
  const countries = [...new Set(destinations.map((d) => d.country))].sort();

  const prefs: Record<string, string> = {};
  for (const key of PREF_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) prefs[key] = value;
  }

  return <TripForm countries={countries} prefs={prefs} />;
}
```

**Step 2: Client form** — `src/components/TripForm.tsx`:

```tsx
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
  minFullDays: number;
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
    Object.fromEntries(countries.map((c) => [c, { included: false, minFullDays: 2 }])),
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
    const min = Math.max(0, Number(raw) || 0);
    setChoices({ ...choices, [country]: { ...choices[country], minFullDays: min } });
  }

  function submit() {
    const params = new URLSearchParams(prefs);
    params.set("start", startDate);
    params.set("end", endDate);
    params.set("countries", included.map((c) => `${c}:${choices[c].minFullDays}`).join(","));
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
```

**Step 3: Verify it renders**

Run: `npx tsc --noEmit` — no errors.
Run: `npm run build` — compiles (`/trip` appears in the route list).

**Step 4: Commit**

```bash
git add src/app/trip/page.tsx src/components/TripForm.tsx
git commit -m "Add the /trip form page"
```

---

### Task 11: `/trip/results` page

**Files:**
- Create: `src/app/trip/results/page.tsx`

**Step 1: Implement**

```tsx
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
      return { country, minFullDays: Math.max(0, Number(min) || 0) };
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
```

**Step 2: Verify**

Run: `npm run build` — compiles, `/trip/results` in the route list.
Then manually: `npm run dev`, open
`http://localhost:3000/trip/results?start=2026-11-13&end=2026-11-29&countries=Japan:8,South%20Korea:2,Singapore:2&first=Japan`
Expected: three leg cards, Japan first (Nov 13), last card ends Nov 29. Also try `countries=Japan:20,...` and confirm the amber does-not-fit card with the arithmetic.

**Step 3: Commit**

```bash
git add src/app/trip/results/page.tsx
git commit -m "Add /trip/results: render the split, explain infeasible trips"
```

---

### Task 12: Entry point from `/results` + home page

**Files:**
- Modify: `src/app/results/page.tsx` (add link in the bottom actions block, ~line 130)
- Modify: `src/app/page.tsx` (secondary link to /trip — read the file first, match its style)

**Step 1: Results page link** — in the existing `mt-10` actions `div`, after the "Adjust my answers" link, add (needs `searchParams` re-serialized; at the top of the component, after `const prefs = parsePrefs(...)`, build it):

```tsx
  // Forward the wizard answers so the trip splitter can weight by them.
  const raw = await searchParams; // already awaited above — reuse that variable instead
```

Concretely: change `const prefs = parsePrefs(await searchParams);` to
```tsx
  const raw = await searchParams;
  const prefs = parsePrefs(raw);
  const passthrough = new URLSearchParams();
  for (const key of ["party", "vibe", "splurges", "transit", "detail"]) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) passthrough.set(key, value);
  }
```
and add to the actions block:
```tsx
        <Link
          href={`/trip?${passthrough.toString()}`}
          data-testid="results-to-trip"
          className="rounded-full border border-stone-300 px-6 py-3 font-medium text-stone-700 transition-colors hover:bg-stone-50"
        >
          Split a real trip&apos;s days →
        </Link>
```
(Adjust the neighboring copy so the block doesn't crowd — keep it to the two links plus one caption.)

**Step 2: Home page** — add a modest secondary link to `/trip` ("Already know where? Split your days →") styled consistently with whatever `src/app/page.tsx` already does. Read the file before editing.

**Step 3: Verify** — `npm run build` passes; eyeball both pages in dev.

**Step 4: Commit**

```bash
git add src/app/results/page.tsx src/app/page.tsx
git commit -m "Link the trip splitter from results and home"
```

---

### Task 13: E2E spec

**Files:**
- Create: `tests/trip.spec.ts`

**Precondition:** migrations applied (Task 4) — Singapore must exist in the live DB. Build first: `npm run build`.

**Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";

// The full trip-splitter journey against the real catalog: the motivating
// Asia trip — Nov 13–29, Japan pinned first, ≥8/2/2 full days.
test("splits the Asia trip across three countries", async ({ page }) => {
  await page.goto("/trip");

  await page.getByTestId("trip-start").fill("2026-11-13");
  await page.getByTestId("trip-end").fill("2026-11-29");
  await page.getByTestId("trip-country-Japan").check();
  await page.getByTestId("trip-country-South Korea").check();
  await page.getByTestId("trip-country-Singapore").check();
  await page.getByTestId("trip-min-Japan").fill("8");
  await page.getByTestId("trip-first").selectOption("Japan");
  await page.getByTestId("trip-submit").click();

  await expect(page.getByTestId("trip-leg")).toHaveCount(3);
  const legs = page.getByTestId("trip-leg");
  await expect(legs.first()).toContainText("Japan");
  await expect(legs.first()).toContainText("Nov 13");
  await expect(legs.last()).toContainText("Nov 29");
});

test("explains a trip that doesn't fit instead of erroring", async ({ page }) => {
  await page.goto("/trip");

  await page.getByTestId("trip-start").fill("2026-11-13");
  await page.getByTestId("trip-end").fill("2026-11-16");
  await page.getByTestId("trip-country-Japan").check();
  await page.getByTestId("trip-min-Japan").fill("10");
  await page.getByTestId("trip-submit").click();

  await expect(page.getByTestId("trip-error")).toBeVisible();
  await expect(page.getByTestId("trip-error")).toContainText("travel days");
});
```

**Step 2: Run**

```bash
npm run build
npx playwright test tests/trip.spec.ts
```

Expected: 2 passed. Gotchas from this repo's history: check port 3000 for an orphaned `next start` first (`netstat -ano | findstr :3000`), and a first run after fresh browser install can blow timeouts (antivirus scan) — rerun once before debugging.

Then the full gate: `npx playwright test` — all 7 specs pass.

**Step 3: Commit**

```bash
git add tests/trip.spec.ts
git commit -m "Add trip-splitter E2E specs"
```

---

### Task 14: README + wrap-up

**Files:**
- Modify: `README.md`

**Step 1:** Update README: add the trip splitter to the intro sentence, add `src/lib/trip.ts` and the `/trip` pages to the "How it fits together" map, replace the Database section's "applied as migrations" claim with a pointer to `supabase/migrations/` (and how to apply them), and mention the two test runners in the Tests section (`npm run test:unit` + Playwright).

**Step 2: Full verification**

```bash
npm run test:unit
npm run build
npx playwright test
npx tsc --noEmit
```

All green.

**Step 3: Commit**

```bash
git add README.md
git commit -m "Document the trip splitter, migrations, and unit tests"
```

**Step 4:** Use superpowers:finishing-a-development-branch — the branch is `claude/asia-trip-planning-06bb76`; a PR to `main` is the expected route (CI must pass; Vercel will cut a preview).

---

## Acceptance (the motivating trip)

On the preview or locally: `/trip` → Nov 13 to Nov 29, Japan (min 8) + South Korea (min 2) + Singapore (min 2), Japan first → a three-leg plan Japan → South Korea → Singapore covering Nov 13–29 with Japan ≥8 full days, Singapore ≥2, and 1 flexible day placed by match score — with the reasoning visible on each card.
