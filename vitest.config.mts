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
//
// LEARNING NOTE: The `server-only` alias. src/lib/duffel.ts starts with
// `import "server-only"` so Next.js refuses to bundle it for the browser.
// Next handles that import itself, but Vitest is plain Node: it would load
// the real npm package, whose entry point simply throws ("cannot be imported
// from a Client Component") because Node isn't a React server bundle either.
// Pointing the bare specifier at an empty stub keeps the guard in the source
// and out of the test run. Only this one name is aliased — nothing else in
// node_modules is touched.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // WebSocket stub for Node < 22 — see the note in tests/unit/setup.ts.
    setupFiles: ["tests/unit/setup.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://unit-tests-never-connect.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "unit-test-dummy-key",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/unit/server-only.stub.ts", import.meta.url)),
    },
  },
});
