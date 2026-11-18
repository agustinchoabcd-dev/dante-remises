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
        if (element.src === failAt) {
          element.onerror?.();
          return;
        }
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
    if (element.src === "js/dante-geocoding.js") browser.window.DanteGeocoding = {};
    if (element.src === "js/dante-map.js") browser.window.DanteMap = {};
    element.onload?.();
  };

  const map = await ensureMapRuntime();
  assert.equal(map, browser.window.DanteMap);
  assert.deepEqual(browser.appended.slice(firstAttemptCount), ["js/dante-map.js"]);
});
