# Real Pilot Snapshot — Methodology and Limits

`apps/consumer-web/real-pilot.html` shows real, named, currently-operating
Scottsdale restaurants — 139 as of 2026-09-01, up from an original 7. This
document is the honest accounting of what that page does and does not
prove, written so you can repeat this explanation to a buyer without
overselling it.

## What changed since this doc was first written

The original version of this page showed 7 restaurants with a simple
"Public Engagement Index" — a min-max normalization of Yelp-cited review
counts, because no Google Places API key was wired in yet and the real
six-factor `scoreRestaurant()` engine had nothing to compute from. That
engagement-index bridge is gone now, not just superseded: every restaurant
on the page today either shows a real score from the live pipeline, or an
explicit "Not yet scored" placeholder while it waits for the next run —
never a Yelp-derived number standing in for the real thing.

## What's real, today

- **Names and addresses**: the original 7 are hand-researched and cited;
  the other 132 came from `services/agents/source-ingestion-agent/discover-restaurants.mjs`
  (Google Places Nearby Search across a grid covering Scottsdale) and were
  reviewed by hand before being added — see the commit history on
  `data/real-pilot/scottsdale-real-snapshot.json` for exactly what was
  excluded and why (non-restaurant categories Google's "restaurant" type
  also returns, and a few results whose address sits just outside
  Scottsdale).
- **Score, rating, review count, license status, site freshness, editorial
  mentions**: computed live by `services/agents/source-ingestion-agent/run.mjs`,
  running on GitHub Actions daily (rating/reviews/license/site freshness)
  and weekly (editorial mentions, rotated once the roster is larger than
  Custom Search's free-tier budget — see `services/agents/OPERATIONS.md`).
  Every factor is either real fetched data or an explicit 0 with a logged
  reason — never a guess.
- **Coordinates**: geocoded by the same daily Google Places lookup that
  fetches rating/review count (zero extra API cost — see the comment above
  `fetchGooglePlaces()` in `run.mjs`), replacing the original 7's
  hand-picked neighborhood-center approximations with real positions.
- **`previous_score`/`score_delta`/`delta_since`**: a real day-over-day
  change once a restaurant has two days of history in
  `data/real-pilot/score-history.json` — not a demo placeholder.
- **`dish_mentions`**: a weekly, derived-only summary of themes in each
  restaurant's own Google reviews (term, count, average rating) — see the
  DISH MENTIONS comment atop `run.mjs` for what this is and the legal
  reason raw review text is never stored.
- Yelp and Tripadvisor remain permanently excluded as data sources — both
  block automated fetching, and Yelp's Fusion API terms explicitly
  prohibit this exact business model (*"don't use Yelp user review
  ratings for the benefit of a Yelp competitor"*, no building *"your own
  database of business listing information"* — quoted directly from their
  terms; see `docs/source-policy/approved-sources.md`).

## What's still not solved

- **Health inspection.** Still 0 for everyone. Maricopa County's
  inspection tool is a JS-rendered search form, not an API — see
  `services/agents/source-agent-playbook.md` #5. Real, public, and named
  as a differentiator in `scoring.mjs` v3; just not retrievable yet by any
  method tried so far.
- **A restaurant that hasn't been reached by a pipeline run yet** shows as
  "Not yet scored" rather than a zero or a guess — this is expected and
  temporary, not a bug, and resolves itself on the next scheduled run.

## Why this stayed the right amount of "real," not a shortcut

The alternative, at every stage of this build, was inventing
plausible-looking numbers for whatever factor wasn't wired in yet so every
card would show a "complete" 50-100 score. That would put a real
business's public reputation behind a number nobody could trace back to
evidence — exactly what this product exists to *not* do to other people.
A pilot that can't survive its own rule isn't a pilot worth showing a
buyer. The "Not yet scored" placeholder card is that same discipline
applied at 139-restaurant scale instead of 7.
