/**
 * Public Trust Rank — Restaurant Scoring Engine (v3)
 *
 * Pure function. No network calls, no side effects, no paid-placement input
 * of any kind — there is no `paid`, `sponsored`, or `boost` field anywhere
 * below, so there is nothing for a sales team to plug a payment into later
 * without editing this file (kept small on purpose, so that edit is easy
 * to spot in review).
 *
 * SOURCE HISTORY: v1 had six factors, two of which (review authenticity,
 * reservation demand) had no legal data source once checked — Yelp's API
 * terms explicitly ban this business model, OpenTable has no public API.
 * v2 dropped to five factors, all verified-legal. v3 adds a sixth: a city
 * government open-data business-license record, confirmed accessible
 * (data.scottsdaleaz.gov, robots.txt checked directly — only blocks
 * admin/session paths, asks for a 60s crawl delay). See
 * docs/source-policy/approved-sources.md for the full verification trail,
 * including sources checked and NOT added (BBB, AZ liquor license lookup,
 * reservation/live-popularity data via OpenTable or Google's undocumented
 * "popular times" endpoints) because they didn't clear the same bar. A
 * restaurant's own self-published reviews are handled the same way: cited
 * as content, never a WEIGHTS entry, because a business choosing its own
 * praise isn't independent evidence.
 *
 * Input: normalized evidence per restaurant, each factor 0–1, produced by
 * the ingestion layer from real source data. This file does not know or
 * care where the evidence came from — seed JSON today, a real API call
 * tomorrow, same function either way.
 *
 * UNVERIFIED vs. MEASURED-LOW, and why the score is renormalized:
 * A factor the pipeline has never actually verified for this restaurant
 * (health inspection has no automated source yet; editorial mentions
 * hasn't reached this restaurant's weekly rotation slot) comes in as
 * `null`/`undefined` -- not 0. A factor that WAS checked and genuinely
 * came back low (a real Google rating of 2.9, a real Custom Search that
 * found zero press mentions) is a real number, including a real 0, and
 * counts normally. The score is the weighted average over only the
 * factors that are actually known, renormalized against the weight that's
 * covered -- an unfetched factor is excluded from the math entirely, not
 * counted as the worst possible outcome. A restaurant should never score
 * lower because OUR data pipeline hasn't reached a factor yet; that gap
 * belongs in the confidence badge and the "why this score" text (see
 * explain() below), not baked into the number as a penalty. The real
 * tradeoff, worth knowing: an early score based on partial coverage can
 * move (usually down) once a currently-unknown factor gets verified for
 * the first time -- that's the honest cost of not guessing, not a bug.
 *
 * Output: a score from 50 (floor) to 100, plus a breakdown and a short list
 * of plain-language reasons, so every number on screen is explainable back
 * to its inputs.
 */

export const WEIGHTS = Object.freeze({
  googleRating: 0.26,        // Google Places API: star rating, normalized 0-5 -> 0-1
  reviewVolume: 0.16,        // Google Places API: user_ratings_total, normalized within market
  healthInspection: 0.18,    // County health department inspection score/grade (public record)
  licenseVerified: 0.14,     // City open-data business license: active + tenure (public record)
  siteFreshness: 0.12,       // Business's own public website: menu/hours/content activity
  editorialMentions: 0.14,   // Press/editorial coverage via Google Custom Search JSON API
});

export const FACTOR_LABELS = Object.freeze({
  googleRating: "Google rating",
  reviewVolume: "Public review volume",
  healthInspection: "Health inspection record",
  licenseVerified: "Verified business license",
  siteFreshness: "Site & menu freshness",
  editorialMentions: "Editorial coverage",
});

export const FACTOR_SOURCES = Object.freeze({
  googleRating: "Google Places API",
  reviewVolume: "Google Places API",
  healthInspection: "County health department public inspection records",
  licenseVerified: "City open-data business license record",
  siteFreshness: "Business's own public website",
  editorialMentions: "Google Custom Search JSON API (press, editorial, and local news coverage)",
});

