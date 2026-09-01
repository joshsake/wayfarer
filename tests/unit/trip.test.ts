import { describe, expect, it } from "vitest";
import { countDays, distanceKm } from "@/lib/trip";

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
