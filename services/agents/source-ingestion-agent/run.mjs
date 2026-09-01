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
 *   - editorialMentions: WEEKLY, ROTATED across the roster (a news feature
 *     is a rare event -- checking it daily buys nothing a weekly check
 *     doesn't). Custom Search's free tier is 100 queries/day; once the
 *     roster is bigger than that, checking every restaurant in one weekly
 *     run would blow the free tier, so each weekly run only checks a
 *     rotating slice of the roster (see CSE_DAILY_BUDGET below) -- every
 *     restaurant still gets refreshed, just roughly monthly instead of
 *     weekly once the roster is large. Below the budget, rotation collapses
 *     to "everyone, every week," same as before.
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
 *   GOOGLE_PLACES_API_KEY   -- Google Places API (New): rating, review count,
 *                              place ID resolution, AND (weekly) review text
 *                              for dish-mention extraction -- see below
 *   GOOGLE_CSE_KEY          -- Google Custom Search JSON API key
 *   GOOGLE_CSE_CX           -- Custom Search Engine ID (configure it to
 *                              search the open web, not a restricted set)
 *
 * No key required for the Scottsdale business-license lookup -- that's a
 * public ArcGIS endpoint, confirmed accessible, found the way the
 * playbook describes.
 *
 * DISH MENTIONS -- what this is and the legal line it stays inside:
 * Every WEEKLY run also fetches each restaurant's up-to-5 "most relevant"
 * Google reviews (Places API (New) Place Details, field mask "reviews" --
 * that 5-review cap is Google's own limit, not something more engineering
 * gets past; there is no endpoint that returns "all" reviews, same reason
 * a Yelp scraper was ruled out in docs/source-policy/approved-sources.md).
 * Those review texts are scanned in-memory against DISH_LEXICON below,
 * tallied into a small `dish_mentions` array (term, count, avg star rating
 * from the reviews that mentioned it), and the raw review text is then
 * DISCARDED -- never written to disk, never committed. This matters
 * because Google's Maps Platform Service Terms only carve out two caching
 * exceptions: place_id (indefinite) and lat/lng (30 days). Everything else
 * from the Places API, review text included, falls under "must not
 * pre-fetch, cache, or store... beyond the allowed exceptions" -- so
 * committing raw review text into this repo daily would be a real ToS
 * violation baked permanently into git history. Storing only our own
 * derived counts (not Google's content itself) is what keeps this legal.
 * This is deliberately "explanation only," not a 7th scoring factor --
 * scoreRestaurant()'s six weighted factors are untouched by dish_mentions;
 * it exists to make "why this score" more specific per restaurant, and to
 * let a future feature answer "which restaurant's reviews mention the best
 * spaghetti" by querying dish_mentions directly instead of re-deriving
 * this extraction from scratch.
 */

// A small, deliberately extensible keyword list -- not exhaustive, easy to
// grow. Add a term here and it starts getting tracked on the next weekly
// run, no other code changes needed. Keep terms lowercase, singular where
// natural (matching is substring-based against lowercased review text).
const DISH_LEXICON = Object.freeze([
  "steak", "ribeye", "filet", "burger", "wings", "pizza", "pasta",
  "spaghetti", "ramen", "sushi", "tacos", "salad", "salmon", "shrimp",
  "lobster", "risotto", "gnocchi", "carbonara", "tiramisu", "cheesecake",
  "dessert", "cocktail", "wine list", "brunch", "service", "wait time",
]);

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WEIGHTS, scoreRestaurant } from "../../ranking-engine/scoring.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "data/real-pilot/scottsdale-real-snapshot.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "data/real-pilot/scottsdale-live-scores.json");
const HISTORY_PATH = path.join(REPO_ROOT, "data/real-pilot/score-history.json");
const LEDGER_PATH = path.join(REPO_ROOT, "data/real-pilot/api-usage-ledger.json");
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

