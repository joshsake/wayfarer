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
