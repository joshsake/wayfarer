import { defineConfig } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright config — this part is YOUR home turf.
//
// The `webServer` block is the piece worth knowing: Playwright starts the
// Next.js production server itself before the suite runs and tears it down
// after. No "remember to start the app first" flakiness — the test run is
// fully self-contained, which is exactly what you want in CI.
// ---------------------------------------------------------------------------

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // Locally (Cowork sandbox) Chromium is pre-installed at a fixed path.
    // In CI we let Playwright use its own downloaded browsers instead.
    launchOptions: process.env.CI
      ? {}
      : { executablePath: "/opt/pw-browsers/chromium" },
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
