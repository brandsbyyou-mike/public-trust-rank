# Scaling to All of Scottsdale — the Map and the Real Cost

Two separate questions get answered here: does the map look like what
people expect from Google/Apple/Tesla, and what does it cost to run this
against every restaurant in Scottsdale instead of a curated pilot list.
Researched directly on 2026-09-01, not estimated from memory — sources at
the end of each section.

## The map, honestly

Today's map is Leaflet + OpenStreetMap tiles — free, functional, and it
is **not** going to read as polished as Google Maps, Apple Maps, or
Tesla's in-car map to someone who uses those daily. Flatter styling,
no traffic layer, no 3D buildings, more basic zoom/pan feel. That's the
honest starting point, not a knock on what's built — OSM/Leaflet was the
right choice for a free, sandbox-buildable pilot; it's not the right
choice for "should feel like the maps people already trust."

**Two real upgrade paths, both usable on a low budget:**

1. **Mapbox GL JS** — modern vector rendering, highly customizable
   styling, and genuinely can look as polished as Google's default map or
   better (a lot of apps people consider "premium-feeling" use Mapbox
   specifically for this). Free tier: **50,000 map loads/month**, then
   $5/1,000 up to 100k, tapering to $2.50/1,000 at higher volume. A map
   *load* is once per page visit, not per restaurant — so this scales
   with your traffic, not your restaurant count. For a pilot, 50,000
   loads/month is generous headroom.
2. **Google Maps JavaScript API** — literally the visual language most
   people are "accustomed to," and you already need a Google Cloud
   project for Places data, so it's one account either way. Free tier:
   **10,000 map loads/month**, then $7/1,000 up to 100k.

**Recommendation: Mapbox for the map, Google Places API for the data.**
Mixing providers this way is completely normal — the map renderer and
the data source are unrelated choices. Mapbox's free tier is 5x more
generous, and visually it can match or beat Google's own map styling
once themed, which matters more for "feels like the apps people already
use" than which company's logo is on it. If the brand argument for
"literally Google's map" ever matters more than the free-tier math, that
switch is a config change, not a rebuild — the app doesn't touch the map
provider's data model, only which tile/style URL it points at.

Sources: [Mapbox pricing](https://www.mapbox.com/pricing), [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)

## "Near me" — already built, actually free

The geolocation feature added this round (a "📍 Near me" button, a
distinct blue pin for your position, distance-sorted results) uses the
browser's own Geolocation API and a plain-math distance calculation
(haversine, no API call) — **zero cost, no API key, works today** in
`apps/consumer-web/index.html` / `app.js`. It only asks for location on
a deliberate button click, never automatically, and if permission is
denied the app just falls back to normal browsing — no broken state.

## What it actually costs to cover all of Scottsdale

Scottsdale has **800+ restaurants** (savorscottsdale.com's own count,
cross-checked against Tripadvisor's and Yelp's Scottsdale restaurant
listings, which both run into the hundreds+ as well). That's roughly
100x the current 7-restaurant real-pilot set, and it changes the cost
picture — this is the point where "$0/month" stops being the honest
answer and a real number needs to be said plainly.

**A correction first:** the earlier cost estimate in this build session
said Google gives a $200/month free credit. That's out of date — checked
their current pricing page directly this round. It's now **10,000 free
calls per month, per individual API**, then tiered pay-as-you-go pricing.
This doesn't change the pilot-scale answer (still $0, comfortably under
10,000), but it changes the full-city math below.

**Naive approach (query everything, every restaurant, every day) —
expensive:** searching Google Places fresh for all 800+ restaurants daily
uses the Text Search endpoint at $32/1,000 calls beyond the free tier —
roughly 24,000 billable calls/month once the free 10,000 is used, near
**$450–500/month** on that factor alone. That's the wrong architecture,
not the real cost of the idea — see the fix below.

**Real, optimized architecture — the actual number:**
- **Resolve each restaurant's Google `place_id` once**, not daily (Google's
  own policy allows storing the `place_id` indefinitely — this was
  already confirmed in `docs/source-policy/approved-sources.md`). One-time
  cost for 800 restaurants: within the free tier the month it's done.
