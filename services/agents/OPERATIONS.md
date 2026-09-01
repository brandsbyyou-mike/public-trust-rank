# Operations Runbook — What Runs, When, With What Keys

This is the turnkey brief: read this one file and know exactly what this
system does every day, on its own, with no further instruction. It ties
together three other docs without repeating them — `README.md` (why the
architecture is shaped this way), `source-agent-playbook.md` (the exact
technique for each source), and `docs/launch/go-live-cheap.md` /
`docs/launch/scaling-to-full-scottsdale.md` (cost). This file is the
schedule and the roles; those are the how and the why.

## The two scheduled jobs, and nothing else runs unattended

| Job | File | Schedule | Fetches |
|---|---|---|---|
| Daily Score Update | `.github/workflows/daily-score-update.yml` | 09:00 UTC every day | `googleRating`, `reviewVolume`, `licenseVerified`, `siteFreshness` |
| Weekly Editorial Update | `.github/workflows/weekly-editorial-update.yml` | 10:00 UTC every Sunday | `editorialMentions` (a rotating slice of the roster once it's larger than Custom Search's free-tier budget — see below), plus `place_id` resolution and dish-mention review scanning |

Both call the same script, `services/agents/source-ingestion-agent/run.mjs`,
with a different mode argument (`daily` / `weekly`). Neither job ever
touches `healthInspection` — that factor has no automated source yet (see
the playbook, item #5) and stays at 0 with an honest reason until it does.

A third, manual-only workflow exists — `.github/workflows/discover-restaurants.yml`
("Discover Restaurants" in the Actions tab). It is NOT on any schedule and
does not touch the live pipeline; it's a separate tool for finding real
Scottsdale restaurants via Google Places Nearby Search, writing a reviewed
candidate list rather than auto-expanding the roster. See "Growing the
roster" below.

## Why two schedules instead of one

A restaurant's Google rating or review count can genuinely move day to
day. A restaurant getting written up in the news does not — checking for
it daily instead of weekly finds the same story a week later at best, and
costs real money at city scale (Google Custom Search's free tier is
100 queries/day; splitting editorial checks onto a slower cadence is what
keeps that factor free even covering all of Scottsdale — see
`docs/launch/scaling-to-full-scottsdale.md`). This isn't a corner cut —
running everything daily wouldn't make the product more accurate, it
would just cost more for the same answer.

## What each job actually does, in order

1. Checkout the repo, set up Node 22 — standard GitHub Actions steps,
   nothing project-specific.
2. Run `node services/agents/source-ingestion-agent/run.mjs <mode>`.
   - **License check (daily job only):** pull the whole Scottsdale
     business-license dataset via a handful of paginated queries (once per
     run, not once per restaurant — see "Why the license check is a bulk
     fetch" below), then match every restaurant against it locally.
   - For each restaurant in `data/real-pilot/scottsdale-real-snapshot.json`,
     fetch only the factors due this run's cadence (see table above; on the
     weekly job, `editorialMentions` only fires for restaurants in this
     week's rotation bucket).
   - Carry every other factor forward unchanged from the last run that
     did fetch it — its value, its source note, and its original
     `updated_at` timestamp. Nothing gets silently reset to zero just
     because it wasn't due this run.
   - Recompute the score via `scoreRestaurant()` from the merged evidence
     and rewrite `data/real-pilot/scottsdale-live-scores.json`.
   - Every metered call (Places Text Search, Places Details, Custom
     Search) goes through the budget guard first — see "The budget guard"
     below.
3. Commit and push `data/` if anything changed. An unchanged score on a
   given day is a valid, expected outcome (per
   `docs/scoring/daily-ranking-spec.md`) — the job still ran, it just had
   nothing new to say, and the commit step already no-ops cleanly when
   there's no diff. If the budget guard stopped the run, this step never
   executes at all (the previous step exits non-zero) — see below.

## The budget guard

This project's cost promise is "$0/month, always" (see
`docs/launch/go-live-cheap.md`), and that promise is enforced in code, not
just in careful math. Every call to a metered Google API goes through a
guard in `run.mjs` first (see the "Budget guard" comment near the top of
that file) that checks two hard ceilings, both set with real margin below
the actual free-tier limits:

- **Per-run sanity cap**, sized to what one run of the current roster
  should ever need (about one call per restaurant, plus a small buffer).
  This is what catches a bug that causes repeated or looping calls.
- **Persistent monthly/daily ledger**, `data/real-pilot/api-usage-ledger.json`
  — a real, committed record of exactly how many calls have been made
  against each free tier this month (Places Text Search, Places Details)
  or today (Custom Search).

If either would be exceeded, the guard throws immediately — before the
network call happens — the run stops, and `run.mjs` exits non-zero. That
means the commit step is skipped entirely: nothing partial or anomalous
ever gets published, and yesterday's good data just stays live until
someone checks the Actions log (which prints exactly how many calls of
each type were made, and the month/day-to-date totals) for why it tripped.
If frequency ever needs to come down to stay comfortably inside a free
tier — a bigger roster, a tighter cap — that's a config change (`CSE_DAILY_BUDGET`,
the per-run cap math), not a rewrite.

