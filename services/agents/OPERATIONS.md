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
| Weekly Editorial Update | `.github/workflows/weekly-editorial-update.yml` | 10:00 UTC every Sunday | `editorialMentions` |

Both call the same script, `services/agents/source-ingestion-agent/run.mjs`,
with a different mode argument (`daily` / `weekly`). Neither job ever
touches `healthInspection` — that factor has no automated source yet (see
the playbook, item #5) and stays at 0 with an honest reason until it does.
Nothing else needs to be scheduled; there is no third job, no manual step,
no cron the ingestion script doesn't already know about.

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

1. Checkout the repo, set up Node 20 — standard GitHub Actions steps,
   nothing project-specific.
2. Run `node services/agents/source-ingestion-agent/run.mjs <mode>`.
   For each restaurant in `data/real-pilot/scottsdale-real-snapshot.json`:
   - Fetch only the factors due this run's cadence (see table above).
   - Carry every other factor forward unchanged from the last run that
     did fetch it — its value, its source note, and its original
     `updated_at` timestamp. Nothing gets silently reset to zero just
     because it wasn't due this run.
   - Recompute the score via `scoreRestaurant()` from the merged evidence
     and rewrite `data/real-pilot/scottsdale-live-scores.json`.
3. Commit and push `data/` if anything changed. An unchanged score on a
   given day is a valid, expected outcome (per
   `docs/scoring/daily-ranking-spec.md`) — the job still ran, it just had
   nothing new to say, and the commit step already no-ops cleanly when
   there's no diff.

## API keys — what each one is for, and where it lives

| Secret name | Powers | Where it's set | If missing |
|---|---|---|---|
| `GOOGLE_PLACES_API_KEY` | `googleRating`, `reviewVolume` | GitHub repo → Settings → Secrets and variables → Actions | Both factors stay 0 with a logged reason; nothing else breaks |
| `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | `editorialMentions` | Same, two separate secrets | Factor stays at its last known value (weekly job) or 0 if never run |

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
- Expanding past the current curated set toward all of Scottsdale is a
  deliberate decision, not an automatic next step — see the
  recommendation at the end of `docs/launch/scaling-to-full-scottsdale.md`
  for why that's a "prove the pilot first" call, not a technical one.
