# Going Live, Cheap — the Real Numbers and the Real Steps

Realistic target: **$0/month**, possibly a few dollars if usage runs over
a free tier. The only unavoidable friction point isn't cost — it's that
Google Cloud requires a card on file to issue an API key at all, even
though the usage itself stays inside the free tier at this scale. Leading
with that because it's the one thing that could surprise you mid-setup,
not because it costs anything.

## The actual monthly cost, itemized

| Piece | Cost | Why |
|---|---|---|
| Hosting (GitHub Pages) | $0 | Free, unlimited, for a public repo — this app is static files, no server needed |
| Domain | $0 (optional $10–15/yr) | `<yourname>.github.io/public-trust-rank` works fine for a pilot; buy a real domain only once you want one for the pitch |
| Daily + weekly automation (GitHub Actions) | $0 | Two scheduled jobs, both well within free-tier minutes; public repos get unlimited minutes anyway. See `services/agents/OPERATIONS.md` for what each does |
| Map (Mapbox GL JS) | $0 | 50,000 map loads/month free — see `docs/launch/scaling-to-full-scottsdale.md` for why Mapbox over the Google Maps JS API |
| Google Places API | $0 | **Correction from an earlier answer in this build session: Google no longer runs a blanket $200/month credit — checked their current pricing page directly on 2026-09-01.** It's now 10,000 free calls per month, per API. `googleRating`/`reviewVolume` share one Text Search call per restaurant per daily run (deduped — see `getPlaces()` in `run.mjs`), which keeps a roster up to roughly 300 restaurants inside the 10,000 free/month — see `docs/launch/scaling-to-full-scottsdale.md` for the exact math |
| Google Custom Search API | $0 | 100 free queries/day. Runs **weekly**, and once the roster is larger than that free budget, rotates a slice of the roster through each week instead of checking everyone (`CSE_DAILY_BUDGET` in `run.mjs`) — see the cadence rationale in `services/agents/OPERATIONS.md` |
| Scottsdale business license lookup | $0 | Public ArcGIS endpoint, no key, no cost — already working (see `source-agent-playbook.md`) |
| Maricopa health inspection | $0 once solved | Public record, no cost — the open item is retrieval mechanism, not price |