## Why the license check is a bulk fetch, not one query per restaurant

This used to be one `Company LIKE '%...%'` query per restaurant. Two real
problems with that: the Scottsdale ArcGIS dataset has no
category/business-type field (confirmed by reading the layer's own schema
directly — `Company` and address are the only usable fields, so a
name-fragment match was always the strategy, bulk or not), and the
per-restaurant loop only paused 1 second between queries while
`docs/source-policy/approved-sources.md` documents this endpoint asking
for a 60-second crawl delay — already non-compliant with our own policy at
7 restaurants, not just a scaling problem. Fixed by pulling the whole
~19,800-record dataset once per daily run (about 20 paginated pages, a
genuine 60-second pause between them, ~20 minutes total) and matching
every restaurant against it in memory, with zero further network calls.
That cost is now fixed regardless of roster size — 7 restaurants or 800
take the same ~20 minutes for this step.

## API keys — what each one is for, and where it lives

| Secret name | Powers | Where it's set | If missing |
|---|---|---|---|
| `GOOGLE_PLACES_API_KEY` | `googleRating`, `reviewVolume` (daily), `place_id` resolution + dish-mention review scanning (weekly), restaurant discovery (manual only) | GitHub repo → Settings → Secrets and variables → Actions | Affected factors stay 0/unresolved with a logged reason; nothing else breaks |
| `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | `editorialMentions` | Same, two separate secrets | Factor stays at its last known value (weekly job) or 0 if never run |

`googleRating` and `reviewVolume` share a single Places Text Search call
per restaurant per daily run (they used to each call it separately,
silently doubling the cost for no reason) — see `getPlaces()` in `run.mjs`.

No key is needed for `licenseVerified` (public ArcGIS endpoint) or
`siteFreshness` (a plain fetch of the restaurant's own site). Every
secret is read only inside the GitHub Actions runner via
`${{ secrets.NAME }}` — never written to a file in this repo, never
visible in a log, never touched by anything client-side. This is a
different rule from the Mapbox token in `apps/consumer-web/config.js`,
which is a public token by design (see the comment in that file) — don't
apply GitHub-secret handling to it and don't apply public-token handling
to these.

## What "the agent's role, every day" actually means in practice

If you're standing this up for the first time, or handing it to someone
else to operate, here is the complete list of ongoing responsibilities —
nothing beyond this list needs deciding day to day:

- The daily job refreshes four factors and recomputes every score.
- The weekly job refreshes one factor (editorial) and recomputes every
  score using whatever it and the daily job most recently found.
- Health inspection is not fetched by anything yet. It is not this
  system's job to guess it — it's the next engineering task, documented
  in the playbook, not a gap that quietly gets papered over.
- Neither job ever writes a `paid`, `sponsored`, or `boost` value — that
  field doesn't exist in the evidence type `scoreRestaurant()` accepts,
  so there is structurally nothing for a future "let's monetize this"
  conversation to plug into without editing and re-reviewing this code
  first.
- If a job goes red (fails), the previous day's `scottsdale-live-scores.json`
  stays as the last commit — nothing is left half-written, since the
  write only happens after all restaurants in that run finish. Check the
  Actions tab for the failure reason before assuming the data is stale
  for a bad reason rather than a quiet network hiccup.
- Adding a new restaurant: add it to
  `data/real-pilot/scottsdale-real-snapshot.json` with at least `id`,
  `name`, `address`, `lat`, `lng`; `website` is optional but improves
  `siteFreshness`. It picks up both schedules automatically on the next
  run — no other file needs touching.
- **Growing the roster:** run "Discover Restaurants" from the Actions tab
  (manual trigger only, never scheduled) to pull a real, Google-verified
  candidate list into `data/real-pilot/discovered-candidates.json` — name,
  address, place_id, rating, from a grid of Nearby Search queries covering
  Scottsdale. That file is NOT auto-merged: review it (Google's
  "restaurant" category also catches some coffee shops, bars, and ghost
  kitchens) and hand-add the real candidates to
  `scottsdale-real-snapshot.json`. The roster can grow to roughly 300
  restaurants before Places Text Search's free tier becomes the binding
  constraint at daily cadence (see `docs/launch/scaling-to-full-scottsdale.md`
  for the exact math); editorial-mention rotation (`CSE_DAILY_BUDGET`)
  already handles the roster being larger than Custom Search's free-tier
  budget, so it isn't a hard ceiling the way it used to be.
