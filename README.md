# Public Trust Rank — Scottsdale Restaurant Pilot

A local restaurant-ranking product that scores places 50–100 from public signals
(reviews, freshness, mention velocity, demand) instead of paid placement. No
sponsored slots, no pay-for-rank, no ad inventory in the ranking path — that
rule is enforced in code, not just copy (see `services/ranking-engine/scoring.mjs`:
there is no `paid` or `sponsor` field anywhere in the scoring input type).

Scope, as decided: **restaurants only, Scottsdale only, for the pilot.**
Beauty and law were cut deliberately — not because the idea is bad, but because
restaurant signals (reviews, reservations, menu/site freshness) are the easiest
to source and validate, and a narrower pilot ships faster and proves the model
before you spend money widening it.

## Start here if you're evaluating this to buy, fund, or partner on it

Read **`BUSINESS-BUYER-BRIEF.md`** first — what this is, what's proven,
what's honest about its current stage, and a real (not hyped) value range.
Then **`docs/launch/go-live-cheap.md`** for the actual cost (real target:
$0/month) and the exact steps to put this on a free, live URL that
updates daily on its own.

## What's actually in this folder

This is real, runnable code — not another spec. Specifically:

- **`apps/consumer-web/`** — a working web app. Map, search, filters, ranked
  list, a detail panel that shows *why* a place scored what it scored. Open
  `index.html` through a local server (see Run It below) and it works.
  A second page, `real-pilot.html`, shows 7 real, named Scottsdale
  restaurants with cited public data (see `docs/launch/real-pilot-snapshot.md`
  for exactly what's real vs. what's still a documented next step).
- **`services/ranking-engine/scoring.mjs`** — the actual scoring function.
  Pure, testable, no network calls. The app imports this file directly — the
  scores you see in the UI are computed by this code at load time, not
  hardcoded.
- **`services/agents/source-ingestion-agent/run.mjs`** — the real fetch
  script, not a stub, run in two modes (`daily` / `weekly`) by the two
  scheduled workflows in `.github/workflows/`. Runs clean with zero API
  keys set (every factor it can't reach comes back an honest 0 with a
  logged reason, never a guess); fill in `GOOGLE_PLACES_API_KEY` and it
  starts pulling real Google ratings and review counts the same run.
  Already finds real Scottsdale business-license records with no key at
  all. **`services/agents/OPERATIONS.md`** is the complete day-to-day
  runbook — what runs when, which key powers which factor, and this
  system's full list of ongoing responsibilities.
- **`data/seeds/scottsdale-restaurants.json`** — demo data. **The restaurant
  names are invented**, not real Scottsdale businesses. Attaching a fabricated
  trust score to a real restaurant's name is a defamation risk and I'm not
  doing that without your sign-off and a lawyer's. Swap this file for real,
  sourced data once you have a legitimate ingestion pipeline (see below).
- **`services/agents/README.md`** — the honest version of the agent
  architecture: what each agent would do, and which data sources actually
  have a legal path in (official APIs) versus which ones don't yet
  (OpenTable, Nextdoor — no public API, partnership/licensing required).
- **`docs/`** — architecture, scoring spec, source policy, pilot plan. Kept
  short on purpose.

## What's NOT in this folder, on purpose

There is no live crawler hitting Google, Yelp, Facebook, OpenTable, or Reddit
in this codebase, and there won't be one from me. Most of those either
prohibit automated scraping in their terms of service or require a licensed
API relationship. Building an unauthorized scraper is the fastest way to get
this product's IP address, API keys, and eventually its domain blocked before
it ever launches — and it undermines the "public transparency, nothing
sketchy" positioning that's the actual differentiator here. The real path in
is `docs/source-policy/approved-sources.md` — official, rate-limited APIs
where they exist, licensed data where they don't, manual/curated entry for
the pilot in the meantime.

## Run it

No build step needed. From this folder:

```bash
cd apps/consumer-web
npx serve .
# or: python3 -m http.server 8080
```

Then open the printed local URL. The map is Mapbox GL JS — needs a free
token pasted into `apps/consumer-web/config.js` to render (see
`docs/launch/go-live-cheap.md` step 6); without one it shows a plain
setup message instead of a broken map, and the rest of the app (search,
filters, list, detail panel) still works. It will not render in a plain
`file://` open in some browsers either way — use the local server above.

## Where this goes next

1. Replace `data/seeds/scottsdale-restaurants.json` with real, curated
   Scottsdale restaurant data (start manual/curated — 30–50 places you or a
   part-time researcher verify by hand; this is the "concierge MVP" from the
   cost conversation, not full automation).
2. Wire one real source first: Google Places API (Place Details gives
   rating, review count, price level — legitimate, rate-limited, has a free
   tier). That alone lets the freshness/demand/sentiment factors move on
   real data instead of seed evidence.
3. Stand up the daily job (`services/agents/`) that re-pulls that one source
   nightly and recomputes scores through `scoring.mjs` — same function, real
   inputs.
4. Only after that loop is boring and reliable for 2–4 weeks, add a second
   source and a second city. Not before.

## Ownership

Everything in this folder is plain files — HTML/CSS/JS, JSON, Markdown. No
proprietary platform, no vendor lock-in. Put it in a private git repo you
control, and it's a clean handoff to a developer, a co-founder, or a buyer as-is.
