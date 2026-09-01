import { scoreRestaurant, FACTOR_LABELS } from "../../services/ranking-engine/scoring.mjs";

// Mapbox wants [lng, lat] everywhere, the opposite order of the [lat, lng]
// pairs used in the data files -- this is the one place that matters.
const SCOTTSDALE_CENTER_LNGLAT = [-111.92, 33.5];

const state = {
  restaurants: [],
  cuisines: [],
  activeCuisine: "All",
  query: "",
  markers: new Map(),
  userLocation: null, // { lat, lng } once "Near me" is granted -- never requested automatically
};

// --- Distance ("Near me") --------------------------------------------------
// Haversine, plain math, no API call and no cost -- distance-to-user is
// computed entirely client-side from lat/lng already in the data.
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setLocateStatus(text, show) {
  const el = document.getElementById("locate-status");
  if (!el) return;
  el.textContent = text;
  el.style.display = show ? "block" : "none";
}

// --- Theme ---------------------------------------------------------------
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("ptr-theme"); } catch (e) { /* ignore */ }
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ptr-theme", next); } catch (e) { /* ignore */ }
  });
}

// --- Mobile view toggle ----------------------------------------------------
// Below the 720px breakpoint, list and map are full-screen tabs (see
// styles.css) instead of both sharing a cramped 45vh/55vh split. No-ops
// harmlessly above that width since the toggle bar is hidden by CSS and
// .layout never gets the mobile-show-list class from anything else.
function initMobileViewToggle() {
  const toggle = document.getElementById("mobile-view-toggle");
  const layout = document.querySelector(".layout");
  if (!toggle || !layout) return;

  toggle.querySelectorAll(".mvt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".mvt-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const showMap = btn.dataset.view === "map";
      // Map is the default pane (no modifier class); .mobile-show-list
      // switches to the list instead -- see styles.css.
      layout.classList.toggle("mobile-show-list", !showMap);
      // Mapbox GL sizes its canvas from the container's dimensions at the
      // moment it last rendered; a container that was display:none has no
      // dimensions, so the map needs an explicit resize the first time it
      // becomes visible or it renders blank/cropped until manually panned.
      if (showMap && map) map.resize();
    });
  });
}

// --- Data load -------------------------------------------------------------
// Real, named Scottsdale restaurants -- the same two files real-pilot.html
// reads, merged the same way: identity (name, address, cuisine when known)
// comes from the snapshot; score, breakdown, and confidence come from the
// live pipeline's evidence, scored client-side via scoreRestaurant() so the
// number always reflects the current scoring formula, not a stale cached
// one. A restaurant the pipeline hasn't reached yet (confidence 0, or no
// live entry at all) renders as an honest "not yet scored" placeholder --
// no map pin, no invented number.
const SNAPSHOT_PATH = "../../data/real-pilot/scottsdale-real-snapshot.json";
const LIVE_DATA_PATH = "../../data/real-pilot/scottsdale-live-scores.json";

async function loadJson(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildRestaurant(staticEntry, liveEntry) {
  const lat = liveEntry?.lat ?? staticEntry.lat ?? null;
  const lng = liveEntry?.lng ?? staticEntry.lng ?? null;
  const base = {
    id: staticEntry.id,
    name: staticEntry.name,
    address: staticEntry.address,
    cuisine: staticEntry.cuisine || null,
    lat,
    lng,
  };

  const scored = liveEntry && liveEntry.confidence > 0;
  if (!scored) return { ...base, scored: false };

  const result = scoreRestaurant(liveEntry.evidence);
  return {
    ...base,
    name: liveEntry.name || staticEntry.name,
    scored: true,
    ...result, // score, breakdown, topReasons, confidence
    factors: liveEntry.factors || {},
    dishMentions: liveEntry.dish_mentions || [],
    serviceMentions: liveEntry.service_mentions || [],
    recentReviews: liveEntry.recent_reviews || null,
    delta: liveEntry.score_delta ?? null,
    deltaSince: liveEntry.delta_since ?? null,
  };
}

async function loadData() {
  const [snapshot, live] = await Promise.all([loadJson(SNAPSHOT_PATH), loadJson(LIVE_DATA_PATH)]);
  const liveById = new Map((live?.restaurants || []).map((r) => [r.id, r]));
  const restaurants = snapshot?.restaurants || [];

  state.restaurants = restaurants.map((s) => buildRestaurant(s, liveById.get(s.id)));

  state.cuisines = [
    "All",
    ...new Set(state.restaurants.map((r) => r.cuisine).filter(Boolean)),
  ].sort((a, b) => (a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b)));
}

