# Public Trust Rank — Buyer / Partner Brief

**Stage: working pilot prototype, Scottsdale, restaurants only. Pre-revenue, pre-traction. Read this whole page before any conversation about price — the honest stage matters more than the pitch.**

## The idea in one sentence

A local restaurant-ranking product that scores places 50–100 from public
evidence — reviews, freshness, public mention volume — instead of paid
placement, so a small business with genuinely good word-of-mouth can
outrank a big spender, and the public can trust the number because every
score traces back to a documented, inspectable reason.

## The problem it's built against

Every major local-search ranking today has a pay-to-play layer somewhere:
sponsored placement, ad spend correlating with visibility, or review
systems that can be gamed or purchased. That's not a conspiracy claim,
it's the plain mechanics of how Google, Meta, and most directory sites
monetize local search. Public Trust Rank's entire bet is that a
transparent, non-purchasable ranking is worth more to a consumer than a
slightly bigger review count bought with ad spend — and worth more to a
*small* business than the current system, which structurally favors
whoever can outspend on ads.

## What exists right now — see for yourself, don't take this doc's word for it

1. **A working web app** (`apps/consumer-web/`) — map, search, category
   filters, ranked list, a detail panel explaining *why* each score is
   what it is in 2–3 short lines, not a wall of text. Dark/light mode.
   Open `index.html` through a local server and click around.
2. **A real, tested scoring engine** (`services/ranking-engine/scoring.mjs`)
   — six weighted public-evidence factors, a hard 50 floor, no field in
   the data model for paid placement of any kind. The UI's scores are
   computed by this file live, not hardcoded. Two factors are the real
   differentiator: a county health department inspection record and a
   city open-data business-license record — actual government outcomes,
   not another opinion layer. Neither Google nor Yelp rank on either one.
3. **A second page with 7 real, named Scottsdale restaurants**
   (`apps/consumer-web/real-pilot.html`) — real names, addresses, and
   cited review-count data, proving the system can point at real
   businesses, not just a demo dataset. It deliberately shows a partial
   metric (review-volume index) instead of a fabricated full score,
   because the full score needs a real data source not yet connected —
   see the honesty note below, this matters for how you present it.
4. **A documented, buildable path to full automation** — a scoring model
   spec, and a source policy that names exactly which data sources are
   legally usable (Google Places API, county health inspection records,
   a business's own website) versus permanently excluded (Yelp — their
   own API terms explicitly ban this business model, quoted directly in
   the policy doc, not assumed) versus needing a licensing deal
   (OpenTable, Nextdoor, Reddit at commercial volume). An inert-but-ready
   GitHub Actions workflow handles the free daily job once an API key is
   added.
5. **A public, if quietly placed, sources-and-methodology disclosure**
   (`apps/consumer-web/sources.html`, linked in small type on every page)
   — this is the concrete answer if a buyer, a journalist, or a losing
   restaurant ever asks "why should I trust this ranking / prove you're
   not biased." It names what's used and, just as important, what was
   checked and deliberately left out and why. That page is the
   receipts — worth pointing to in any pitch, not just leaving in the
   repo.

## The one thing to be straight about with any buyer

The 7 real restaurants show a **Public Engagement Index** (review-volume
only, transparently calculated, cited) — not the full six-factor Public
Trust Score. Getting the full score onto real businesses requires either a
licensed API (Google Places, low-cost) or manual verification. Presenting
this pilot as "already fully live and daily-updating on real data" would
be a lie a buyer's own diligence would catch in about ten minutes, and it
would undercut the exact "no manipulation, full transparency" positioning
that's the product's actual differentiator. The honest pitch — "the engine
is real and tested, the real-data path is documented and one API key
away" — is a stronger pitch to anyone who's actually run a product before,
because it shows they're not being sold vaporware.

## Ownership and portability

Everything is plain files: HTML/CSS/JS, JSON, Markdown, no proprietary
platform. Put it in a private git repo under an entity you control and
it's a clean handoff — a developer, co-founder, or acquirer can read the
whole system from the files themselves, no separate explainer deck
required (though this document is that deck, if one is wanted).

## Realistic value, right now — no hopium

Per an earlier gut-check on this: a working, tested prototype with no
live data feed and no users is realistically a **$10,000–$75,000
concept/prototype asset**, not a venture valuation. It becomes a
**$75,000–$500,000 asset** once it's a real Scottsdale pilot with a
compliant live data feed and even a small group of actual users. It only
gets meaningfully larger than that with retained users, proven daily
reliability, and either revenue or a strategic buyer who sees a specific
advantage (a trusted local dataset a big platform doesn't have). Anyone
offering a much bigger number for what exists today either hasn't looked
closely or is trying to make you feel good in a negotiation — take the
second case as a reason to slow down, not speed up.

## What raises this asset's value fastest, cheapest

1. **Wire one real source** (Google Places API, free tier) so the real
   pilot page shows genuine, complete, defensible 50–100 scores for real
   restaurants — not just the engagement index.
2. **Get it in front of 20–50 real Scottsdale users** and see if the
   ranking matches what people already believe about a place; fix the
   scoring weights where it doesn't.
3. **Let it run unattended and correctly for 2–4 weeks** before touching
   anything else — a second city, a second data source, or a second
   category. That reliability window is what actually de-risks this for a
   buyer, more than any amount of additional feature-building.

## What NOT to do, especially on a tight budget

Don't build a scraper against a platform's terms of service to fill in
data faster — Yelp specifically. It's not a gray area: their API's own
terms name and ban this exact business model, and their site blocks
automated fetching outright. Scraping around that is the single fastest
way to get IPs and API keys blacklisted, and if it ever surfaces in
diligence (a ToS violation is discoverable, and a buyer's lawyer will
look), it poisons the "we don't cut corners on the public's trust" story
that is this product's entire reason to exist over the incumbents. Build
on Google Places + health inspection records + a business's own site
instead — narrower, but actually yours to use.
