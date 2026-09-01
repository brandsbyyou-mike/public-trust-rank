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

  for (const [factor, weight] of Object.entries(WEIGHTS)) {
    const value = clamp01(evidence[factor]);
    breakdown[factor] = { value, weight, contribution: value * weight };
    weightedSum += value * weight;
  }

  const score = Math.round(FLOOR + weightedSum * (CEILING - FLOOR));
  const confidence = clamp01(evidence.confidence ?? 0.75);
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
  const ranked = Object.entries(breakdown)
    .map(([factor, b]) => ({ factor, ...b }))
    .sort((a, b) => b.contribution - a.contribution);

  const reasons = [];
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];

  if (strongest.value >= 0.7) {
    reasons.push(`${FACTOR_LABELS[strongest.factor]} is strong (${Math.round(strongest.value * 100)}%).`);
  }
  if (evidence.healthInspection !== undefined && evidence.healthInspection >= 0.85) {
    reasons.push("Clean recent health inspection record.");
  }
  if (evidence.licenseVerified !== undefined && evidence.licenseVerified >= 0.9) {
    reasons.push("Verified, active city business license.");
  }
  if (weakest.value <= 0.35) {
    reasons.push(`${FACTOR_LABELS[weakest.factor]} is the weakest signal (${Math.round(weakest.value * 100)}%).`);
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
