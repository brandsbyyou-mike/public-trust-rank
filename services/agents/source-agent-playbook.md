# Source Agent Playbook — How to Actually Get Each Data Point

This is not the legal policy doc (that's `docs/source-policy/approved-sources.md`
— read it first, it decides what's allowed). This is the mechanical
how-to: the exact techniques that worked when this was tested by hand on
two real restaurants (Dominick's Steakhouse, The Mission Old Town —
2026-09-01, full trail in `apps/consumer-web/real-pilot.html`), so the
source agent isn't rediscovering this from scratch. Follow this in order
for every restaurant.

## 1. Google rating

**Production path:** Google Places API (Place Details) with a real API
key returns `rating` and `user_ratings_total` directly. Wire this in
first — it's the highest-weight factor (26%) and the cleanest source once
a key exists.

**Manual fallback (used this round, no key available):** search the
restaurant name plus city, and look for a source that explicitly states
the number is *Google's* rating — one aggregator site did this verbatim
("X is what this steakhouse got from the Google rating system"). Only
count a number toward `googleRating` if the source names Google
specifically. A rating quoted without a named platform (this happened for
the second restaurant tested) is real data but goes in with a flagged,
lower-confidence note — don't silently treat it as equivalent.

**Do not** fetch `google.com/maps` directly expecting rating data — it's
JavaScript-rendered and a plain fetch returns nothing. That's not a
workaround opportunity; leave it alone, same reasoning as the "popular
times" exclusion in the source policy doc.

## 2. Business license verification (the endpoint isn't where it looks)

The dataset's public "about" page (`data.scottsdaleaz.gov/datasets/business-licenses/about`)
does **not** expose a query endpoint in its visible content. Here's what
actually works:

1. Find the ArcGIS Hub item ID from the dataset's Hub URL, e.g.
   `data-cos-gis.hub.arcgis.com/datasets/<ITEM_ID>`.
2. Fetch `https://www.arcgis.com/sharing/rest/content/items/<ITEM_ID>?f=json`
   — the `url` field in that JSON is the real MapServer/FeatureServer REST
   endpoint. (For business licenses, this resolved to
   `https://maps.scottsdaleaz.gov/arcgis/rest/services/OpenData_Tabular/MapServer/6`.)
3. Fetch `<that url>?f=json` to get the actual field names before
   querying — they are not the obvious ones. This layer uses `Company`,
   `AcctStatus`, `BusinessStartDate`, `ServAddrComp` — not
   `BUSINESS_NAME` or anything guessable.
4. Query: `<that url>/query?where=Company+LIKE+%27%25<NAME>%25%27&outFields=*&f=json`
5. **Always confirm the match by address** (`ServAddrComp`) against the
   restaurant's known street address before using a record. A name-only
   match is not reliable — a single query for "MISSION" returned 17
   unrelated businesses (a Montessori school, a transmission shop, a
   defense contractor) alongside the one real match.
6. Convert `AcctStatus == "Active"` plus tenure (today minus
   `BusinessStartDate`) into the 0–1 `licenseVerified` value. **No fixed
   formula exists yet** — this round used judgment (Active + 8+ years ≈
   0.9–0.95). Write and commit an actual formula before this runs
   unattended (e.g. `Active` required at all, then tenure years / 20
   capped at 1.0, or similar) — a human picking a number per restaurant
   does not scale and isn't reproducible.
7. Respect the 60-second crawl delay from `robots.txt` (already documented
   in the source policy) for any batch of these queries.

This same technique — pull the ArcGIS item's `?f=json` metadata to find
the real service URL, rather than trusting the dataset landing page —
likely works for any other city or county open-data portal built on
ArcGIS Hub, which is most of them. Try it first before concluding a new
market's data isn't queryable.

## 3. Editorial mentions

A generic search ("restaurant name + news") undersold one restaurant's
real coverage on the first attempt. What actually surfaced it: searching
the restaurant name together with specific named outlets likely to cover
local restaurants (Phoenix New Times, AZ Foothills, Scottsdale Lifestyles
Magazine, local newspapers) and, where known, the chef's name. Also check
the business's own site for a "News" or "Press" page — it's a pointer to
real coverage even though the page itself isn't the citable source; verify
each linked piece actually exists on the real outlet before citing it.

## 4. Site freshness

Concrete signals that worked, in order of reliability:
- The page's `Last-Modified` metadata timestamp, if present.
- Dated PDF menu files linked from the page — a menu dated within the
  last few months is a strong signal; one over a year old is weak.
- Stale content still live past its own relevance window (e.g. a page
  still advertising "opening Winter 2025" well after that date) is a
  concrete negative signal, not just an absence of a positive one.

**No fixed formula exists yet either** — this round converted these
findings to a 0–1 value by judgment. Before this runs unattended, define
an actual curve (e.g. days-since-last-menu-update mapped to a decay
function) so two different runs of the agent produce the same number for
the same evidence.

## 5. Health inspection — the one still-open wall

Maricopa County's inspection search (`envapp.maricopa.gov/EnvironmentalHealth/FoodInspections`)
loads results via JavaScript/AJAX after a form submit — a plain HTTP
fetch only ever returns the empty search template, never results. This is
the one factor that could not be filled in during this test. In order of
what to try:

1. **Find the underlying AJAX/API endpoint** the page's own JavaScript
   calls after a search — the same technique that worked in step 2 above
   (inspect what the page requests, not what the landing page shows).
   This was not attempted yet for this specific tool; try it before
   assuming real browser automation is required.
2. **Real browser automation** (not a static fetcher) that fills the form
   and reads the rendered result, run somewhere with direct network
   access to `envapp.maricopa.gov`. The sandbox this playbook was written
   in specifically blocked outbound access to that host at the network
   level — that's an environment limitation of that one development
   session, not a statement that the site itself is unreachable.

This is confirmed public record data — the county's own page states
inspection reports "are made available to the general public here at no
charge." The legal position is already clean (see source policy doc);
only the retrieval mechanism is unsolved. Don't let that turn into an
excuse to guess a value here — a fabricated inspection outcome for a real
restaurant is exactly the kind of claim this product exists to never
make.

## Confidence should be computed, not picked

This test round set `confidence: 0.83` by hand (5 of 6 factors real).
The production ranking agent should compute this automatically —
`filled_factors / 6` at minimum, or better, a weighted version where a
missing high-weight factor (health inspection at 18%, or Google rating at
26%) drops confidence more than a missing low-weight one (site freshness
at 12%). Flag this as a real TODO before the daily job goes live, not
something to keep doing by hand per restaurant.

## Summary — what's actually solved vs. what's actually still hard

Solved this round (repeatable, not lucky): business license verification
(step 2), the editorial-search pattern (step 3), site-freshness signals
(step 4). Not fully solved: Google rating still wants a real Places API
key to stop depending on manual citation; health inspection still needs
either the hidden AJAX endpoint or real browser automation with network
access this test session didn't have. Wire the Places API key first —
it's both the easiest fix and the highest-weight factor.
