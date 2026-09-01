# Agent Architecture — Honest Version

Five jobs, five agents, run in this order once a day. This describes the
target design. None of these are wired to a live data source yet — see
`docs/source-policy/approved-sources.md` for what's actually legal to
connect and when, **`services/agents/source-agent-playbook.md` for
exactly how to pull each factor** — the real ArcGIS endpoint for business
licenses, the search patterns that surface editorial coverage, what
counts as a valid Google-rating citation, and precisely where the
health-inspection factor is still blocked and what to try next — and
**`services/agents/OPERATIONS.md` for the actual day-to-day schedule**:
which factors run daily vs. weekly and why, which API keys power which
factor, and the complete list of this system's ongoing responsibilities.
Those three files together are meant to be enough to run this unattended
without asking anyone what to do next.

1. **Source agent** — pulls new evidence from whatever sources are
   currently approved: Google Places API (rating, review count), the
   county health department's public inspection records, the city's
   open-data business-license dataset, the business's own website, and
   Google Custom Search JSON API for editorial and local news mentions.
   Writes raw evidence records with a timestamp and source tag. Never
   writes directly to a business's live score. Explicitly does NOT touch
   Yelp (their API terms ban this use case, and yelp.com blocks automated
   fetching), BBB (robots.txt blocks the review/directory paths),
   reservation platforms like OpenTable (partner-application only, no
   self-serve API), Google's unofficial "popular times" data (not a real
   API field — only available by scraping Google's own internal
   endpoints), or a business's own self-published reviews as a sentiment
   input (used for freshness only, never scored) — see
   docs/source-policy/approved-sources.md for the full verification
   trail, including what was checked and rejected.

2. **Entity agent** — matches a new evidence record to the correct
   restaurant. For the pilot's 30–50 curated listings this is close to
   trivial (a lookup table); it becomes real work once ingestion is
   automated across multiple sources with inconsistent naming — build it
   for real at that point, not before.

3. **Ranking agent** — takes matched, normalized evidence and calls
   `scoreRestaurant()` from `services/ranking-engine/scoring.mjs`. Does not
   contain scoring logic itself — it's a thin caller, so the scoring rules
   live in exactly one place.

4. **Explanation agent** — today, this is just `scoreRestaurant()`'s
   `topReasons` output. It does not need an LLM call to produce "Review
   sentiment is strong (90%)" — keep it deterministic and cheap for as long
   as templated reasons are good enough; only reach for a model call if the
   templates start reading as repetitive or wrong.

5. **Change/audit agent** — logs every score before/after, the evidence
   snapshot that produced it, and the job run ID. This is what makes a
   score defensible later ("why did this drop 4 points on March 3rd" should
   always be answerable from stored data, not memory).

## What this is not

Not a single "AI agent" that goes and scrapes everything. That framing
sounds impressive but hides real legal and reliability risk — a five-step
pipeline where each step has one job and a log is boring, debuggable, and
actually shippable by one person.
