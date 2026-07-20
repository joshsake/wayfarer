import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// The Supabase client.
//
// LEARNING NOTE: Two things here are load-bearing and easy to get wrong.
//
// 1. The env vars are read as STATIC references (`process.env.NEXT_PUBLIC_...`)
//    rather than dynamically (`process.env[someVariable]`). Next.js replaces
//    `NEXT_PUBLIC_*` references with literal values at build time by doing a
//    find-and-replace on the source — and find-and-replace can't see through a
//    variable. A dynamic lookup silently becomes `undefined` in the browser.
//
// 2. We create the client once at module scope and reuse it. Modules are
//    evaluated once per server process, so this is effectively a singleton —
//    we're not opening a new connection on every request.
//
// This client only ever holds the *publishable* key, which is powerless on its
// own: Row Level Security decides what it can actually read. Our destinations
// table grants public SELECT and nothing else, so the worst a leaked key can
// do is read data that's already on the page.
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Fail loudly at startup rather than mysteriously at query time. A missing
  // env var in CI or on Vercel should break the build, not the user's page.
  throw new Error(
    "Missing Supabase environment variables. Copy .env.example to .env.local " +
      "and fill in NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
