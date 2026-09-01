import { cache } from "react";
import { supabase } from "./supabase";
import type { Destination } from "./types";

// ---------------------------------------------------------------------------
// The destination catalog — now backed by Supabase.
//
// LEARNING NOTE: This file used to export a hard-coded `DESTINATIONS` array.
// The array is gone; the shape it produced is not. Everything above this layer
// (matching engine, results page) still thinks in terms of `Destination`
// objects, which is exactly the payoff of having defined that type first.
//
// Two ideas worth internalizing here:
//
// 1. THE MAPPING BOUNDARY. Postgres columns are snake_case and flat
//    (`local_culture`). Our domain type is camelCase and nested
//    (`scores.localCulture`). `toDestination` is the single place those two
//    worlds meet. Keeping that translation in one function means a schema
//    change touches one file instead of every component.
//
// 2. REQUEST MEMOIZATION. `cache()` from React makes repeated calls within a
//    single request return the same result instead of re-querying. Call
//    `getDestinations()` in three components and the database sees one query.
//    The cache is per-request — it does not leak data between users.
// ---------------------------------------------------------------------------

/** The raw row shape as it comes back from Postgres. */
interface DestinationRow {
  id: string;
  name: string;
  country: string;
  tagline: string;
  emoji: string;
  local_culture: number;
  classic_sights: number;
  hotel_quality: number;
  food_scene: number;
  experiences: number;
  transit_quality: number;
  family_friendly: number;
  walkability: number;
  daily_cost: number;
  lat: number;
  lng: number;
  highlights: string[];
}

/** Translate one database row into the domain object the app works with. */
function toDestination(row: DestinationRow): Destination {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    tagline: row.tagline,
    emoji: row.emoji,
    scores: {
      localCulture: row.local_culture,
      classicSights: row.classic_sights,
      hotelQuality: row.hotel_quality,
      foodScene: row.food_scene,
      experiences: row.experiences,
      transitQuality: row.transit_quality,
      familyFriendly: row.family_friendly,
      walkability: row.walkability,
    },
    dailyCost: row.daily_cost,
    lat: row.lat,
    lng: row.lng,
    highlights: row.highlights,
  };
}

/**
 * Load the full destination catalog.
 *
 * Memoized per request — see the note above. Throws if the query fails, so a
 * broken database surfaces as an error page rather than "no matches found",
 * which would be an infuriating way to learn your database is down.
 */
export const getDestinations = cache(async (): Promise<Destination[]> => {
  // NOTE: this select list must stay a single string literal — supabase-js
  // inspects it at the *type* level to infer the row shape, and a value built
  // by concatenation is no longer a literal type, which breaks inference.
  // We list columns explicitly rather than using "*" so we don't fetch
  // `created_at` on every request just to throw it away.
  const { data, error } = await supabase
    .from("destinations")
    .select(
      "id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights, lat, lng",
    )
    .order("id");

  if (error) {
    throw new Error(`Failed to load destinations: ${error.message}`);
  }

  return data.map(toDestination);
});
