import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const adapter = await readFile(new URL("../../js/dante-map.js", import.meta.url), "utf8");
const config = await readFile(new URL("../../js/mapbox-config.js", import.meta.url), "utf8");
const geocoding = await readFile(new URL("../../js/dante-geocoding.js", import.meta.url), "utf8");
const geocodingConfig = await readFile(new URL("../../js/geocoding-config.js", import.meta.url), "utf8");
const copyScript = await readFile(new URL("../../scripts/copy-web.mjs", import.meta.url), "utf8");
const passengerTemplate = await readFile(new URL("../../views/passenger.html", import.meta.url), "utf8");
const driverTemplate = await readFile(new URL("../../views/driver.html", import.meta.url), "utf8");
const centralTemplate = await readFile(new URL("../../views/central.html", import.meta.url), "utf8");

test("the app pins Mapbox GL JS 3.35.0 and keeps the compatibility renderer isolated", () => {
  assert.match(html, /mapbox-gl-js\/v3\.35\.0\/mapbox-gl\.js/);
  assert.match(html, /mapbox-gl-js\/v3\.35\.0\/mapbox-gl\.css/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(html, /js\/dante-map\.js/);
  assert.match(html, /js\/mapbox-config\.js/);
  assert.match(html, /js\/dante-geocoding\.js/);
  assert.match(html, /js\/geocoding-config\.js/);
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

test("all road routing is performed by Mapbox Directions without a LocationIQ fallback", () => {
  assert.match(adapter, /directions\/v5\/mapbox\/driving/);
  assert.match(adapter, /MAPBOX_TOKEN_NOT_CONFIGURED/);
  assert.match(adapter, /provider:'Mapbox'/);
  assert.doesNotMatch(adapter, /locationiq\.com\/v1\/directions/);
  assert.equal((html.match(/DanteMap\.getDrivingRoute\(points\)/g) || []).length, 2);
});

test("Geoapify handles address autocomplete and reverse geocoding for Argentina", () => {
  assert.match(geocoding, /api\.geoapify\.com\/v1\/geocode\//);
  assert.match(geocoding, /countrycode:ar/);
  assert.match(geocoding, /Santa Rosa de Calamuchita, Córdoba, Argentina/);
  assert.match(geocoding, /function normalizeFeature/);
  assert.match(geocodingConfig, /window\.DANTE_GEOAPIFY_KEY = window\.DANTE_GEOAPIFY_KEY \|\| ''/);
  assert.doesNotMatch(html, /api\.locationiq\.com\/v1\/(autocomplete|reverse)/);
  assert.match(html, /DanteGeocoding\.reverse\(point\)/);
  assert.match(html, /Calle cercana no disponible/);
  assert.match(html, /Esperá a que se resuelva la dirección del punto seleccionado/);
});

test("provider credits stay in Settings while required map attribution remains inside map controls", () => {
  for (const [name, template] of [
    ["passenger", passengerTemplate],
    ["driver", driverTemplate],
    ["central", centralTemplate]
  ]) {
    assert.doesNotMatch(template, /Powered by Geoapify|OpenStreetMap|LocationIQ/);
  }
  assert.match(html, /id="creditsSettingsCard"/);
  assert.match(html, /Créditos y APIs utilizadas/);
  for (const provider of ["Mapbox","Geoapify","LocationIQ","OpenStreetMap","Leaflet","Firebase","Cloudflare Workers","Backblaze B2","Capacitor"]) {
    assert.match(html, new RegExp(provider.replace(/[.*+?^${}()|[\]\\]/g, "\\  assert.match(html, /Créditos y APIs utilizadas/);")), "Missing provider credit: " + provider);
  }
  assert.match(adapter, /new mapboxgl\.AttributionControl\(\{[\s\S]*?compact:false,[\s\S]*?Powered by Geoapify/);
  assert.match(adapter, /attributionControl\?\.addAttribution\(.*Powered by Geoapify/);
  assert.match(adapter, /OpenStreetMap/);
  assert.match(adapter, /LocationIQ/);
});

test("the token is injected at runtime and no access token is committed in source", () => {
  assert.match(adapter, /window\.DANTE_MAPBOX_TOKEN/);
  assert.match(config, /window\.DANTE_MAPBOX_TOKEN = window\.DANTE_MAPBOX_TOKEN \|\| ''/);
  assert.doesNotMatch(config, /pk\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(adapter, /pk\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(geocodingConfig, /[A-Fa-f0-9]{32,}/);
});

test("the Capacitor web copy includes both Mapbox runtime files", () => {
  assert.match(copyScript, /"js\/dante-map\.js"/);
  assert.match(copyScript, /"js\/mapbox-config\.js"/);
  assert.match(copyScript, /"js\/dante-geocoding\.js"/);
  assert.match(copyScript, /"js\/geocoding-config\.js"/);
  assert.match(copyScript, /new URL\("js\/", destinationDirectory\)/);
});


test("Geoapify autocomplete and reverse geocoding normalize real response shapes", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.window = {DANTE_GEOAPIFY_KEY: "test-geoapify-key"};
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url);
    const isReverse = url.pathname.endsWith("/reverse");
    return {
      ok: true,
      json: async () => ({features: [{
        geometry: {coordinates: [-64.536, -32.071]},
        properties: {lat: -32.071, lon: -64.536, formatted: "Mendoza 356, Santa Rosa de Calamuchita, Córdoba, Argentina"}
      }]})
    };
  };
  try {
    await import("../../js/dante-geocoding.js?test=geoapify-runtime");
    const api = globalThis.window.DanteGeocoding;
    const results = await api.autocomplete("Mendoza 356");
    assert.equal(results.length, 1);
    assert.equal(results[0].lat, -32.071);
    assert.equal(results[0].lon, -64.536);
    assert.match(results[0].label, /^Mendoza 356/);
    const address = await api.reverse({lat: -32.071, lon: -64.536});
    assert.match(address, /^Mendoza 356/);
    assert.equal(requested.length, 2);
    assert.equal(requested[0].searchParams.get("filter"), "countrycode:ar");
    assert.equal(requested[0].searchParams.get("lang"), "es");
    assert.equal(requested[0].searchParams.get("apiKey"), "test-geoapify-key");
    assert.equal(requested[1].searchParams.get("lat"), "-32.071");
    assert.equal(requested[1].searchParams.get("lon"), "-64.536");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
