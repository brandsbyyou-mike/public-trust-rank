# data/real-pilot/

- `scottsdale-real-snapshot.json` — the manually-verified, one-time-cited
  data used by `apps/consumer-web/real-pilot.html` today: names,
  addresses, Yelp-cited review counts, and (for the two restaurants in the
  "Verified full-score examples" section) real evidence gathered by hand
  on 2026-09-01.

- `scottsdale-live-scores.json` — **generated, not committed by hand.**
  Produced by `services/agents/source-ingestion-agent/run.mjs`, which the
  daily GitHub Actions job runs. Deliberately left out of this delivery:
  a test run from a sandboxed environment with no API keys and no network
  access to the Scottsdale license endpoint produced an all-zero,
  floor-score result for every restaurant — accurate for that test, but
  the kind of low, tool-generated number that must never sit in this repo
  looking like a real current score for a real, named business. Once this
  repo is on GitHub with real secrets set (see
  `docs/launch/go-live-cheap.md`), the first real run will create this
  file for real, and it'll be regenerated fresh every day after that —
  never hand-edit it. As of the score-history feature, each restaurant in
  here also carries `previous_score`, `score_delta`, and `delta_since` —
  a real day-over-day change, computed from `score-history.json`, not a
  demo placeholder.

- `score-history.json` — **also generated, not committed by hand.** The
  system's actual memory: one score per restaurant per UTC calendar date,
  written and appended to by the same script on every run, capped at 180
  days per restaurant. This is what `previous_score`/`score_delta` in
  `scottsdale-live-scores.json` are computed from. Same rule as above —
  a sandbox test run produces real-looking dated entries for real, named
  restaurants using fabricated/zero data, so any file this session
  generates while testing gets deleted before packaging, same as
  `scottsdale-live-scores.json` always has. The first entry appears after
  the first real run on GitHub; it takes two real daily runs on two
  different days before `score_delta` stops being `null`, since a delta
  needs a "yesterday" to compare against — that's expected, not a bug.
