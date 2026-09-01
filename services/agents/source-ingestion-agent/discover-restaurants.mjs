/**
 * Restaurant Discovery — a one-off (or occasional) tool, NOT part of the
 * daily/weekly pipeline. It answers "how do we add real Scottsdale
 * restaurants at scale without hand-typing addresses from memory," which
 * is a real accuracy risk for a product whose whole pitch is trustworthy,
 * sourced data.
 *
 * Why this exists: the Scottsdale ArcGIS business-license dataset (used by
 * run.mjs for license verification) has no restaurant/category field --
 * confirmed by reading the layer's own schema directly -- so it can't be
 * used to discover "which businesses are restaurants," only to verify a
 * restaurant we already know the name of. Google Places is the only source
 * in this project with real category data, so this script uses the same
 * Places API (New) this pipeline already pays $0 for, in Nearby Search
 * mode, walked across a grid of points covering Scottsdale, to pull a real,
 * Google-verified candidate list: name, address, place_id, rating,
 * business status.
 *
 * This does NOT touch scottsdale-real-snapshot.json or the live pipeline.
 * It writes data/real-pilot/discovered-candidates.json for a human (or a
 * follow-up review pass) to curate into the real snapshot -- deliberately
 * a separate, reviewed step, not an auto-merge, because Google's category
 * tagging isn't perfect (coffee shops, bars, and ghost-kitchen listings
 * show up under "restaurant" too) and this pilot's data should stay
 * hand-checked, not just machine-dumped.
 *
 * Run with `node discover-restaurants.mjs`. Requires GOOGLE_PLACES_API_KEY.
 * Uses the SAME BudgetGuard discipline as run.mjs -- see the comment above
 * BudgetGuardError in run.mjs for why: this makes real metered calls (one
 * per grid point, ~15-20 total for full Scottsdale coverage), and a bug
 * that loops the grid should still cost nothing, ever.
 */

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const OUTPUT_PATH = path.join(REPO_ROOT, "data/real-pilot/discovered-candidates.json");
const LEDGER_PATH = path.join(REPO_ROOT, "data/real-pilot/api-usage-ledger.json");

// Nearby Search (New) returns at most 20 results per call with no
// pagination token, so broad coverage means many grid points, not one big
// query. These roughly tile Scottsdale from South Scottsdale up through
// DC Ranch/North Scottsdale, ~2.5km spacing so adjacent circles overlap
// slightly rather than leaving gaps.
const GRID_POINTS = [
  { label: "South Scottsdale / Old Town", lat: 33.4942, lng: -111.9261 },
  { label: "Old Town core", lat: 33.4945, lng: -111.9020 },
  { label: "Downtown / 5th Ave", lat: 33.5015, lng: -111.9150 },
  { label: "Camelback Corridor", lat: 33.5090, lng: -111.9280 },
  { label: "Fashion Square / Goldwater", lat: 33.5027, lng: -111.9260 },
  { label: "Indian School / Hayden", lat: 33.4942, lng: -111.9450 },
  { label: "McCormick Ranch", lat: 33.5350, lng: -111.9150 },
  { label: "Gainey Ranch", lat: 33.5550, lng: -111.9200 },
  { label: "Kierland", lat: 33.6220, lng: -111.9270 },
  { label: "DC Ranch / North Scottsdale", lat: 33.6600, lng: -111.9100 },
  { label: "Grayhawk", lat: 33.6800, lng: -111.9200 },
  { label: "Shea Corridor", lat: 33.5750, lng: -111.8900 },
  { label: "Airpark", lat: 33.6230, lng: -111.9100 },
  { label: "Old Town East / Marshall Way", lat: 33.4960, lng: -111.9100 },
  { label: "South Scottsdale / Pima-Princess", lat: 33.4700, lng: -111.9100 },
];
const RADIUS_METERS = 2200;

const PLACES_NEARBY_SEARCH_PER_RUN_CAP = GRID_POINTS.length + 5; // sanity cap -- same guard discipline as run.mjs

class BudgetGuardError extends Error {
  constructor(made, cap) {
    super(`BUDGET GUARD: placesNearbySearch would exceed its per-run cap (${made + 1} > ${cap}). Stopping now -- nothing partial gets written.`);
    this.name = "BudgetGuardError";
  }
}

async function loadLedger() {
  try {
    const raw = JSON.parse(await readFile(LEDGER_PATH, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function saveLedgerNearbySearchCount(ledger, count) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const prior = ledger.placesNearbySearch && ledger.placesNearbySearch.period === monthKey ? ledger.placesNearbySearch.count : 0;
  ledger.placesNearbySearch = { period: monthKey, count: prior + count };
  ledger.updated_at = new Date().toISOString();
  await writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

async function fetchNearbyRestaurants(point, key) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus",
    },
    body: JSON.stringify({
      includedTypes: ["restaurant"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: point.lat, longitude: point.lng },
          radius: RADIUS_METERS,
        },
      },
    }),
  });
  if (!res.ok) {
    console.error(`Nearby Search failed for "${point.label}": HTTP ${res.status}`);
    return [];
  }
  const json = await res.json();
  return json.places ?? [];
}

async function main() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    console.error("GOOGLE_PLACES_API_KEY not set -- nothing to discover. Exiting cleanly (not an error: this script only runs when someone explicitly triggers it).");
    return;
  }

  const ledger = await loadLedger();
  let callsMade = 0;
  const byPlaceId = new Map();

  for (const point of GRID_POINTS) {
    callsMade += 1;
    if (callsMade > PLACES_NEARBY_SEARCH_PER_RUN_CAP) {
      throw new BudgetGuardError(callsMade - 1, PLACES_NEARBY_SEARCH_PER_RUN_CAP);
    }
    const places = await fetchNearbyRestaurants(point, key);
    for (const p of places) {
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue; // skip closed listings
      if (!p.id || byPlaceId.has(p.id)) continue; // dedup across overlapping grid circles
      byPlaceId.set(p.id, {
        place_id: p.id,
        name: p.displayName?.text ?? null,
        formatted_address: p.formattedAddress ?? null,
        rating: p.rating ?? null,
        user_rating_count: p.userRatingCount ?? null,
        found_near: point.label,
      });
    }
    await new Promise((r) => setTimeout(r, 300)); // basic pacing between grid calls, not a documented requirement
  }

  const candidates = [...byPlaceId.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        _notice:
          "Generated by services/agents/source-ingestion-agent/discover-restaurants.mjs -- a real, Google-verified candidate list, NOT auto-merged into scottsdale-real-snapshot.json. Each entry is a live Places API (New) Nearby Search result (name, formatted_address, place_id, rating, user_rating_count) at the time this ran. Review before adding to the real snapshot: Google's 'restaurant' category also catches some coffee shops, bars, and ghost kitchens, so a human pass should confirm each one belongs in a restaurant-ranking pilot before it's promoted.",
        generated_at: new Date().toISOString(),
        grid_points_queried: GRID_POINTS.length,
        candidate_count: candidates.length,
        candidates,
      },
      null,
      2
    )
  );

  await saveLedgerNearbySearchCount(ledger, callsMade);

  console.log(`Wrote ${candidates.length} candidate(s) from ${GRID_POINTS.length} grid point(s) to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  if (err instanceof BudgetGuardError) {
    console.error(err.message);
  } else {
    console.error("Discovery run failed:", err);
  }
  process.exit(1);
});