// Custom Search's free tier is 100 queries/day. Keep real headroom under
// that (manual re-runs, a slightly larger roster next month) rather than
// designing right up against the cap.
const CSE_DAILY_BUDGET = 80;

const MODE = (process.argv[2] || "daily").toLowerCase();
if (!["daily", "weekly", "all"].includes(MODE)) {
  console.error(`Unknown mode "${MODE}" -- use "daily", "weekly", or "all".`);
  process.exit(1);
}
function factorDueThisRun(factorKey) {
  if (MODE === "all") return CADENCE[factorKey] !== "unimplemented";
  return CADENCE[factorKey] === MODE;
}

// --- Editorial-mentions rotation --------------------------------------
// How many weekly buckets the roster needs to keep each week's Custom
// Search usage under CSE_DAILY_BUDGET. A roster at or under the budget
// needs just 1 bucket -- everyone, every week, same behavior as before
// this existed.
function bucketCountFor(totalRestaurants) {
  return Math.max(1, Math.ceil(totalRestaurants / CSE_DAILY_BUDGET));
}

// A stable "which week is it" counter -- days-since-epoch / 7, not a
// calendar ISO week number, so it doesn't need any date-library edge-case
// handling and still advances by exactly 1 every 7 days regardless of
// when the job happens to run.
function currentRotationIndex(bucketCount) {
  const weekIndex = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return weekIndex % bucketCount;
}

// Deterministic hash of a restaurant's id into [0, bucketCount) -- stable
// across runs (same id always lands in the same bucket ordering), so
// "which week does this restaurant get checked" is predictable and every
// bucket gets a roughly even share of the roster.
function restaurantBucket(id, bucketCount) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % bucketCount;
}

// --- Budget guard -----------------------------------------------------
// This project's entire cost model is "$0/month, always" -- see
// docs/launch/go-live-cheap.md. That's a promise, not just a hope, so it's
// backed by code, not just careful math: every real call to a metered
// Google API (Places Text Search, Places Details, Custom Search) goes
// through here FIRST. If a call would push this run, or this month's
// running total, past a hard ceiling set safely below the actual free-tier
// limit, the guard throws BEFORE the network call happens -- the run stops
// immediately, nothing further is fetched, and (because run.mjs then exits
// non-zero) the GitHub Actions commit step never runs, so no partial or
// runaway output ever gets published. Yesterday's good data just stays live
// until a human looks at why it tripped. This is deliberately a hard stop,
// not a warning: a bug that causes repeated/looping calls should cost
// nothing, ever, not "cost a little before someone notices."
//
// Two layers:
//   1. Per-run sanity caps, sized to what a normal run should ever need
//      (roughly one call per restaurant, plus a small buffer) -- this is
//      what actually catches "something is looping/retrying and won't
//      stop," which a monthly total alone wouldn't catch fast enough.
//   2. Persistent monthly/daily ledger (data/real-pilot/api-usage-ledger.json,
//      committed alongside the scores on every successful run) -- this is
//      what "we always know exactly how many calls have been made" means
//      in practice: it's a real file in git history, not a claim.
const PLACES_TEXT_SEARCH_MONTHLY_CAP = 9000; // 10,000 free; margin for a mid-month key rotation or manual re-runs
const PLACES_DETAILS_MONTHLY_CAP = 9000; // same margin, separate free-tier bucket
const CUSTOM_SEARCH_DAILY_CAP = 90; // 100 free/day; the rotation system (CSE_DAILY_BUDGET) should never even approach this

