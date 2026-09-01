// Mapbox access token configuration.
//
// This is a PUBLIC token by design -- Mapbox's own security model expects
// it to be visible in browser network requests, the same way a Google Maps
// JavaScript API key is. The real protection is restricting it to your own
// domain(s) in the Mapbox dashboard (Tokens -> URL restrictions), not
// hiding it -- there is nothing to "leak" here the way there is with the
// GOOGLE_PLACES_API_KEY / GOOGLE_CSE_KEY secrets used server-side in
// services/agents/source-ingestion-agent/, which must NEVER go in a file
// like this one or anywhere client-visible.
//
// Get a free token: https://account.mapbox.com/access-tokens/
// (50,000 map loads/month free -- see docs/launch/scaling-to-full-scottsdale.md)
//
// This file is loaded directly by index.html and real-pilot.html. Edit the
// token below in place -- no build step, no copying to a different
// filename needed.

window.MAPBOX_ACCESS_TOKEN = "pk.eyJ1IjoicHVibGljcmFuazEyMzQ1IiwiYSI6ImNtdGkxZTRwbzAxb3gzMHEwaGY0bXhicnYifQ.03uSWrKZo9PJI96DZ0XPUw";
