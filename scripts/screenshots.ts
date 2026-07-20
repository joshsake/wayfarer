// Quick visual-verification script: drives the app like a user and captures
// screenshots of each screen. Run with: npx tsx scripts/screenshots.ts
// (assumes `npm run start` is already serving on :3000)
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  await page.goto("http://localhost:3000/");
  await page.screenshot({ path: "shots/1-landing.png" });

  await page.goto("http://localhost:3000/plan");
  await page.screenshot({ path: "shots/2-wizard-step1.png" });

  await page.getByTestId("option-couple").click();
  await page.getByTestId("option-local").click();
  await page.getByTestId("option-food").click();
  await page.getByTestId("option-hotel").click();
  await page.screenshot({ path: "shots/3-wizard-splurges.png" });

  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("option-clean-transit").click();
  await page.getByTestId("option-essentials").click();
  await page.waitForURL(/\/results/);
  await page.screenshot({ path: "shots/4-results.png", fullPage: true });

  await browser.close();
}

main();
