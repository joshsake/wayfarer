import type { Preferences, Splurge } from "./types";

// Shared by /results and /trip/results — both read wizard answers from the
// URL. LEARNING NOTE: extracted the moment a second caller appeared, not
// before (YAGNI), and kept the safe-fallback behavior: a hand-edited or
// truncated URL degrades to defaults instead of crashing.

/** The wizard's five answer keys — the params worth forwarding between pages. */
export const PREF_KEYS = ["party", "vibe", "splurges", "transit", "detail"] as const;

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
