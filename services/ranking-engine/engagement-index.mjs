/**
 * Public Engagement Index — a DELIBERATELY PARTIAL metric, not the full
 * scoring engine in scoring.mjs.
 *
 * Why this file exists instead of just running real restaurants through
 * scoreRestaurant(): that function needs six factors (sentiment,
 * authenticity, mention velocity, demand, freshness, editorial), and right
 * now the only one of those six with a legitimately-sourced, citable value
 * for real businesses is review volume (Yelp blocks automated fetching of
 * star ratings — see docs/source-policy/approved-sources.md). Forcing the
 * other five factors to a guessed number just to produce a 50-100 "trust
 * score" for a real, named business would be exactly the kind of
 * unsupported claim that creates legal exposure. This function computes
 * only what's real: a min-max normalized rank of review count within a
 * curated set, scaled to the same 50-100 range for visual consistency.
 *
 * When a real source (Google Places API, etc.) is connected, feed its
 * output into scoreRestaurant() instead — that's the real scoring path.
 * This file is a bridge, not a replacement.
 */

const FLOOR = 50;
const CEILING = 100;

/**
 * @param {{id:string, yelp_review_count:number}[]} restaurants
 * @returns {Map<string, {index:number, percentile:number}>}
 */
export function computeEngagementIndex(restaurants) {
  const counts = restaurants.map((r) => r.yelp_review_count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const span = max - min || 1;

  const result = new Map();
  for (const r of restaurants) {
    const percentile = (r.yelp_review_count - min) / span;
    const index = Math.round(FLOOR + percentile * (CEILING - FLOOR));
    result.set(r.id, { index, percentile: Math.round(percentile * 100) });
  }
  return result;
}

if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs/promises");
  const raw = JSON.parse(await fs.readFile(new URL("../../data/real-pilot/scottsdale-real-snapshot.json", import.meta.url)));
  const indexed = computeEngagementIndex(raw.restaurants);
  for (const r of raw.restaurants) {
    console.log(r.name.padEnd(24), indexed.get(r.id));
  }
}
