import fs from "node:fs";
import { defineConfig } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright config — this part is YOUR home turf.
//
// The `webServer` block is the piece worth knowing: Playwright starts the
// Next.js production server itself before the suite runs and tears it down
// after. No "remember to start the app first" flakiness — the test run is
// fully self-contained, which is exactly what you want in CI.
// ---------------------------------------------------------------------------

// The Cowork sandbox pre-installs Chromium at this fixed path (and blocks
// downloads). Everywhere else — CI runners, Windows/macOS/Linux dev machines —
// the browsers come from Playwright's own cache via `npx playwright install`.
const sandboxChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "./tests",
  // Vitest owns *.test.ts (see vitest.config.mts); Playwright owns *.spec.ts.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // Use the sandbox's pinned Chromium only where it actually exists.
    // Keying on the path — not an env var like CI — means the same plain
    // `npx playwright test` works in the sandbox, in CI, and on any dev
    // machine, with nothing to remember to set. (Tip: the first run after
    // (re)installing browsers can blow test timeouts while antivirus scans
    // the fresh binaries. One-time cost, not flakiness — just rerun.)
    launchOptions: fs.existsSync(sandboxChromium)
      ? { executablePath: sandboxChromium }
      : {},
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
