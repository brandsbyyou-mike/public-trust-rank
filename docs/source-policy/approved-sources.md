# Source Policy — Verified Against Actual Terms, Not Assumed

Every source below was checked directly (fetched the actual terms/robots.txt
or the actual public tool) on 2026-08-31, not recalled from general
knowledge. Where a term is quoted, it's quoted from the source document.

## Confirmed BLOCKED — do not build against these, official API included

**Yelp.** Two independent blocks, not one:
1. `yelp.com` disallows automated fetching in `robots.txt` — confirmed
   directly (a fetch attempt was refused for exactly this reason while
   building this repo).
2. The Yelp Fusion **API's own terms** prohibit this business model even
   through official, sanctioned access. Quoting the terms directly:
   > "don't use Yelp user review ratings for the benefit of a Yelp
   > competitor"
   > "[don't] use it to update or create your own database of business
   > listing information, unless such modification is for non-commercial
   > analysis"
   > "cache, record, pre-fetch, or otherwise store any portion of the Yelp
   > Content for a period longer than twenty-four (24) hours"

   Source: https://terms.yelp.com/developers/api_terms/20250113_en_us/

   Bottom line: Yelp is not a usable data source for this product, full
   stop, official API or not. This isn't a caution, it's a hard no.

**Tripadvisor.** `robots.txt` blocks automated fetching — confirmed
directly the same way.

## Confirmed USABLE

