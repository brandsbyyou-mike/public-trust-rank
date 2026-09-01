# Daily Ranking Spec — Restaurants (v3)

Source of truth: `services/ranking-engine/scoring.mjs`. This doc explains
it; if the two ever disagree, the code wins and this file is out of date.

## Version history

- **v1** — six factors, two (review authenticity, reservation demand) had
  no legal data source once checked.
- **v2** — five factors, all verified-legal (Google rating, review
  volume, health inspection, site freshness, editorial mentions).
- **v3** — added a sixth: a city open-data business-license record
  (`data.scottsdaleaz.gov`), confirmed accessible via its `robots.txt`.
  Also formally evaluated and rejected two more candidates (BBB, Arizona
  liquor license lookup) — see `docs/source-policy/approved-sources.md`
  for why.

## The formula

Score = 50 + (weighted sum of six 0–1 factors) × 50. Floor is hard-coded
at 50. Ceiling is 100.

| Factor | Weight | Source | What it measures |
|---|---|---|---|
| Google rating | 26% | Google Places API | Star rating, normalized 0–5 → 0–1 |
| Public review volume | 16% | Google Places API | `user_ratings_total`, normalized within the market |
| Health inspection record | 18% | County health dept. (public record) | Actual government safety inspection outcome — not a review |
| Verified business license | 14% | City open-data license record | Active, verifiable license + tenure — a civic legitimacy check |
| Site & menu freshness | 12% | Business's own website | Is the business's own public info actively maintained |
| Editorial coverage | 14% | Google Custom Search JSON API | Press, editorial, and local news station mentions outside review platforms |

Nothing in this list is pay-for-placement. There is no weight for ad
spend, subscription tier, or claimed-listing status — no field for it
exists in the evidence type.

Two of these factors — health inspection and verified license — are
government records, not opinions. That's the real differentiator: Google
and Yelp rank on sentiment; nothing mainstream ranks on "is this business
actually in good standing with the county and the city." Lead with that
in any pitch; it's true today, not aspirational.

## Two things deliberately left out, checked not skipped

- **A restaurant's own self-published reviews or testimonials.** Its own
  website is a source (site freshness), but content it chooses to publish
  about itself is never scored as sentiment — a business picking its own
  praise isn't independent evidence. It can be *shown* in the UI as
  context; it never touches `WEIGHTS`.
- **Reservation demand / live popularity ("how busy is it right now").**
  Checked directly: OpenTable's API requires an approved partnership, not
  self-serve access; Google has no official "popular times" field (only
  unofficial scrapers of Google's internal endpoints provide it, which
  carries the same terms-of-service risk as scraping Yelp). Neither
  clears the bar this project holds everything else to, so this stays a
  documented gap, not a placeholder value, until a real source exists.

## Public disclosure

`apps/consumer-web/sources.html` lists these source categories (used and
excluded) for anyone checking the ranking isn't biased. It's linked only
in small type in the corner of each page — available on request, not
marketed, so it doesn't read as a sales pitch about "how the algorithm
works" while still being honest that nothing here is hidden.

## Daily cadence

Once per business per day: pull new evidence for factors that source
supports → re-run `scoreRestaurant()` → store the new score plus the
evidence snapshot that produced it → compare to yesterday's score →
surface the delta and a 2–3 line explanation in the UI.

A score that doesn't move on a given day is a valid, expected outcome —
it means no new material evidence arrived. The "last updated" timestamp
should always reflect when the job last *ran*, whether or not the score
changed.

Two source-specific rate rules the daily job must respect:
- **Google Places**: re-fetch rather than cache/store raw content long
  term (see source policy) — one call per business per day is fine.
- **Scottsdale open data**: 60-second crawl delay, per their `robots.txt`.
  For a batch of restaurants, space requests out rather than firing them
  in a tight loop.

## Explainability

`scoreRestaurant()` returns `topReasons`: 2–3 short factual lines,
including a callout when the health inspection or license record is
notably clean. Deliberately not a paragraph — enforced in the function
itself (`.slice(0, 3)`), not left to the UI layer to remember.

## Confidence, not just score

Every score carries a `confidence` value (0–1) reflecting how much
evidence backs it. A restaurant with a Google rating but no health
inspection or license record on file should show as lower-confidence in
the UI rather than being presented with the same visual certainty as a
fully-sourced one. Presenting thin data with false precision is exactly
the kind of thing that erodes the "public trust" premise the whole
product is built on.