// --- Map (Mapbox GL JS) -----------------------------------------------------
// Switched from Leaflet/OpenStreetMap to Mapbox GL JS this round -- vector
// rendering, matches the visual polish people expect from Google/Apple/
// Tesla-style maps far better than raster OSM tiles did, and its free tier
// (50,000 map loads/month) covers a pilot's traffic with room to spare. See
// docs/launch/scaling-to-full-scottsdale.md for the full comparison and
// why Mapbox was chosen over the Google Maps JavaScript API specifically.
//
// Requires config.js to set window.MAPBOX_ACCESS_TOKEN to a real token
// (free at https://account.mapbox.com/access-tokens/). Without one, the
// map area shows a plain setup message instead of a broken/blank map or a
// cryptic SDK error -- the rest of the app (search, filters, list, detail
// panel) works either way, since none of that depends on the map.
let map = null;
let mapReady = false;

function showMapSetupMessage(reason) {
  const el = document.getElementById("map");
  if (!el) return;
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:var(--text-dim);font-size:13px;">
    ${reason}
  </div>`;
}

function initMap() {
  const token = window.MAPBOX_ACCESS_TOKEN;
  const hasRealToken = typeof token === "string" && token.startsWith("pk.") && !token.includes("PASTE_YOUR");

  if (typeof mapboxgl === "undefined") {
    // Mapbox GL JS itself didn't load (blocked network, offline, ad
    // blocker, etc.) -- fail soft, not hard. Search/filters/list/detail
    // panel below don't depend on the map and still work.
    showMapSetupMessage("Map library didn't load. Check your internet connection — the rest of the app still works.");
    return;
  }
  if (!hasRealToken) {
    showMapSetupMessage("Map needs a free Mapbox token — open apps/consumer-web/config.js and paste one in. See docs/launch/scaling-to-full-scottsdale.md.");
    return;
  }

  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: SCOTTSDALE_CENTER_LNGLAT,
    zoom: 11,
  });
  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  // Built-in geolocate control -- the same target-icon button and blue
  // pulsing dot people already know from Google Maps' own web app. Handles
  // permission prompting itself; we just listen for the result to drive
  // the distance-sorted list.
  const geolocate = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: false },
    trackUserLocation: false,
    showUserHeading: false,
  });
  map.addControl(geolocate, "top-right");

  geolocate.on("geolocate", (pos) => {
    state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setLocateStatus("Showing distance from your current location, nearest first.", true);
    applyFilters();
  });
  geolocate.on("error", (err) => {
    const msg =
      err.code === 1 // PERMISSION_DENIED
        ? "Location permission was denied — you can still browse and search normally."
        : "Couldn't get your location — you can still browse and search normally.";
    setLocateStatus(msg, true);
  });

  map.on("load", () => { mapReady = true; });
}

function pinElement(score) {
  const div = document.createElement("div");
  div.className = "map-pin";
  div.innerHTML = `<span>${score}</span>`;
  return div;
}

function renderMarkers(list) {
  if (!map) return; // map unavailable (no token / blocked script) -- list still works
  for (const m of state.markers.values()) m.remove();
  state.markers.clear();

  for (const r of list) {
    // Skip restaurants with no score yet or no resolved coordinates --
    // a pin has to show a real number and sit at a real place, never a
    // placeholder in either spot.
    if (!r.scored || r.lat == null || r.lng == null) continue;
    const el = pinElement(r.score);
    el.addEventListener("click", () => openDetail(r.id));
    const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([r.lng, r.lat])
      .addTo(map);
    state.markers.set(r.id, marker);
  }
}

// --- List ---------------------------------------------------------------
// Real day-over-day change, from score-history.json via the pipeline --
// "since <date>" is a calendar date the score actually changed against,
// not a fetch timestamp (see the note above fetchGooglePlaces() in
// run.mjs for why fetch timing itself is never surfaced in the UI).
function deltaLabel(r) {
  if (r.delta === null || r.delta === undefined) return null;
  if (r.delta > 0) return { cls: "up", text: `▲ ${r.delta} since ${r.deltaSince}` };
  if (r.delta < 0) return { cls: "down", text: `▼ ${Math.abs(r.delta)} since ${r.deltaSince}` };
  return { cls: "flat", text: `No change since ${r.deltaSince}` };
}

function renderList(list) {
  const el = document.getElementById("list");
  el.innerHTML = "";
  if (list.length === 0) {
    el.innerHTML = `<p style="color:var(--text-dim);font-size:13px;padding:12px;">No restaurants match that search.</p>`;
    return;
  }
  for (const r of list) {
    const metaHtml = [r.cuisine, r.address].filter(Boolean).join(" · ");
    const card = document.createElement("div");
    card.dataset.id = r.id;

    if (!r.scored) {
      card.className = "card unscored";
      card.innerHTML = `
        <div class="score-badge unscored">—</div>
        <div class="card-body">
          <p class="card-name">${r.name}</p>
          <p class="card-meta">${metaHtml}</p>
          <p class="card-delta unscored">Not yet scored — picked up by the next pipeline run</p>
        </div>`;
      card.addEventListener("click", () => openDetail(r.id));
      el.appendChild(card);
      continue;
    }

    const d = deltaLabel(r);
    // Distance and the day-over-day delta are two different, both-useful
    // facts -- show both when a location is available instead of one
    // replacing the other. Distance up top (what "Near me" was asked for),
    // delta right under it (the score-freshness signal, which matters more
    // day to day than proximity).
    const distanceHtml =
      state.userLocation != null && r._distanceMiles != null
        ? `<p class="card-delta flat">${r._distanceMiles.toFixed(1)} mi away</p>`
        : "";
    card.className = "card";
    card.innerHTML = `
      <div class="score-badge">${r.score}</div>
      <div class="card-body">
        <p class="card-name">${r.name}</p>
        <p class="card-meta">${metaHtml}</p>
        ${distanceHtml}
        ${d ? `<p class="card-delta ${d.cls}">${d.text}</p>` : ""}
      </div>`;
    card.addEventListener("click", () => openDetail(r.id));
    el.appendChild(card);
  }
}

// --- Detail panel ---------------------------------------------------------
// Same rendering for the food-term list and the service/experience-term
// list, just a different heading -- both are derived counts from the same
// up-to-5 reviews, never raw text (see the DISH MENTIONS comment in
// run.mjs).
function mentionChipsHtml(label, mentions) {
  if (!mentions || !mentions.length) return "";
  const top = mentions.slice(0, 5).map((m) => {
    const stars = m.avg_rating !== null && m.avg_rating !== undefined ? ` (avg ${m.avg_rating}★)` : "";
    return `<span class="dish-chip">${m.term}${stars}</span>`;
  }).join("");
  return `<p class="section-label">${label}</p><div class="dish-chips">${top}</div>`;
}

// The overall average of that same review sample -- Google's own star
// ratings, not a text summary, so it stays inside the same rule.
function recentReviewsHtml(sample) {
  if (!sample || !sample.count || sample.avg_rating === null || sample.avg_rating === undefined) return "";
  return `<p class="card-delta flat">Recent reviews: ${sample.avg_rating}★ avg (${sample.count} scanned)</p>`;
}

function openDetail(id) {
  const r = state.restaurants.find((x) => x.id === id);
  if (!r) return;

  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("active", c.dataset.id === id));

  const panel = document.getElementById("detail-panel");

  if (!r.scored) {
    panel.innerHTML = `
      <button class="detail-close" id="detail-close" aria-label="Close">✕</button>
      <p class="card-meta" style="margin-top:0;">${[r.cuisine, r.address].filter(Boolean).join(" · ")}</p>
      <h2 style="margin:2px 0 0;font-size:20px;">${r.name}</h2>
      <span class="confidence-badge" style="margin-top:14px;">Not yet scored — picked up by the next pipeline run</span>
    `;
    document.getElementById("detail-close").addEventListener("click", closeDetail);
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    document.getElementById("detail-scrim").classList.add("open");
    if (map && r.lat != null && r.lng != null) map.flyTo({ center: [r.lng, r.lat], essential: true });
    return;
  }

  const factorsHtml = Object.entries(r.breakdown)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .map(([factor, b]) => {
      // b.known === false means this factor was never counted toward the
      // score (see scoring.mjs) -- "—" says that honestly; "0%" would read
      // as "measured and found lacking," which isn't what happened.
      const pct = b.known ? Math.round(b.value * 100) : null;
      const note = r.factors[factor]?.note || "not available yet";
      return `<div class="factor-row">
        <span>${FACTOR_LABELS[factor]}</span>
        <span class="factor-track"><span class="factor-fill" style="width:${pct ?? 0}%"></span></span>
        <span class="factor-pct">${pct !== null ? `${pct}%` : "—"}</span>
      </div>
      <p class="factor-source">${note}</p>`;
    })
    .join("");

  const reasonsHtml = r.topReasons.map((line) => `<div class="reason-line">${line}</div>`).join("");
  const confidencePct = Math.round(r.confidence * 100);
  const d = deltaLabel(r);

  panel.innerHTML = `
    <button class="detail-close" id="detail-close" aria-label="Close">✕</button>
    <p class="card-meta" style="margin-top:0;">${[r.cuisine, r.address].filter(Boolean).join(" · ")}</p>
    <h2 style="margin:2px 0 0;font-size:20px;">${r.name}</h2>
    <div class="detail-score-row">
      <span class="detail-score">${r.score}</span>
      ${d ? `<div class="card-delta ${d.cls}">${d.text}</div>` : ""}
    </div>
    <span class="confidence-badge">${confidencePct}% data confidence</span>

    <p class="section-label">Why this score</p>
    ${reasonsHtml}

    <p class="section-label">Signal breakdown &amp; sources</p>
    ${factorsHtml}
    ${recentReviewsHtml(r.recentReviews)}
    ${mentionChipsHtml("Notable in reviews", r.dishMentions)}
    ${mentionChipsHtml("Service &amp; experience", r.serviceMentions)}

    <p class="no-sponsor-note">No paid placement. This score is not affected by advertising, subscription tier, or claimed-listing status — the ranking model has no field for any of those.</p>
  `;

  document.getElementById("detail-close").addEventListener("click", closeDetail);
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.getElementById("detail-scrim").classList.add("open");

  if (map && r.lat != null && r.lng != null) map.flyTo({ center: [r.lng, r.lat], essential: true });
}

function closeDetail() {
  document.getElementById("detail-panel").classList.remove("open");
  document.getElementById("detail-panel").setAttribute("aria-hidden", "true");
  document.getElementById("detail-scrim").classList.remove("open");
}

// --- Filters ---------------------------------------------------------------
function renderFilters() {
  const el = document.getElementById("filters");
  el.innerHTML = "";
  for (const cuisine of state.cuisines) {
    const pill = document.createElement("button");
    pill.className = "filter-pill" + (cuisine === state.activeCuisine ? " active" : "");
    pill.textContent = cuisine;
    pill.addEventListener("click", () => {
      state.activeCuisine = cuisine;
      applyFilters();
    });
    el.appendChild(pill);
  }
}

function applyFilters() {
  renderFilters();
  const q = state.query.trim().toLowerCase();
  const filtered = state.restaurants
    .filter((r) => state.activeCuisine === "All" || r.cuisine === state.activeCuisine)
    .filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.cuisine || "").toLowerCase().includes(q) ||
        (r.address || "").toLowerCase().includes(q)
    );

  if (state.userLocation) {
    for (const r of filtered) {
      r._distanceMiles =
        r.lat != null && r.lng != null
          ? distanceMiles(state.userLocation.lat, state.userLocation.lng, r.lat, r.lng)
          : null;
    }
    // Restaurants with no resolved coordinates yet (a fresh addition the
    // pipeline hasn't geocoded) sort to the end instead of breaking the
    // distance sort or claiming a false distance.
    filtered.sort((a, b) => {
      if (a._distanceMiles == null && b._distanceMiles == null) return 0;
      if (a._distanceMiles == null) return 1;
      if (b._distanceMiles == null) return -1;
      return a._distanceMiles - b._distanceMiles;
    });
  } else {
    // Scored restaurants first, highest score first; anything not yet
    // scored falls to the end rather than sorting as a false zero.
    filtered.sort((a, b) => {
      if (a.scored && b.scored) return b.score - a.score;
      return a.scored ? -1 : b.scored ? 1 : 0;
    });
  }

  renderList(filtered);
  renderMarkers(filtered);
}

// --- Boot --------------------------------------------------------------
async function main() {
  initTheme();
  initMap();
  initMobileViewToggle();
  await loadData();
  applyFilters();

  // Map is the default pane on a mobile viewport now (no click needed to
  // get there), so it's visible from first paint -- give it the same
  // resize Mapbox GL needs after any display:none -> visible transition
  // (see the comment in initMobileViewToggle) instead of only doing that
  // on a tab click.
  if (map && window.matchMedia("(max-width: 720px)").matches) map.resize();

  document.getElementById("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    applyFilters();
  });
  document.getElementById("detail-scrim").addEventListener("click", closeDetail);
}

main();
