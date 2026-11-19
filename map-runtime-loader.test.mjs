import test from "node:test";
import assert from "node:assert/strict";
import { createMapRuntimeLoader, mapRuntimeResources } from "./map-runtime-loader.mjs";

function fakeBrowser({ failAt = null } = {}) {
  const appended = [];
  const window = {};
  const document = {
    head: {
      appendChild(element) {
        appended.push(element.href || element.src);
        if ((element.src || element.href) === failAt) {
          element.onerror?.();
          return;
        }
        if (element.src === "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js") window.L = {};
        if (element.src === "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.js") window.mapboxgl = {};
        if (element.src === "js/dante-geocoding.js") window.DanteGeocoding = {};
        if (element.src === "js/dante-map.js") window.DanteMap = {};
        element.onload?.();
      }
    },
    createElement(tag) {
      return { tagName: tag.toUpperCase(), dataset: {} };
    }
  };
  return { document, window, appended };
}

test("map resources are not loaded until the returned loader is called", () => {
  const browser = fakeBrowser();
  createMapRuntimeLoader(browser);
  assert.deepEqual(browser.appended, []);
});

test("map styles and scripts load once, in dependency order", async () => {
  const browser = fakeBrowser();
  const ensureMapRuntime = createMapRuntimeLoader(browser);

  const [first, second] = await Promise.all([ensureMapRuntime(), ensureMapRuntime()]);

  assert.equal(first, browser.window.DanteMap);
  assert.equal(second, browser.window.DanteMap);
  assert.deepEqual(browser.appended.slice(0, 2), mapRuntimeResources.styles.map(item => item.href));
  assert.deepEqual(browser.appended.slice(2), mapRuntimeResources.scripts.map(item => item.src));
});

test("failed map loading rejects and permits a later retry", async () => {
  const browser = fakeBrowser({ failAt: "js/dante-map.js" });
  const ensureMapRuntime = createMapRuntimeLoader(browser);

  await assert.rejects(ensureMapRuntime(), /No se pudo cargar un componente del mapa/);
  const firstAttemptCount = browser.appended.length;
  browser.document.head.appendChild = element => {
    browser.appended.push(element.href || element.src);
    if (element.src === "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js") browser.window.L = {};
    if (element.src === "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.js") browser.window.mapboxgl = {};
    if (element.src === "js/dante-geocoding.js") browser.window.DanteGeocoding = {};
    if (element.src === "js/dante-map.js") browser.window.DanteMap = {};
    element.onload?.();
  };

  const map = await ensureMapRuntime();
  assert.equal(map, browser.window.DanteMap);
  assert.deepEqual(browser.appended.slice(firstAttemptCount), ["js/dante-map.js"]);
});

test("Mapbox CDN failure falls back to the Leaflet engine", async () => {
  const browser = fakeBrowser({ failAt: "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.js" });
  const ensureMapRuntime = createMapRuntimeLoader(browser);

  const map = await ensureMapRuntime();

  assert.equal(map, browser.window.DanteMap);
  assert.ok(browser.window.L);
  assert.equal(browser.window.mapboxgl, undefined);
});

test("Leaflet CDN failure falls back to the Mapbox engine", async () => {
  const browser = fakeBrowser({ failAt: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" });
  const ensureMapRuntime = createMapRuntimeLoader(browser);

  const map = await ensureMapRuntime();

  assert.equal(map, browser.window.DanteMap);
  assert.equal(browser.window.L, undefined);
  assert.ok(browser.window.mapboxgl);
});

test("loading fails only when neither rendering engine is available", async () => {
  const browser = fakeBrowser();
  const originalAppend = browser.document.head.appendChild;
  browser.document.head.appendChild = element => {
    if (element.src === "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" ||
        element.src === "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.js") {
      element.onerror?.();
      return;
    }
    originalAppend(element);
  };

  await assert.rejects(createMapRuntimeLoader(browser)(), /No se pudo cargar ningún motor cartográfico/);
});
