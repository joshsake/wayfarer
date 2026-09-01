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