class BudgetGuardError extends Error {
  constructor(apiType, made, cap, period) {
    super(`BUDGET GUARD: ${apiType} would exceed its ${period} cap (${made + 1} > ${cap}). Stopping the run now -- zero further calls, nothing partial gets committed.`);
    this.name = "BudgetGuardError";
    this.apiType = apiType;
  }
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function loadLedger() {
  try {
    const raw = JSON.parse(await readFile(LEDGER_PATH, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

// Creates the in-run budget guard. `perRunCaps` are the sanity ceilings for
// THIS run (sized off the roster count by the caller); the ledger's
// monthly/daily totals are the second, independent ceiling.
function makeBudgetGuard(ledger, perRunCaps) {
  const monthKey = currentMonthKey();
  const dayKey = todayUtc();
  const perRunCounts = { placesTextSearch: 0, placesDetails: 0, customSearch: 0 };

  const monthlyState = (apiType) => {
    const entry = ledger[apiType];
    if (!entry || entry.period !== monthKey) return { period: monthKey, count: 0 };
    return entry;
  };
  const dailyState = (apiType) => {
    const entry = ledger[apiType];
    if (!entry || entry.period !== dayKey) return { period: dayKey, count: 0 };
    return entry;
  };

  function charge(apiType) {
    perRunCounts[apiType] += 1;
    if (perRunCounts[apiType] > perRunCaps[apiType]) {
      throw new BudgetGuardError(apiType, perRunCounts[apiType] - 1, perRunCaps[apiType], "per-run");
    }

    if (apiType === "customSearch") {
      const state = dailyState(apiType);
      state.count += 1;
      if (state.count > CUSTOM_SEARCH_DAILY_CAP) {
        throw new BudgetGuardError(apiType, state.count - 1, CUSTOM_SEARCH_DAILY_CAP, "daily");
      }
      ledger[apiType] = state;
    } else {
      const cap = apiType === "placesDetails" ? PLACES_DETAILS_MONTHLY_CAP : PLACES_TEXT_SEARCH_MONTHLY_CAP;
      const state = monthlyState(apiType);
      state.count += 1;
      if (state.count > cap) {
        throw new BudgetGuardError(apiType, state.count - 1, cap, "monthly");
      }
      ledger[apiType] = state;
    }
  }

  return { charge, perRunCounts };
}

async function saveLedger(ledger) {
  await writeFile(
    LEDGER_PATH,
    JSON.stringify(
      {
        _notice:
          "Real, persistent record of metered Google API calls made by services/agents/source-ingestion-agent/run.mjs, kept so the budget guard (see the comment above BudgetGuardError in run.mjs) always knows exactly how many calls have been made against each free tier. Only updated on a run that completes successfully -- a run the guard stops mid-way exits non-zero without committing anything, so old data (including this ledger) stays exactly as it was until a human checks why. placesTextSearch/placesDetails reset monthly; customSearch resets daily.",
        ...ledger,
        updated_at: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

// --- Google Places -----------------------------------------------------
// Places API (New): one Text Search call to resolve the place, then read
// rating + userRatingCount straight off the result. No separate Details
// call needed for just these two fields, which keeps the free-tier
// budget small (see docs/launch/go-live-cheap.md for the actual cost).
async function fetchGooglePlaces(name, address, guard) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const empty = { rating: null, reviewCount: null, placeId: null, lat: null, lng: null };
  if (!key) return { ...empty, reason: "no GOOGLE_PLACES_API_KEY set" };

  guard.charge("placesTextSearch"); // throws and stops the whole run if this would exceed a budget cap -- see the Budget guard comment above

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // location added alongside rating/userRatingCount/id -- same call,
        // zero extra API cost, and gives every restaurant (curated by hand
        // or discovered via discover-restaurants.mjs, which doesn't pull
        // coordinates) a real geocoded position instead of a hand-picked
        // neighborhood-center approximation. Google's terms allow caching
        // lat/lng up to 30 days; refreshing it daily here is well inside that.
        "X-Goog-FieldMask": "places.rating,places.userRatingCount,places.id,places.location",
      },
      body: JSON.stringify({ textQuery: `${name}, ${address}` }),
    });
    if (!res.ok) return { ...empty, reason: `Places API HTTP ${res.status}` };
    const json = await res.json();
    const place = json.places?.[0];
    if (!place) return { ...empty, reason: "no place match" };
    return {
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      placeId: place.id ?? null, // cacheable indefinitely per Places API policy -- see resolvePlaceId() below
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      reason: null,
    };
  } catch (err) {
    return { ...empty, reason: `fetch failed: ${err.message}` };
  }
}

// googleRating and reviewVolume both need the same Text Search result --
// they used to each call fetchGooglePlaces() independently, silently
// doubling the Places Text Search cost of every daily run for no reason.
// This caches the one call per restaurant per run in `context` so both
// factors, and place-id resolution below, share it.
async function getPlaces(restaurant, context) {
  if (!context.placesResult) {
    context.placesResult = await fetchGooglePlaces(restaurant.name, restaurant.address, context.guard);
  }
  return context.placesResult;
}

// place_id is the ONE Places API value Google's terms allow caching
// indefinitely (see the DISH MENTIONS comment up top), so once a
// restaurant has one on file, never re-resolve it via another Text Search
// call -- just reuse it. Falls back to the shared Places result above when
// one was already fetched this run (daily factors ran first), and only
// issues a fresh Text Search of its own when neither exists yet (a
// restaurant's very first run, on a weekly-only invocation).
async function resolvePlaceId(restaurant, priorPlaceId, context) {
  if (priorPlaceId) return { placeId: priorPlaceId, reason: null };
  // A restaurant added via discover-restaurants.mjs already carries the
  // place_id Nearby Search found for it -- skip a redundant Text Search
  // and just confirm it once by using it. (Only relevant on a restaurant's
  // very first run, same as the priorPlaceId case above.)
  if (restaurant.place_id) return { placeId: restaurant.place_id, reason: null };
  const places = await getPlaces(restaurant, context);
  return { placeId: places.placeId, reason: places.placeId ? null : places.reason };
}

// --- Reviews / dish mentions (Google Places Details) -- WEEKLY cadence ----
// Up to 5 reviews per place -- Google's own cap, not ours. Review text is
// used in-memory only by extractDishMentions() below and never returned
// from this function or written anywhere; see the legal note at the top
// of this file for why that matters.
async function fetchPlaceReviews(placeId, guard) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { reviews: null, reason: "no GOOGLE_PLACES_API_KEY set" };
  if (!placeId) return { reviews: null, reason: "no place_id resolved yet" };

  guard.charge("placesDetails"); // see the Budget guard comment above fetchGooglePlaces()

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "reviews.text,reviews.rating",
      },
    });
    if (!res.ok) return { reviews: null, reason: `Place Details HTTP ${res.status}` };
    const json = await res.json();
    return { reviews: json.reviews ?? [], reason: null };
  } catch (err) {
    return { reviews: null, reason: `fetch failed: ${err.message}` };
  }
}