- **Daily refresh uses Place Details, not Text Search**, keyed by the
  stored `place_id` — $5/1,000 instead of $32/1,000. 800 restaurants ×
  30 days = 24,000 calls/month; 10,000 free, ~14,000 billable ≈
  **$70/month**.
- **Editorial mentions checked weekly, not daily** — a restaurant getting
  a news feature is a rare event; checking it once a day buys nothing a
  weekly check doesn't. 800 restaurants ÷ 7 ≈ 114/day-equivalent, well
  under Custom Search's 100/day free allotment most days; modest overage
  ≈ **$5–10/month**.
- **Business license data pulled in bulk, not one query per restaurant**
  — **implemented, not just planned:** `run.mjs`'s `fetchAllScottsdaleLicenses()`
  pulls the whole ~19,800-record dataset once per daily run via ~20
  paginated queries (the endpoint's real `maxRecordCount` is **1,000**,
  confirmed by reading the layer's own metadata directly — not the 2,000
  this doc originally guessed), with a genuine 60-second pause between
  pages, then matches every restaurant against it locally. **Free**, and
  this cost is now fixed regardless of roster size (~20 minutes whether
  the roster is 7 restaurants or 800) — replacing the old per-restaurant
  query pattern that would have blown past a reasonable job runtime well
  before 800 restaurants, and that (found while doing this work) was
  already only pausing 1 second between queries, not honoring the
  documented 60-second policy even at 7 restaurants.
- **Every metered call is budget-guarded** — a hard, code-enforced stop
  (not just careful math) if any run's usage would exceed a cap set with
  real margin below each free tier, backed by a persistent, committed
  ledger of exactly how many calls have been made. See "The budget guard"
  in `services/agents/OPERATIONS.md`. This is what makes "$0/month" a
  guarantee rather than an estimate that assumes nothing ever goes wrong.
- **Map loads** — a function of site visitors, not restaurant count.
  Free under Mapbox's 50,000/month tier unless traffic gets large, in
  which case that's a good problem (real usage) that funds itself.
- **Health inspection** — still $0 either way; still unsolved for the
  same reason as at pilot scale.
- **GitHub Actions** — still free; a well-architected daily job (bulk
  license pull + Place Details calls + weekly editorial batch) runs in
  minutes, nowhere near free-tier limits.

**Realistic total to run this against all of Scottsdale: roughly
$75–100/month**, driven almost entirely by the Places Details factor —
not the $450–500/month a naive daily-full-refresh design would cost, and
not free either. That's the honest number.

## Where the free ceiling actually sits, at the current architecture

Not all-or-nothing between "7-restaurant pilot" and "800-restaurant,
$75-100/month" — there's a real $0/month tier in between, and this is
where the pilot was deliberately grown to (2026-09-01):

- **Places Text Search** (rating + review count, deduped to one call per
  restaurant per daily run — see `getPlaces()` in `run.mjs`): 10,000
  free/month → roughly **300 restaurants** at daily cadence, with margin
  left for each restaurant's one-time `place_id` resolution.
- **Places Details** (dish-mention review scan, weekly): 10,000 free/month,
  separate bucket → not the binding constraint until ~2,300 restaurants.
- **Custom Search** (editorial mentions): 100 free/day. Below the ~90
  restaurant mark, every restaurant still gets checked every week. Above
  it, `run.mjs` rotates a slice of the roster through each week instead
  (see `CSE_DAILY_BUDGET`) so the roster can keep growing toward ~300
  without this becoming a hard ceiling — each restaurant's editorial
  check just gets less frequent (roughly monthly instead of weekly),
  which is an acceptable tradeoff on this factor specifically: it's the
  lowest-weighted signal in the scoring model, and a restaurant getting
  news coverage is a rare event regardless of how often it's checked for.
- **Business license lookup**: fixed ~20-minute bulk cost regardless of
  roster size (see above) — not a constraint at any restaurant count this
  pilot is likely to reach.

**So: up to roughly 250-300 real Scottsdale restaurants, broadly covering
the city rather than one curated pocket of it, stays $0/month** with the
architecture in this repo today. Past that, Places Text Search becomes the
real cost driver, and the Place-Details-instead-of-Text-Search
optimization sketched earlier in this doc (and the $75-100/month full-city
number above it) is where that conversation picks back up — not needed at
today's scale, worth revisiting if the roster grows past ~300.