**Google Places API.** The strongest real signal source: star rating,
review count (`user_ratings_total`), price level, business status,
sometimes a short editorial summary field. Read directly from Google's own
policy page (not the general reputation of "Google APIs are fine" —
actually read):
- No explicit ban on using this to power a competing local-search or
  ranking product (unlike Yelp's explicit ban above).
- Storage rule: don't pre-fetch, cache, or store Places API *content*
  beyond narrow exceptions — the `place_id` itself can be stored
  indefinitely, but re-fetch the rating/review data rather than building
  a permanent scraped copy of it. Design the daily job around "call the
  API, compute a score, store the score" — not "store Google's raw
  content."
- Full terms are longer than this policy page; a careful read (or five
  minutes with a lawyer) before the daily job goes live is worth it,
  specifically on the storage/caching clause.

Source: https://developers.google.com/maps/documentation/places/web-service/policies

**County health department inspection records (Maricopa County for
Scottsdale).** Genuinely public record, free, no ToS to violate — the
county's own page states inspection reports "are made available to the
general public here at no charge." This is a real, differentiated signal:
not a review, an actual government safety inspection outcome, and neither
Google nor Yelp use it. No bulk API — it's a search tool
(`envapp.maricopa.gov/EnvironmentalHealth/FoodInspections`), so pulling it
at any scale means scripting against that search form, which should get
its own robots.txt/terms check before automating (not yet done as of this
writing — verify before wiring this into the daily job).

Source: https://envapp.maricopa.gov/EnvironmentalHealth/FoodInspections

**A business's own public website.** Menu, hours, content freshness —
standard web crawling of a business's own page, the same thing every
search engine does. Lowest-risk source in the whole list.

**City of Scottsdale open-data business license records.** Confirmed
public dataset at `data.scottsdaleaz.gov` — business name, address,
license number. Checked `robots.txt` directly: it disallows only
admin/session/internal paths (`/sites/`, `/admin/`, `/sessions/`,
`/groups/`, `/people/`, `/workspace/`), not the datasets, and asks for a
60-second crawl delay, which a once-daily job respects trivially. Gives a
genuine "verified, active, licensed business" signal plus tenure (how
long they've held the license) — a second civic record alongside health
inspections, from the city government, not a review platform.

Source: https://data.scottsdaleaz.gov/datasets/business-licenses/about

**Google Custom Search JSON API** for editorial/press mentions. 100 free
queries/day, then $5 per 1,000 up to a 10k/day cap. This is the actual
named mechanism for the "editorial coverage" factor — official, cheap,
not a scraper against arbitrary news sites' own terms. This factor
explicitly includes local news station and newspaper coverage, not just
food-blog/press-release content — a search query scoped to a restaurant's
name plus its city surfaces both the same way.

Source: https://developers.google.com/custom-search/v1/overview

**A business's own published testimonials/reviews — usable as content,
never as a score input.** A restaurant's own site is already an approved
source (above) for freshness. If it also publishes its own praise or
selected reviews, that content can be cited in the UI as color, the same
way a business's "as seen in" logos are just facts about what they chose
to display. It must never be weighted into the score itself: a business
picks which of its own reviews to publish, so treating self-published
praise as sentiment evidence would let a business partially write its own
score — precisely the "pay/curate your way to the top" failure mode this
product exists to not have. This is enforced by omission: there is no
factor for it in `scoring.mjs`'s `WEIGHTS`, the same structural guarantee
already used against paid placement.

## Checked and NOT added — didn't clear the bar

**BBB (Better Business Bureau).** Their `robots.txt` explicitly disallows
`/business-reviews/*` and `/accredited-business-directory/*` — almost
certainly exactly where the letter grade and accreditation status live.
Left out.

**Arizona liquor license lookup (`azliquor.gov`).** Real potential — a
suspended or revoked license would be a strong, legitimate red flag for a
restaurant serving alcohol. But `azliquor.gov/robots.txt` returns a 404
(no file at all) and no terms of use were found on the pages checked.
That's a weaker signal than an explicit "public record, free" statement
like the health department gave, or a robots.txt that names what's fine
to crawl. Listed here as a real candidate for later, not wired into
scoring yet — same bar as everything else on this page: verify, then use,
not the other way around.

**Reservation demand / "how busy is this place right now" — checked
directly, no compliant source exists.**
1. **OpenTable.** Checked their API partner FAQ directly: access is not
   self-serve for a developer. Quoting them: prospective partners "submit
   a partner application," and a restaurant itself must "work with your
   account management team" — there is no open endpoint to just query
   availability. Partnership-only, not a "not yet integrated" item.
   Source: https://www.opentable.com/restaurant-solutions/api-partners/faqs/
2. **Resy.** No usable robots.txt/terms content could be retrieved to
   verify a safe path in; treated the same as `azliquor.gov` above —
   unverified, so not used, not a "probably fine."
3. **Google's "popular times" / live busyness data.** This is not part of
   the official Google Places API — Google has never published it as a
   documented field. Every tool that offers it (Apify, SerpApi,
   `populartimes`-style Python/JS libraries) works by scraping Google
   Maps' own undocumented internal endpoints, which is exactly the same
   category of terms violation as scraping Yelp directly, not a
   loophole. Excluded on that basis, not because it wasn't found.

Bottom line: nothing today can honestly show "X tables open right now" or
a live popularity number without either an OpenTable partnership deal or
building on top of someone else's ToS violation. Faking this number for a
real restaurant is off the table the same way a fabricated score is —
this stays a documented gap, not a guessed value, until one of those
becomes real.

## Requires partnership / licensing before use

- **OpenTable** — see the full entry above; partner-application only, not
  a public API.
- **Nextdoor** — no public API for community content. Partnership only.
- **Facebook / Meta Page reviews** — third-party access to page ratings
  has been heavily restricted since 2018; not accessible without the
  page owner's own access token.
- **Reddit** — API requires a paid commercial agreement at any real
  volume (2023+ terms).
- **Editorial / press coverage at scale** — don't scrape arbitrary news
  sites' own pages against their terms. Use a licensed news/search API
  (a paid news API, or a search API with commercial terms) instead of
  ad hoc fetching.

## What changed from the original plan, and why that's fine

The original scoring model (v1) had six factors, two of which — "review
authenticity" and "reservation demand" — had no legal data source once
checked (they assumed Yelp review-pattern access and OpenTable
availability, both blocked above). `scoring.mjs` v3 uses six factors, all
with a real, currently-legal source: Google rating, Google review volume,
health inspection record, verified business license, site freshness, and
editorial mentions. A narrower, fully-legal model beats a broader one with
factors that can't actually be filled in without breaking someone's terms
of service.