// Deterministic keyword scan, no LLM call -- matches this project's
// existing "deterministic and cheap" rule for anything that doesn't need
// a model (see services/agents/README.md's explanation-agent note). A
// review's own star rating stands in for sentiment on whatever dish terms
// it mentions -- simpler and more defensible than sentence-level sentiment
// guessing, and it's a real signal Google already collected. Returns
// derived counts only; the `reviews` array passed in is never persisted
// by the caller.
function extractDishMentions(reviews) {
  const tally = new Map(); // term -> { mentions, ratingSum }
  for (const review of reviews) {
    const text = (review.text?.text || "").toLowerCase();
    const rating = review.rating ?? null;
    if (!text) continue;
    for (const term of DISH_LEXICON) {
      if (text.includes(term)) {
        const entry = tally.get(term) || { mentions: 0, ratingSum: 0, ratingCount: 0 };
        entry.mentions += 1;
        if (rating !== null) {
          entry.ratingSum += rating;
          entry.ratingCount += 1;
        }
        tally.set(term, entry);
      }
    }
  }
  return [...tally.entries()]
    .map(([term, e]) => ({
      term,
      mentions: e.mentions,
      avg_rating: e.ratingCount ? Math.round((e.ratingSum / e.ratingCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

// --- Scottsdale business license (bulk, whole-dataset) --------------------
// Endpoint found via the ArcGIS item-metadata trick in the playbook, not
// the dataset's own landing page. No key needed -- public data.
//
// This used to be one LIKE-based query PER RESTAURANT. Two real problems
// with that, found while scaling the roster past a handful of restaurants:
//   1. The dataset (confirmed by reading the layer's own schema directly)
//      has no category/NAICS/business-type field -- "Company" and address
//      are the only usable fields, so a per-restaurant name-fragment query
//      was always going to be the matching strategy, bulk or not.
//   2. The per-restaurant loop only paused 1 second between queries, while
//      docs/source-policy/approved-sources.md documents this endpoint's
//      robots.txt asking for a 60-second crawl delay. That was already
//      non-compliant with our own documented policy at 7 restaurants, not
//      just a scaling problem -- it just hadn't been audited yet.
// Fix: pull the whole dataset ONCE per run via a handful of paginated
// queries (maxRecordCount is 1000, confirmed against the layer's own
// metadata -- not the 2,000 this comment used to guess), with a genuine
// 60-second pause between pages, then match every restaurant against it
// locally, in memory, with zero further network calls. ~19,800 records /
// 1,000 per page is ~20 pages (~20 minutes once per daily run) -- a fixed
// cost that stays the same whether the roster is 7 restaurants or 800,
// instead of growing with it.
const LICENSE_PAGE_SIZE = 1000;
const LICENSE_CRAWL_DELAY_MS = 60000; // honors the documented 60s crawl-delay ask, for real this time

async function fetchAllScottsdaleLicenses() {
  const records = [];
  let offset = 0;
  for (;;) {
    const url =
      `${SCOTTSDALE_LICENSE_ENDPOINT}?where=1%3D1` +
      `&outFields=Company,AcctStatus,ServAddrComp,BusinessStartDate` +
      `&orderByFields=OBJECTID&resultRecordCount=${LICENSE_PAGE_SIZE}&resultOffset=${offset}&f=json`;
    let features;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`License bulk fetch: page at offset ${offset} failed with HTTP ${res.status} -- stopping with ${records.length} record(s) collected so far`);
        break;
      }
      const json = await res.json();
      if (json.error) {
        console.error(`License bulk fetch: page at offset ${offset} returned an error (${json.error.message || "unknown"}) -- stopping with ${records.length} record(s) collected so far`);
        break;
      }
      features = json.features ?? [];
    } catch (err) {
      console.error(`License bulk fetch: page at offset ${offset} failed: ${err.message} -- stopping with ${records.length} record(s) collected so far`);
      break;
    }
    for (const f of features) if (f.attributes) records.push(f.attributes);
    if (features.length < LICENSE_PAGE_SIZE) break; // last page
    offset += LICENSE_PAGE_SIZE;
    await new Promise((r) => setTimeout(r, LICENSE_CRAWL_DELAY_MS));
  }
  return records;
}

// Same matching heuristic as before (a name-fragment match alone is not
// reliable -- 17 unrelated "MISSION" businesses came back in manual
// testing during this pilot's original build -- so every match is
// confirmed by street address too), just run against the in-memory bulk
// dataset instead of a live per-restaurant query.
function matchScottsdaleLicense(records, name, address) {
  const nameGuess = name.split(/[’']/)[0].split(" ")[0].toUpperCase(); // crude but matches how "MISSION" found "THE MISSION RESTAURANT"
  const streetFragment = address.split(",")[0].toUpperCase().replace(/\bAVE\b/, "AV").replace(/\bRD\b/, "RD");
  const streetToken = streetFragment.split(" ")[0];

  const match = records.find(
    (r) =>
      (r.Company || "").toUpperCase().includes(nameGuess) &&
      (r.ServAddrComp || "").toUpperCase().includes(streetToken)
  );
  if (!match) return { active: null, yearsActive: null, reason: "no address-confirmed match" };

  const active = match.AcctStatus === "Active";
  const startMs = match.BusinessStartDate;
  const yearsActive = startMs ? (Date.now() - startMs) / (365.25 * 24 * 3600 * 1000) : null;
  return { active, yearsActive, reason: null };
}

// --- Editorial mentions (Google Custom Search) -- WEEKLY cadence ---------
async function fetchEditorialMentions(name, guard) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return { hitCount: null, reason: "no GOOGLE_CSE_KEY/GOOGLE_CSE_CX set" };

  guard.charge("customSearch"); // see the Budget guard comment above fetchGooglePlaces()

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
// Each takes (restaurant, prior, context) -- context carries per-run shared
// state (the cached Places result, the bulk license dataset, the rotation
// bucket/index) so no factor re-fetches what another factor already has.
const FACTOR_FETCHERS = {
  async googleRating(restaurant, _prior, context) {
    const places = await getPlaces(restaurant, context);
    return { computed: ratingScore(places.rating), hasReal: places.rating !== null };
  },
  async reviewVolume(restaurant, _prior, context) {
    const places = await getPlaces(restaurant, context);
    return { computed: reviewVolumeScore(places.reviewCount), hasReal: places.reviewCount !== null };
  },
  async licenseVerified(restaurant, _prior, context) {
    const license = matchScottsdaleLicense(context.licenseRecords, restaurant.name, restaurant.address);
    return { computed: licenseScore(license), hasReal: license.active !== null };
  },
  async siteFreshness(restaurant, _prior, _context) {
    const freshness = await fetchSiteFreshness(restaurant.website);
    return { computed: freshnessScore(freshness), hasReal: freshness.daysSinceModified !== null };
  },
  async editorialMentions(restaurant, _prior, context) {
    const editorial = await fetchEditorialMentions(restaurant.name, context.guard);
    return { computed: editorialScore(editorial), hasReal: editorial.hitCount !== null };
  },
  async healthInspection(restaurant, _prior, _context) {
    const health = await fetchHealthInspection(restaurant.name, restaurant.address);
    return { computed: { value: 0, note: health.reason }, hasReal: false };
  },
};

// --- Per-restaurant pipeline -----------------------------------------------
// Only fetches factors due this run (per CADENCE / MODE, with editorialMentions
// additionally gated by rotation -- see bucketCountFor()/currentRotationIndex()
// above); everything else carries forward from `prior` (last run's output for
// this restaurant, if any) so a daily run never wipes out last week's
// editorial finding, and a restaurant with no prior data yet still gets a
// real (if low-confidence) score on its very first run.
async function ingestOne(restaurant, prior, runContext) {
  const factorResults = {};
  let confidence = 0;
  const context = { licenseRecords: runContext.licenseRecords, guard: runContext.guard }; // per-restaurant scratch (e.g. placesResult cache)

  for (const factorKey of Object.keys(CADENCE)) {
    const priorFactor = prior?.factors?.[factorKey];
    const due =
      factorKey === "editorialMentions"
        ? (MODE === "weekly" || MODE === "all") &&
          restaurantBucket(restaurant.id, runContext.bucketCount) === runContext.rotationIndex
        : factorDueThisRun(factorKey);
    if (due) {
      const { computed, hasReal } = await FACTOR_FETCHERS[factorKey](restaurant, priorFactor, context);
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

  // place_id: resolve once, reuse forever (see resolvePlaceId() above).
  // Deliberately NOT part of `factors`/`evidence` -- it's plumbing to
  // reach reviews, not a scoring signal itself.
  const { placeId } = await resolvePlaceId(restaurant, prior?.place_id ?? null, context);

  // lat/lng: prefer a fresh geocoded position from today's Places lookup
  // (the same call googleRating/reviewVolume already made -- see
  // fetchGooglePlaces() -- zero extra API cost); otherwise carry the last
  // known real position forward; otherwise fall back to whatever the
  // snapshot itself provides (a hand-picked neighborhood-center
  // approximation for the original curated set, absent entirely for
  // restaurants added via discover-restaurants.mjs, which doesn't request
  // coordinates -- this is what backfills them for real, once a key is set).
  const freshPlaces = context.placesResult;
  const lat = freshPlaces?.lat ?? prior?.lat ?? restaurant.lat ?? null;
  const lng = freshPlaces?.lng ?? prior?.lng ?? restaurant.lng ?? null;
  const coordsSource =
    freshPlaces?.lat != null ? "google_places_geocoded" : prior?.lat != null ? "carried_forward" : restaurant.lat != null ? "snapshot_approx" : "none";

  // dish_mentions: WEEKLY only (a place's review mix doesn't meaningfully
  // shift day to day), carried forward untouched on days it's not due --
  // same carry-forward pattern as editorialMentions above.
  let dishMentions = prior?.dish_mentions ?? [];
  let dishMentionsUpdatedAt = prior?.dish_mentions_updated_at ?? null;
  let dishMentionsNote = prior?.dish_mentions_note ?? "not yet fetched";
  if ((MODE === "weekly" || MODE === "all") && placeId) {
    const { reviews, reason } = await fetchPlaceReviews(placeId, context.guard);
    if (reviews) {
      dishMentions = extractDishMentions(reviews); // raw `reviews` text goes out of scope right here -- never persisted
      dishMentionsUpdatedAt = new Date().toISOString();
      dishMentionsNote = reviews.length
        ? `scanned ${reviews.length} review(s) from Google's most-relevant set`
        : "no reviews returned by Places API";
    } else {
      dishMentionsNote = reason;
    }
  }

  return {
    id: restaurant.id,
    name: restaurant.name,
    evidence,
    ...result, // score, breakdown, topReasons, confidence -- ready for the frontend to render directly
    factors: factorResults, // per-factor value/note/updated_at -- the audit trail
    place_id: placeId, // cached indefinitely once resolved -- see resolvePlaceId()
    lat,
    lng,
    coords_source: coordsSource,
    dish_mentions: dishMentions, // derived counts only -- see the legal note atop this file
    dish_mentions_updated_at: dishMentionsUpdatedAt,
    dish_mentions_note: dishMentionsNote,
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

  // Bulk license dataset: fetched ONCE per run (not per restaurant), only
  // when licenseVerified is actually due this run -- see the comment above
  // fetchAllScottsdaleLicenses(). This is also where the real 60s-per-page
  // crawl delay lives now, not in the per-restaurant loop below.
  const licenseRecords = factorDueThisRun("licenseVerified")
    ? await fetchAllScottsdaleLicenses()
    : [];

  // Editorial-mentions rotation: figure out this run's bucket once, up
  // front, from the roster size -- see bucketCountFor()/currentRotationIndex().
  const bucketCount = bucketCountFor(snapshot.restaurants.length);
  const rotationIndex = currentRotationIndex(bucketCount);

  // Budget guard: per-run sanity caps sized to what THIS roster should ever
  // need in one run (one call per restaurant, plus a small buffer) -- see
  // the Budget guard comment above BudgetGuardError. Loaded from, and
  // (on a fully successful run only) saved back to, the persistent ledger.
  const ledger = await loadLedger();
  const guard = makeBudgetGuard(ledger, {
    placesTextSearch: snapshot.restaurants.length + 25,
    placesDetails: snapshot.restaurants.length + 10,
    customSearch: CUSTOM_SEARCH_DAILY_CAP,
  });

  const runContext = { licenseRecords, bucketCount, rotationIndex, guard };

  for (const restaurant of snapshot.restaurants) {
    // Sequential, not Promise.all -- basic courtesy to the per-restaurant
    // endpoints still hit here (each restaurant's own website, Google
    // Places). The Scottsdale license lookup no longer runs per restaurant
    // at all -- see fetchAllScottsdaleLicenses() above.
    const result = await ingestOne(restaurant, priorById.get(restaurant.id), runContext);

    // Real memory, not the demo page's fake delta: compare today's score
    // against the most recent PRIOR day on file for this restaurant.
    const previous = findPreviousEntry(history, restaurant.id, today);
    result.previous_score = previous ? previous.score : null;
    result.score_delta = previous ? Math.round((result.score - previous.score) * 100) / 100 : null;
    result.delta_since = previous ? previous.date : null; // null until there's a 2nd day of history

    upsertHistoryEntry(history, restaurant.id, today, result.score, result.confidence);

    results.push(result);
    await new Promise((r) => setTimeout(r, 250));
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
          "Generated by services/agents/source-ingestion-agent/run.mjs. Each factor is either real fetched data or an explicit 0 with a note explaining why -- never a guess. See each restaurant's `factors` field for a per-factor value/note/updated_at audit trail, `previous_score`/`score_delta`/`delta_since` for the real change-since-last-time (from score-history.json, not a demo placeholder), and services/agents/OPERATIONS.md for the daily/weekly cadence this runs on. healthInspection is always 0 today; see source-agent-playbook.md #5. editorialMentions checks a rotating slice of the roster each week once the roster is larger than Custom Search's free-tier budget, not every restaurant every week -- see CSE_DAILY_BUDGET in run.mjs; `factors.editorialMentions.updated_at` on each restaurant is the source of truth for when it was last actually checked. `dish_mentions` is a WEEKLY, NOT rotated (it runs on the separate Places Details free tier, which has far more headroom than Custom Search, so every restaurant gets it every week), derived-only summary of Google's up-to-5 most relevant reviews (term/mentions/avg_rating) -- it does NOT affect `score` (see the DISH MENTIONS comment atop run.mjs for the legal reason raw review text is never stored here).",
        last_run_mode: MODE,
        generated_at: new Date().toISOString(),
        restaurants: results,
      },
      null,
      2
    )
  );
  await saveLedger(ledger);

  console.log(`[${MODE}] Wrote ${results.length} restaurant(s) to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(`[${MODE}] Updated score history at ${path.relative(REPO_ROOT, HISTORY_PATH)}`);
  console.log(
    `[${MODE}] API calls this run -- placesTextSearch: ${guard.perRunCounts.placesTextSearch}, ` +
      `placesDetails: ${guard.perRunCounts.placesDetails}, customSearch: ${guard.perRunCounts.customSearch}`
  );
  console.log(
    `[${MODE}] Month/day-to-date -- placesTextSearch: ${ledger.placesTextSearch?.count ?? 0}/${PLACES_TEXT_SEARCH_MONTHLY_CAP} this month, ` +
      `placesDetails: ${ledger.placesDetails?.count ?? 0}/${PLACES_DETAILS_MONTHLY_CAP} this month, ` +
      `customSearch: ${ledger.customSearch?.count ?? 0}/${CUSTOM_SEARCH_DAILY_CAP} today`
  );
}

main().catch((err) => {
  if (err instanceof BudgetGuardError) {
    // Hard stop, by design -- see the Budget guard comment above
    // BudgetGuardError. Nothing partial gets written past this point:
    // OUTPUT_PATH/HISTORY_PATH/LEDGER_PATH are only written after the full
    // loop in main() completes, and this error unwinds out of that loop,
    // so none of those writes happen. Yesterday's committed data stays
    // exactly as it was.
    console.error(err.message);
  } else {
    console.error("Ingestion run failed:", err);
  }
  process.exit(1);
});
