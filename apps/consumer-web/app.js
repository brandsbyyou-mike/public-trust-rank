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

// --- Deterministic "yesterday" delta for demo purposes --------------------
// Real system: this comes from services/agents/ storing yesterday's score.
// Here it's derived from the id so the demo is stable across reloads.
function fakeYesterdayDelta(id, score) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const delta = (hash % 7) - 3; // -3..+3
  return { delta, yesterday: score - delta };
}

// --- Data load -------------------------------------------------------------
async function loadData() {
  const res = await fetch("../../data/seeds/scottsdale-restaurants.json");
  const json = await res.json();

  state.restaurants = json.restaurants.map((r) => {
    const result = scoreRestaurant(r.evidence);
    const { delta } = fakeYesterdayDelta(r.id, result.score);
    return { ...r, ...result, delta };
  });

  state.cuisines = ["All", ...new Set(state.restaurants.map((r) => r.cuisine))].sort(
    (a, b) => (a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b))
  );
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
    const el = pinElement(r.score);
    el.addEventListener("click", () => openDetail(r.id));
    const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([r.lng, r.lat])
      .addTo(map);
    state.markers.set(r.id, marker);
  }
}

// --- List ---------------------------------------------------------------
function deltaLabel(delta) {
  if (delta > 0) return { cls: "up", text: `▲ ${delta} since yesterday` };
  if (delta < 0) return { cls: "down", text: `▼ ${Math.abs(delta)} since yesterday` };
  return { cls: "flat", text: "— no change since yesterday" };
}

function renderList(list) {
  const el = document.getElementById("list");
  el.innerHTML = "";
  if (list.length === 0) {
    el.innerHTML = `<p style="color:var(--text-dim);font-size:13px;padding:12px;">No restaurants match that search.</p>`;
    return;
  }
  for (const r of list) {
    const d = deltaLabel(r.delta);
    // Distance and the day-over-day delta are two different, both-useful
    // facts -- show both when a location is available instead of one
    // replacing the other. Distance up top (what "Near me" was asked for),
    // delta right under it (the score-freshness signal, which matters more
    // day to day than proximity).
    const distanceHtml =
      state.userLocation != null
        ? `<p class="card-delta flat">${r._distanceMiles.toFixed(1)} mi away</p>`
        : "";
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = r.id;
    card.innerHTML = `
      <div class="score-badge">${r.score}</div>
      <div class="card-body">
        <p class="card-name">${r.name}</p>
        <p class="card-meta">${r.cuisine} · ${r.neighborhood} · ${"$".repeat(r.priceLevel)}</p>
        ${distanceHtml}
        <p class="card-delta ${d.cls}">${d.text}</p>
      </div>`;
    card.addEventListener("click", () => openDetail(r.id));
    el.appendChild(card);
  }
}

// --- Detail panel ---------------------------------------------------------
function openDetail(id) {
  const r = state.restaurants.find((x) => x.id === id);
  if (!r) return;

  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("active", c.dataset.id === id));

  const panel = document.getElementById("detail-panel");
  const factorsHtml = Object.entries(r.breakdown)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .map(([factor, b]) => {
      const pct = Math.round(b.value * 100);
      return `<div class="factor-row">
        <span>${FACTOR_LABELS[factor]}</span>
        <span class="factor-track"><span class="factor-fill" style="width:${pct}%"></span></span>
        <span class="factor-pct">${pct}%</span>
      </div>`;
    })
    .join("");

  const reasonsHtml = r.topReasons.map((line) => `<div class="reason-line">${line}</div>`).join("");
  const confidencePct = Math.round(r.confidence * 100);
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  panel.innerHTML = `
    <button class="detail-close" id="detail-close" aria-label="Close">✕</button>
    <p class="card-meta" style="margin-top:0;">${r.cuisine} · ${r.neighborhood}</p>
    <h2 style="margin:2px 0 0;font-size:20px;">${r.name}</h2>
    <div class="detail-score-row">
      <span class="detail-score">${r.score}</span>
      <div>
        <div class="card-delta ${deltaLabel(r.delta).cls}">${deltaLabel(r.delta).text}</div>
        <div class="detail-updated">Updated ${today}</div>
      </div>
    </div>
    <span class="confidence-badge">${confidencePct}% data confidence</span>

    <p class="section-label">Why this score</p>
    ${reasonsHtml}

    <p class="section-label">Signal breakdown</p>
    ${factorsHtml}

    <p class="no-sponsor-note">No paid placement. This score is not affected by advertising, subscription tier, or claimed-listing status — the ranking model has no field for any of those.</p>
  `;

  document.getElementById("detail-close").addEventListener("click", closeDetail);
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.getElementById("detail-scrim").classList.add("open");

  if (map) map.flyTo({ center: [r.lng, r.lat], essential: true });
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
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.neighborhood.toLowerCase().includes(q));

  if (state.userLocation) {
    for (const r of filtered) {
      r._distanceMiles = distanceMiles(state.userLocation.lat, state.userLocation.lng, r.lat, r.lng);
    }
    filtered.sort((a, b) => a._distanceMiles - b._distanceMiles);
  } else {
    filtered.sort((a, b) => b.score - a.score);
  }

  renderList(filtered);
  renderMarkers(filtered);
}

// --- Boot --------------------------------------------------------------
async function main() {
  initTheme();
  initMap();
  await loadData();
  applyFilters();

  document.getElementById("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    applyFilters();
  });
  document.getElementById("detail-scrim").addEventListener("click", closeDetail);
}

main();