**Total: $0/month to run this for a month, two months, or indefinitely**,
as long as usage stays this small. The only real cost is your time, and
Google requiring a card on file for the API key (their standard practice
for every developer, not something specific to this project — it's not
charged unless you exceed the free monthly call allotment, which a pilot
this size won't).

## What's already done vs. what only you can click

**Already built, sitting in the repo, ready to go:**
- The entire app (`apps/consumer-web/`).
- The scoring engine (`services/ranking-engine/scoring.mjs`).
- The real ingestion script (`services/agents/source-ingestion-agent/run.mjs`)
  — tested this session: it runs cleanly end-to-end with zero secrets set,
  leaving every factor it can't reach at an honest 0 with a logged reason
  instead of crashing or guessing. Once real keys exist, the same script
  fills those factors in for real, no code changes needed.
- The daily GitHub Actions workflow (`.github/workflows/daily-score-update.yml`)
  — wired to call the real script, not a placeholder.

**Only you can do these — account creation and billing aren't something
I'll ever do on your behalf, by design:**

1. **Create a free GitHub account** (if you don't have one) at github.com,
   and a new repository — public is fine and is what keeps Actions free.
   **Do not check "Initialize this repository with a README"** — this
   folder already has one, and an unrelated initial commit on GitHub's
   side just means an extra merge step for no reason.
2. **Push this folder to that repository.** This folder is already a git
   repository with one commit (`git init` / `git add .` / `git commit`
   were run as part of preparing it — check with `git log` from inside
   the `public-trust-rank` folder if you want to see it) — so this step
   is just pointing it at GitHub and pushing, not starting from scratch:
   ```bash
   cd public-trust-rank
   git remote add origin https://github.com/<you>/<repo-name>.git
   git push -u origin main
   ```
   GitHub shows you this exact command (with your real URL filled in)
   on the new repo's page under "…or push an existing repository from
   the command line" — use that version, it already has your username
   and repo name right.
3. **Turn on GitHub Pages** in the repo's Settings → Pages, pointing it at
   `apps/consumer-web/` — a few clicks, no cost, gives you a real live URL
   within a minute or two.
4. **Get a Google Places API key**: console.cloud.google.com, create a
   project, enable the "Places API (New)," create an API key. This is the
   one step that asks for a card on file — flagged above so it's not a
   surprise.
5. *(Optional, for the editorial-mentions factor)* Set up a **Google
   Programmable Search Engine** at programmablesearchengine.google.com
   (free) to get a Custom Search API key and search-engine ID.
6. **Get a free Mapbox token** for the map itself:
   account.mapbox.com/access-tokens — no card required to start, 50,000
   map loads/month free. Paste it into `apps/consumer-web/config.js` in
   place of the placeholder. This one is different from the others: it's
   a *public* token, meant to be visible in the page's own code — see the
   comment in that file for why, and restrict it to your domain in the
   Mapbox dashboard once you have one, rather than trying to hide it.
7. **Add the server-side key(s) as repo secrets**: Settings → Secrets and
   variables → Actions → New repository secret. Names must match exactly:
   `GOOGLE_PLACES_API_KEY`, and optionally `GOOGLE_CSE_KEY` /
   `GOOGLE_CSE_CX`. These, unlike the Mapbox token, must never appear in a
   file in this repo or anywhere client-visible — repo secrets are the
   only place they live.
8. **Run both workflows once by hand** (Actions tab → Daily Score Update →
   Run workflow, then Weekly Editorial Update → Run workflow) to confirm
   each goes green before trusting the schedule. See
   `services/agents/OPERATIONS.md` for exactly what each one does and
   when it's supposed to run on its own.

Once steps 1–8 are done, both workflows run on their own schedules
(daily at 09:00 UTC, weekly Sundays at 10:00 UTC) with no further action
from you — that's the "stays live and updates daily for a month or two,
unattended" proof this pilot needs.

## What "prove it works" actually looks like after this

- A real URL you can hand anyone, showing real restaurants with real,
  dated scores.
- A commit history on GitHub showing a new commit every day for however
  long it's been running — that history *is* the proof it's not a
  one-time demo, more convincing to a buyer than any amount of me saying
  so.
- `data/real-pilot/scottsdale-live-scores.json` updating daily with a
  fresh `generated_at` timestamp and, for each restaurant, either real
  fetched values or an honest 0 with a reason — visible receipts, not a
  black box.
- After the second day it's run, a real `score_delta` on every
  restaurant — "▲ 2 since 2026-09-01," not a demo placeholder — computed
  from `data/real-pilot/score-history.json`, which the pipeline now
  writes and appends to on every run. That file is this system's actual
  memory: it's how "change since yesterday" stays true even across a
  manual re-run, a failed job retried the next day, or months of runs.

## What still won't be solved by any of this

Health inspection stays unfilled even with every key above wired in —
that gap is a retrieval-mechanism problem (see
`services/agents/source-agent-playbook.md` #5), not a cost problem. Free
or paid, it needs either the county's hidden AJAX endpoint found, or real
browser automation with network access that reaches their server, which
this development environment specifically didn't have. That's the honest
state to carry into any conversation about this pilot: five of six
factors have a real, working, near-zero-cost path to daily automation
today; the sixth is a known, documented, unsolved problem — not quietly
dropped.

## This is the $0-ceiling number, not the whole-city number

Everything above holds up to roughly 250-300 real Scottsdale restaurants
at the current architecture (see `docs/launch/scaling-to-full-scottsdale.md`
for exactly which free tier becomes the binding constraint, and why). It
does NOT assume a small hand-picked set anymore — the roster is being
grown broadly across the city within that ceiling, not just a curated
pocket of it. Scottsdale has 800+ restaurants total, though; covering all
of them is a materially different, no-longer-$0 cost (roughly
$75-100/month, driven by Places API volume), and the map's visual polish
is a separate question with its own real cost. Both are broken down in
`docs/launch/scaling-to-full-scottsdale.md`, not folded in here, so the
$0 number above stays honest and doesn't get buried under a bigger number
that only applies past the ~300-restaurant mark.
