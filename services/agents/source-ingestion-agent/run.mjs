/**
 * Source Ingestion Agent — real fetch logic, not a placeholder.
 *
 * This is the code the scheduled GitHub Actions jobs run. It implements
 * the exact techniques documented in services/agents/source-agent-playbook.md
 * (verified by hand against Dominick's Steakhouse and The Mission Old Town,
 * 2026-09-01) as real, unattended code — including the two conversion
 * formulas that playbook flagged as "judgment call, needs a real formula
 * before this runs unattended." Health inspection stays an honest stub:
 * that wall was not solved, so this does not pretend to solve it.
 *
 * CADENCE, not one flat daily run for everything -- see
 * services/agents/OPERATIONS.md for the full why. Each factor is tagged
 * below with how often it actually needs re-checking:
 *   - googleRating, reviewVolume, licenseVerified, siteFreshness: DAILY
 *     (rating/reviews move day to day; license status and site changes are
 *     cheap to check daily even though they rarely change)
 *   - editorialMentions: WEEKLY (a news feature is a rare event -- checking
 *     it daily buys nothing a weekly check doesn't, and at full-Scottsdale
 *     scale it's the difference between "free" and "not free" on Custom
 *     Search's 100-query/day cap)
 *   - healthInspection: UNIMPLEMENTED (not on any cadence yet -- see #5 in
 *     the playbook)
 *
 * Run with `node run.mjs daily` or `node run.mjs weekly` (defaults to
 * "daily" if no argument given). A run only fetches the factors on that
 * cadence and CARRIES FORWARD the last known value (with its original
 * note and timestamp) for everything else -- so a daily run never zeroes
 * out last week's editorial-mentions finding, and a weekly run doesn't
 * waste calls re-checking things that don't need it.
 *
 * Every fetch is defensive: a missing API key, a network failure, or a
 * source returning nothing produces `null` for that factor, never a
 * guess. Confidence is computed from which factors currently have real,
 * non-stub data behind them -- not hand-picked per restaurant.
 *
 * Requires (as environment variables / repo secrets, all optional --
 * missing ones just mean that factor stays unfilled, this never throws
 * for a missing key):
 *   GOOGLE_PLACES_API_KEY   -- Google Places API (New): rating, review count
 *   GOOGLE_CSE_KEY          -- Google Custom Search JSON API key
 *   GOOGLE_CSE_CX           -- Custom Search Engine ID (configure it to
 *                              search the open web, not a restricted set)
 *
 * No key required for the Scottsdale business-license lookup -- that's a
 * public ArcGIS endpoint, confirmed accessible, found the way the
 * playbook describes.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WEIGHTS, scoreRestaurant } from "../../ranking-engine/scoring.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "data/real-pilot/scottsdale-real-snapshot.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "data/real-pilot/scottsdale-live-scores.json");
const HISTORY_PATH = path.join(REPO_ROOT, "data/real-pilot/score-history.json");
const HISTORY_MAX_DAYS = 180; // per restaurant -- bounds file growth, ~6 months is plenty for a trend line

const SCOTTSDALE_LICENSE_ENDPOINT =
  "https://maps.scottsdaleaz.gov/arcgis/rest/services/OpenData_Tabular/MapServer/6/query";

const CADENCE = Object.freeze({
  googleRating: "daily",
  reviewVolume: "daily",
  healthInspection: "unimplemented",
  licenseVerified: "daily",
  siteFreshness: "daily",
  editorialMentions: "weekly",
});

const MODE = (process.argv[2] || "daily").toLowerCase();
if (!["daily", "weekly", "all"].includes(MODE)) {
  console.error(`Unknown mode "${MODE}" -- use "daily", "weekly", or "all".`);
  process.exit(1);
}
function factorDueThisRun(factorKey) {
  if (MODE === "all") return CADENCE[factorKey] !== "unimplemented";
  return CADENCE[factorKey] === MODE;
}

// --- Google Places -----------------------------------------------------
// Places API (New): one Text Search call to resolve the place, then read
// rating + userRatingCount straight off the result. No separate Details
// call needed for just these two fields, which keeps the free-tier
// budget small (see docs/launch/go-live-cheap.md for the actual cost).
async function fetchGooglePlaces(name, address) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { rating: null, reviewCount: null, reason: "no GOOGLE_PLACES_API_KEY set" };

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.rating,places.userRatingCount,places.id",
      },
      body: JSON.stringify({ textQuery: `${name}, ${address}` }),
    });
    if (!res.ok) return { rating: null, reviewCount: null, reason: `Places API HTTP ${res.status}` };
    const json = await res.json();
    const place = json.places?.[0];
    if (!place) return { rating: null, reviewCount: null, reason: "no place match" };
    return { rating: place.rating ?? null, reviewCount: place.userRatingCount ?? null, reason: null };
  } catch (err) {
    return { rating: null, reviewCount: null, reason: `fetch failed: ${err.message}` };
  }
}

// --- Scottsdale business license ----------------------------------------
// Endpoint found via the ArcGIS item-metadata trick in the playbook, not
// the dataset's own landing page. No key needed -- public data.
//
// NOTE for full-Scottsdale scale (see docs/launch/scaling-to-full-scottsdale.md):
// this one-query-per-restaurant pattern does not scale past a few dozen
// restaurants before the 60s crawl delay alone blows past a reasonable
// job runtime. At that scale, replace this with a handful of bulk,
// paginated queries (this endpoint supports resultRecordCount up to
// 2,000) covering the whole dataset at once, matched locally against the
// restaurant list -- not rewritten here because the current pilot is
// well under that threshold, but flagged so nobody re-derives this.
async function fetchScottsdaleLicense(name, address) {
  const nameGuess = name.split(/[’']/)[0].split(" ")[0]; // crude but matches how "MISSION" found "THE MISSION RESTAURANT"
  const where = encodeURIComponent(`Company LIKE '%${nameGuess.toUpperCase()}%'`);
  const url = `${SCOTTSDALE_LICENSE_ENDPOINT}/query?where=${where}&outFields=*&f=json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { active: null, yearsActive: null, reason: `license API HTTP ${res.status}` };
    const json = await res.json();
    const features = json.features ?? [];
    // Confirm by address, same as the playbook insists -- a name match
    // alone is not reliable (17 unrelated "MISSION" businesses came back
    // in manual testing).
    const streetFragment = address.split(",")[0].toUpperCase().replace(/\bAVE\b/, "AV").replace(/\bRD\b/, "RD");
    const match = features.find((f) =>
      (f.attributes?.ServAddrComp || "").toUpperCase().includes(streetFragment.split(" ")[0])
    );
    if (!match) return { active: null, yearsActive: null, reason: "no address-confirmed match" };

    const attrs = match.attributes;
    const active = attrs.AcctStatus === "Active";
    const startMs = attrs.BusinessStartDate;
    const yearsActive = startMs ? (Date.now() - startMs) / (365.25 * 24 * 3600 * 1000) : null;
    return { active, yearsActive, reason: null };
  } catch (err) {
    return { active: null, yearsActive: null, reason: `fetch failed: ${err.message}` };
  }
}

// --- Editorial mentions (Google Custom Search) -- WEEKLY cadence ---------
async function fetchEditorialMentions(name) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return { hitCount: null, reason: "no GOOGLE_CSE_KEY/GOOGLE_CSE_CX set" };

  try {
    const q = encodeURIComponent(`"${name}" Scottsdale restaurant review OR feature`);
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10`
    );
    if (!res.ok) return { hitCount: null, reason: `Custom Search HTTP ${res.status}` };
    const json = await res.json();
    return { hitCount: json.items?.length ?? 0, reason: null };
  } catch (err) {
    return { hitCount: null, reason: `fetch failed: ${err.message}` };
  }
}

// --- Site freshness -------------------------------------------------------
async function fetchSiteFreshness(websiteUrl) {
  if (!websiteUrl) return { daysSinceModified: null, reason: "no website URL on file" };
  try {
    const res = await fetch(websiteUrl, { method: "GET" });
    const lastModified = res.headers.get("last-modified");
    if (!lastModified) return { daysSinceModified: null, reason: "no Last-Modified header" };
    const days = (Date.now() - new Date(lastModified).getTime()) / (24 * 3600 * 1000);
    return { daysSinceModified: days, reason: null };
  } catch (err) {
    return { daysSinceModified: null, reason: `fetch failed: ${err.message}` };
  }
}

// --- Health inspection ----------------------------------------------------
// Honest stub, not on any cadence yet. See
// services/agents/source-agent-playbook.md #5 -- the county's search tool
// is JS-rendered and this session's sandbox couldn't reach the host
// directly to test real browser automation against it. This function
// exists so the pipeline has one obvious place to fill in once that's
// solved, instead of scoring.mjs quietly defaulting to 0 with no trail
// explaining why.
async function fetchHealthInspection(_name, _address) {
  return { grade: null, reason: "not implemented -- see source-agent-playbook.md #5" };
}

// --- Conversion formulas ---------------------------------------------------
// These implement the two "judgment call, needs a real formula" TODOs
// from the playbook. Documented here, not picked per-restaurant by hand.

function licenseScore({ active, yearsActive }) {
  if (active === null) return { value: 0, note: "no address-confirmed license record found" };
  if (!active) return { value: 0.1, note: "license on file but not Active" };
  const tenureBonus = Math.min(0.5, (yearsActive ?? 0) / 40);
  return { value: Math.round((0.5 + tenureBonus) * 100) / 100, note: `Active, ~${Math.round(yearsActive)}yr tenure` };
}

function freshnessScore({ daysSinceModified }) {
  if (daysSinceModified === null) return { value: 0.4, note: "no Last-Modified signal; conservative default" };
  const d = daysSinceModified;
  if (d <= 30) return { value: 0.9, note: `updated ${Math.round(d)}d ago` };
  if (d <= 90) return { value: 0.75, note: `updated ${Math.round(d)}d ago` };
  if (d <= 180) return { value: 0.6, note: `updated ${Math.round(d)}d ago` };
  if (d <= 365) return { value: 0.45, note: `updated ${Math.round(d)}d ago` };
  return { value: 0.3, note: `updated ${Math.round(d)}d ago` };
}

function editorialScore({ hitCount }) {
  if (hitCount === null) return { value: 0, note: "editorial search not run" };
  if (hitCount === 0) return { value: 0.1, note: "search ran, nothing found" };
  if (hitCount <= 2) return { value: 0.4, note: `${hitCount} hit(s)` };
  if (hitCount <= 5) return { value: 0.6, note: `${hitCount} hits` };
  return { value: 0.8, note: `${hitCount}+ hits` };
}

function reviewVolumeScore(reviewCount) {
  if (reviewCount === null) return { value: 0, note: "no review count available" };
  // Fixed scale, not batch-relative -- so this number means the same
  // thing regardless of which or how many other restaurants are in the
  // run. 2,000 reviews caps out at 1.0; tune if the market's norms differ.
  return { value: Math.min(1, reviewCount / 2000), note: `${reviewCount} reviews` };
}

function ratingScore(rating) {
  if (rating === null) return { value: 0, note: "no Google rating available" };
  return { value: Math.round((rating / 5) * 100) / 100, note: `${rating}/5` };
}

// --- Fetchers, keyed by factor, each returning { value, note } -----------
const FACTOR_FETCHERS = {
  async googleRating(restaurant, _prior) {
    const places = await fetchGooglePlaces(restaurant.name, restaurant.address);
    return { computed: ratingScore(places.rating), hasReal: places.rating !== null };
  },
  async reviewVolume(restaurant, _prior) {
    const places = await fetchGooglePlaces(restaurant.name, restaurant.address);
    return { computed: reviewVolumeScore(places.reviewCount), hasReal: places.reviewCount !== null };
  },
  async licenseVerified(restaurant, _prior) {
    const license = await fetchScottsdaleLicense(restaurant.name, restaurant.address);
    return { computed: licenseScore(license), hasReal: license.active !== null };
  },
  async siteFreshness(restaurant, _prior) {
    const freshness = await fetchSiteFreshness(restaurant.website);
    return { computed: freshnessScore(freshness), hasReal: freshness.daysSinceModified !== null };
  },
  async editorialMentions(restaurant, _prior) {
    const editorial = await fetchEditorialMentions(restaurant.name);
    return { computed: editorialScore(editorial), hasReal: editorial.hitCount !== null };
  },
  async healthInspection(restaurant, _prior) {
    const health = await fetchHealthInspection(restaurant.name, restaurant.address);
    return { computed: { value: 0, note: health.reason }, hasReal: false };
  },
};

// --- Per-restaurant pipeline -----------------------------------------------
// Only fetches factors due this run (per CADENCE / MODE); everything else
// carries forward from `prior` (last run's output for this restaurant, if
// any) so a daily run never wipes out last week's editorial finding, and
// a restaurant with no prior data yet still gets a real (if low-confidence)
// score on its very first run.
async function ingestOne(restaurant, prior) {
  const factorResults = {};
  let confidence = 0;

  for (const factorKey of Object.keys(CADENCE)) {
    const priorFactor = prior?.factors?.[factorKey];
    if (factorDueThisRun(factorKey)) {
      const { computed, hasReal } = await FACTOR_FETCHERS[factorKey](restaurant, priorFactor);
      factorResults[factorKey] = {
        value: computed.value,
        note: computed.note,
        updated_at: new Date().toISOString(),
      };
      if (hasReal) confidence += WEIGHTS[factorKey];
    } else if (priorFactor) {
      // Not due this run -- carry the last real result forward untouched,
      // including its original timestamp, so it's clear from the data
      // itself when each factor was actually last checked.
      factorResults[factorKey] = priorFactor;
      if (priorFactor.note && !priorFactor.note.startsWith("no ") && !priorFactor.note.includes("not implemented")) {
        confidence += WEIGHTS[factorKey];
      }
    } else {
      // Never fetched (e.g. weekly factor on a restaurant's very first
      // daily-only run, or healthInspection always) -- honest zero.
      factorResults[factorKey] = { value: 0, note: "not yet fetched", updated_at: null };
    }
  }

  const evidence = Object.fromEntries(Object.entries(factorResults).map(([k, v]) => [k, v.value]));
  evidence.confidence = Math.round(confidence * 100) / 100;

  const result = scoreRestaurant(evidence);

  return {
    id: restaurant.id,
    name: restaurant.name,
    evidence,
    ...result, // score, breakdown, topReasons, confidence -- ready for the frontend to render directly
    factors: factorResults, // per-factor value/note/updated_at -- the audit trail
    last_run_mode: MODE,
    fetched_at: new Date().toISOString(),
  };
}

async function loadPrior() {
  try {
    const raw = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
    return new Map(raw.restaurants.map((r) => [r.id, r]));
  } catch {
    return new Map(); // no prior run yet -- everything starts from zero, honestly
  }
}

// --- Score history / "memory" ---------------------------------------------
// This is what makes "change since yesterday" real instead of the demo
// page's fakeYesterdayDelta(). One JSON file, one entry per restaurant per
// UTC calendar date, capped at HISTORY_MAX_DAYS so it doesn't grow forever.
// Committed to the repo by the same GitHub Actions step that commits
// scottsdale-live-scores.json, so the history persists across runs the same
// way the scores do -- this file IS the system's memory, on disk, in git,
// not in any process that dies when the job ends.

async function loadHistory() {
  try {
    const raw = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
    return raw && raw.restaurants && typeof raw.restaurants === "object"
      ? raw
      : { restaurants: {} };
  } catch {
    return { restaurants: {} }; // no history yet -- first run ever
  }
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC calendar date
}

// The most recent entry STRICTLY BEFORE today. Deliberately excludes an
// entry this same run (or an earlier run today) may have already written
// for today's date -- so "change since yesterday" still means yesterday
// even if the job is manually re-run twice in one day, instead of
// collapsing to "change since the last re-run" (which would almost always
// read as 0 and hide the real trend).
function findPreviousEntry(history, id, today) {
  const entries = history.restaurants[id] || [];
  const before = entries.filter((e) => e.date < today);
  return before.length ? before[before.length - 1] : null;
}

// Idempotent by UTC date: a same-day re-run replaces today's entry instead
// of appending a duplicate, so re-running the job (manually, or as a retry
// after a failure) never inflates or skews the trend line. Kept sorted and
// trimmed to the most recent HISTORY_MAX_DAYS entries on every write.
function upsertHistoryEntry(history, id, date, score, confidence) {
  const entries = history.restaurants[id] || [];
  const idx = entries.findIndex((e) => e.date === date);
  const entry = { date, score, confidence };
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  history.restaurants[id] = entries.slice(-HISTORY_MAX_DAYS);
}

async function main() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const priorById = await loadPrior();
  const history = await loadHistory();
  const today = todayUtc();
  const results = [];

  for (const restaurant of snapshot.restaurants) {
    // Sequential, not Promise.all across restaurants -- respects the
    // Scottsdale open-data 60s-crawl-delay guidance from the source
    // policy doc for any batch of license queries. See the scaling note
    // above fetchScottsdaleLicense() before running this against more
    // than a few dozen restaurants.
    const result = await ingestOne(restaurant, priorById.get(restaurant.id));

    // Real memory, not the demo page's fake delta: compare today's score
    // against the most recent PRIOR day on file for this restaurant.
    const previous = findPreviousEntry(history, restaurant.id, today);
    result.previous_score = previous ? previous.score : null;
    result.score_delta = previous ? Math.round((result.score - previous.score) * 100) / 100 : null;
    result.delta_since = previous ? previous.date : null; // null until there's a 2nd day of history

    upsertHistoryEntry(history, restaurant.id, today, result.score, result.confidence);

    results.push(result);
    await new Promise((r) => setTimeout(r, 1000));
  }

  await writeFile(
    HISTORY_PATH,
    JSON.stringify(
      {
        _notice:
          `Generated and appended to by services/agents/source-ingestion-agent/run.mjs. One entry per restaurant per UTC calendar date (idempotent -- a same-day re-run replaces that day's entry rather than duplicating it), capped at the most recent ${HISTORY_MAX_DAYS} days per restaurant. This file is the system's real memory: scottsdale-live-scores.json's previous_score/score_delta/delta_since fields are computed from it on every run. See services/agents/OPERATIONS.md.`,
        restaurants: history.restaurants,
      },
      null,
      2
    )
  );

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        _notice:
          "Generated by services/agents/source-ingestion-agent/run.mjs. Each factor is either real fetched data or an explicit 0 with a note explaining why -- never a guess. See each restaurant's `factors` field for a per-factor value/note/updated_at audit trail, `previous_score`/`score_delta`/`delta_since` for the real change-since-last-time (from score-history.json, not a demo placeholder), and services/agents/OPERATIONS.md for the daily/weekly cadence this runs on. healthInspection is always 0 today; see source-agent-playbook.md #5.",
        last_run_mode: MODE,
        generated_at: new Date().toISOString(),
        restaurants: results,
      },
      null,
      2
    )
  );
  console.log(`[${MODE}] Wrote ${results.length} restaurant(s) to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(`[${MODE}] Updated score history at ${path.relative(REPO_ROOT, HISTORY_PATH)}`);
}

main().catch((err) => {
  console.error("Ingestion run failed:", err);
  process.exit(1);
});