const FLOOR = 50;
const CEILING = 100;

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * @param {Object} evidence - factor -> 0..1, missing factors count as 0
 * @param {number} [evidence.confidence] - optional 0..1, coverage of the
 *   evidence set; low confidence doesn't change the score but is surfaced
 *   to the UI so a thin-data listing isn't presented with false precision.
 * @returns {{score: number, breakdown: Object, topReasons: string[], confidence: number}}
 */
export function scoreRestaurant(evidence = {}) {
  const breakdown = {};
  let weightedSum = 0;
  let knownWeight = 0; // sum of weights actually backed by verified evidence

  for (const [factor, weight] of Object.entries(WEIGHTS)) {
    const raw = evidence[factor];
    const known = raw !== null && raw !== undefined;
    const value = known ? clamp01(raw) : null;
    breakdown[factor] = { value, weight, known, contribution: known ? value * weight : 0 };
    if (known) {
      weightedSum += value * weight;
      knownWeight += weight;
    }
  }

  // Renormalized average over known factors only -- see the file header
  // for why. knownWeight === 0 (nothing verified yet at all) floors at 50
  // rather than dividing by zero.
  const normalizedAvg = knownWeight > 0 ? weightedSum / knownWeight : 0;
  const score = Math.round(FLOOR + normalizedAvg * (CEILING - FLOOR));
  // Prefer the ingestion layer's own confidence (identical coverage
  // computation, kept in sync deliberately) and fall back to knownWeight
  // here for any evidence object that doesn't carry one.
  const confidence = clamp01(evidence.confidence ?? knownWeight);
  const topReasons = explain(breakdown, evidence);

  return { score, breakdown, topReasons, confidence };
}

/**
 * Turns the breakdown into 2–3 short, factual reasons — the "why this
 * score" the UI shows on every card. No essay-length text: this is the
 * explicit rule from the product brief, enforced here so the UI layer
 * can't accidentally regress into a wall of text.
 */
function explain(breakdown, evidence) {
  const entries = Object.entries(breakdown).map(([factor, b]) => ({ factor, ...b }));
  const known = entries.filter((b) => b.known).sort((a, b) => b.contribution - a.contribution);
  const unknown = entries.filter((b) => !b.known);

  const reasons = [];

  // Disclosure comes first and is never bumped by the slice(0, 3) below --
  // this is the one line that directly answers "why isn't this restaurant
  // being judged on all six factors," so it doesn't lose a slot to a
  // "strong signal" callout that's less important to understand the score.
  if (unknown.length) {
    const labels = unknown.map((b) => FACTOR_LABELS[b.factor]).join(" and ");
    reasons.push(
      `${labels} not yet verified — score reflects the ${known.length} of ${entries.length} signals that are (unverified factors aren't counted against it).`
    );
  }

  if (known.length === 0) {
    reasons.push("No signals verified yet — this restaurant hasn't been reached by the pipeline.");
    return reasons.slice(0, 3);
  }

  const strongest = known[0];
  const weakest = known[known.length - 1];

  if (strongest.value >= 0.7) {
    reasons.push(`${FACTOR_LABELS[strongest.factor]} is strong (${Math.round(strongest.value * 100)}%).`);
  }
  if (evidence.healthInspection != null && evidence.healthInspection >= 0.85) {
    reasons.push("Clean recent health inspection record.");
  }
  if (evidence.licenseVerified != null && evidence.licenseVerified >= 0.9) {
    reasons.push("Verified, active city business license.");
  }
  if (weakest.value <= 0.35 && weakest.factor !== strongest.factor) {
    reasons.push(`${FACTOR_LABELS[weakest.factor]} is the weakest verified signal (${Math.round(weakest.value * 100)}%).`);
  }
  if (reasons.length === 0) {
    reasons.push("Signals are steady across the board — no single factor is driving the score.");
  }
  return reasons.slice(0, 3);
}

// Minimal self-test — run directly with `node scoring.mjs`.
// Guarded for browser use: this module is imported by apps/consumer-web/app.js,
// where `process` does not exist, so the guard must not reference it directly.
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const sample = {
    googleRating: 0.9,
    reviewVolume: 0.7,
    healthInspection: 0.95,
    licenseVerified: 1.0,
    siteFreshness: 0.5,
    editorialMentions: 0.4,
    confidence: 0.8,
  };
  console.log(JSON.stringify(scoreRestaurant(sample), null, 2));
}
