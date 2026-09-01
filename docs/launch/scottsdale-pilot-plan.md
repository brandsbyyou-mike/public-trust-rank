# Scottsdale Pilot Plan — Restaurants Only

## Scope (locked)

- One city: Scottsdale, AZ.
- One category: restaurants.
- 30–50 hand-curated listings to start, not an open crawl.
- Private/unlisted while the scoring and UI loop gets tested.

## Phase 1 — Curated pilot (weeks 1–4)

- Load real Scottsdale restaurants into `data/seeds/` format, hand-verified
  (name, location, cuisine) — replacing the placeholder demo names in this
  repo.
- Evidence values entered manually at first from a person actually reading
  reviews and checking freshness — this is the "concierge MVP" approach:
  slower, but zero data-rights risk and it validates whether the scoring
  weights actually match what a person's gut says about a place.
- Ship the web app (already built) pointed at this real data.
- Test with a small private group — you, a few friends, a few actual
  Scottsdale diners. Watch for: does the score match what people already
  believe about a place? Where does it disagree, and is the disagreement
  defensible from the "why" explanation?

## Phase 2 — First real source (weeks 5–8)

- Wire Google Places API for one factor set (sentiment inputs, review
  count, price level). Re-run scoring nightly against real pulled data
  instead of hand-entry.
- Build the daily job (`services/agents/`) that does this automatically and
  logs every run.

## Phase 3 — Decide whether to widen (only after phase 2 is boring)

- Second source (Yelp Fusion), or
- Second neighborhood/category, or
- Start the licensing conversation for OpenTable/Nextdoor if reservation
  and community-mention signals are proving valuable enough to justify the
  cost.

Do not start phase 3 work until phase 2 has run unattended and correctly
for at least two to four weeks. The expensive mistake in a project like
this isn't moving too slow — it's adding a second city or a second data
source before the first one is actually trustworthy, and then debugging two
things at once.
