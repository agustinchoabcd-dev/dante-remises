import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const adapter = await readFile(new URL("../../js/dante-map.js", import.meta.url), "utf8");
const config = await readFile(new URL("../../js/mapbox-config.js", import.meta.url), "utf8");

test("the production app pins Mapbox GL JS 3.35.0 while retaining Leaflet for fallback", () => {
  assert.match(html, /mapbox-gl-js\/v3\.35\.0\/mapbox-gl\.js/);
  assert.match(html, /mapbox-gl-js\/v3\.35\.0\/mapbox-gl\.css/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(html, /js\/dante-map\.js/);
  assert.match(html, /js\/mapbox-config\.js/);
});

test("passenger and driver maps use the shared adapter rather than direct Leaflet construction", () => {
  assert.equal((html.match(/DanteMap\.create\(/g) || []).length, 2);
  assert.equal((html.match(/DanteMap\.getDrivingRoute\(/g) || []).length, 2);
  assert.doesNotMatch(html, /L\.map\(/);
  assert.doesNotMatch(html, /L\.tileLayer\(/);
  assert.doesNotMatch(html, /L\.geoJSON\(/);
});

test("the adapter contains both renderers and preserves the Leaflet fallback", () => {
  assert.match(adapter, /class MapboxAdapter/);
  assert.match(adapter, /class LeafletAdapter/);
  assert.match(adapter, /mapboxgl\.supported\(\)/);
  assert.match(adapter, /return new LeafletAdapter/);
  assert.match(adapter, /addCircleMarker/);
  assert.match(adapter, /fitGeometry/);
  assert.match(adapter, /invalidateSize/);
});

test("routing prefers Mapbox driving and falls back to the existing LocationIQ endpoint", () => {
  assert.match(adapter, /directions\/v5\/mapbox\/driving/);
  assert.match(adapter, /us1\.locationiq\.com\/v1\/directions\/driving/);
  assert.match(adapter, /provider:'Mapbox'/);
  assert.match(adapter, /provider:'LocationIQ'/);
});

test("the token is injected at runtime and no access token is committed in source", () => {
  assert.match(adapter, /window\.DANTE_MAPBOX_TOKEN/);
  assert.match(config, /window\.DANTE_MAPBOX_TOKEN = window\.DANTE_MAPBOX_TOKEN \|\| ''/);
  assert.doesNotMatch(config, /pk\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(adapter, /pk\.[A-Za-z0-9_-]{20,}/);
});
