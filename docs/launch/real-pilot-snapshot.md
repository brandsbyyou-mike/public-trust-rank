# Real Pilot Snapshot — Methodology and Limits

`apps/consumer-web/real-pilot.html` shows 7 real, named, currently-operating
Scottsdale restaurants. This document is the honest accounting of what that
page does and does not prove, written so you can repeat this explanation to
a buyer without overselling it.

## What's real

- Names, addresses, cuisines: pulled from public search results, each with
  a source URL in `data/real-pilot/scottsdale-real-snapshot.json`.
- Review counts: public facts, cited the way a news article cites "according
  to Yelp, X has 1,383 reviews" — obtained from search-result snippets, not
  by fetching Yelp's site or using their API (both stayed off-limits the
  whole time; see the update below).
- One editorial citation (Cafe Monarch / Phoenix New Times).
- The "Public Engagement Index" (50–100 number shown per card): a real,
  reproducible calculation — min-max normalization of review count across
  this exact 7-restaurant set. Anyone can check the math in
  `services/ranking-engine/engagement-index.mjs`.

## Important: why this page's data source does not scale as-is

Yelp isn't just blocked by `robots.txt` — their Fusion **API's own terms**
explicitly prohibit this exact business model: *"don't use Yelp user
review ratings for the benefit of a Yelp competitor"* and no building
*"your own database of business listing information."* Quoted directly
from their terms — see `docs/source-policy/approved-sources.md`. That
means Yelp is permanently out as a data source, not a "not yet connected"
item.

The review counts here were a one-time manual citation of a publicly
reported number, which is legitimate the way journalism citing a
competitor's published figure is legitimate. What would NOT be legitimate
is automating that same citation at scale — repeatedly pulling Yelp's
numbers by any means, even indirectly through search results, to build an
ongoing dataset starts to look exactly like the "database of business
listing information" their terms name and ban, just assembled by hand
instead of by script. **Real production scoring should come from Google
Places API + the county health inspection record + the business's own
site — not from continued Yelp citation.**

## What's NOT real yet, on purpose

- **Google star rating and the full v3 score.** No Google Places API key
  is wired into this session, so the six-factor `scoreRestaurant()`
  output isn't computed for these real businesses — only the simpler,
  review-volume-based Engagement Index shown on the page.
- **Health inspection and license records.** Both real, public, and named
  differentiators in `scoring.mjs` v3 — but not pulled into this snapshot
  yet, since Maricopa County's inspection tool is a search form (not an
  API) and the Scottsdale license dataset, while confirmed accessible,
  hasn't been queried for these specific 7 businesses yet (see source
  policy for what's confirmed vs. what's next).
- **Site freshness, editorial coverage beyond the one citation found.**
  Same reason: no connected source yet.
- **Daily updates.** This is a snapshot dated 2026-08-31, not a live feed.
  Nothing is currently re-crawling these 7 listings on a schedule.

## Why this is the right amount of "real" for a pilot, not a shortcut

The alternative was inventing plausible-looking numbers for the missing
factors so the demo would show a "complete" 50–100 trust score for each
real restaurant. That would be a real business's public reputation
resting on a number nobody can trace back to evidence — exactly what the
whole product exists to *not* do to other people. A pilot that can't
survive its own rule isn't a pilot worth showing a buyer.

## The actual path from here to a full, live, real score

1. Get a Google Places API key (free tier covers a small pilot; this is
   the "near-zero cost" version of a real source — see
   `docs/source-policy/approved-sources.md`, including the caching/storage
   rule to respect).
2. Wire it into `services/agents/source-ingestion-agent/` to pull rating
   and review count for each business nightly.
3. Script a check against Maricopa County's public inspection search for
   the health-inspection factor (verify its own robots.txt/terms first),
   and query the Scottsdale open-data license dataset for the license
   factor (already confirmed accessible, 60s crawl delay).
4. Feed all of it into `scoreRestaurant()` in `scoring.mjs` — the real
   six-factor v3 engine, already built and tested — instead of the
   engagement-index bridge.
5. Only then does "Public Trust Score, updates daily" become a true
   statement instead of a roadmap item. The scaffolding for the daily job
   (`.github/workflows/daily-score-update.yml`) is already in this repo,
   inert until that API key is added as a secret.
