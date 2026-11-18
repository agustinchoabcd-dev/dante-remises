import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, copyScript, serviceWorker] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8"),
  readFile(new URL("./service-worker.js", import.meta.url), "utf8")
]);

test("auth transition lock is applied before asynchronous account cleanup", () => {
  const callbackStart = html.indexOf("onAuthStateChanged(auth,async user=>");
  const callbackEnd = html.indexOf("\n});", callbackStart);
  assert.notEqual(callbackStart, -1);
  assert.notEqual(callbackEnd, -1);
  const callback = html.slice(callbackStart, callbackEnd);
  assert.ok(callback.indexOf("roleTransition.begin()") < callback.indexOf("await stopOperatorPresence()"));
  assert.ok(callback.includes("await activateRole(currentRole.role"));
});

test("passenger authentication never reveals configuration as a temporary screen", () => {
  assert.equal(html.includes("byId('configuracion').classList.remove('hidden')"), false);
  assert.match(html, /loadPassengerPhoto:async\(\)=>\{passengerPhotoReady=false;return await loadPassengerPhoto\(\)\}/);
});

test("map engines and chat/trip-alert clients are not eager application imports", () => {
  assert.doesNotMatch(html, /<script[^>]+src=["']https:\/\/(?:unpkg\.com\/leaflet|api\.mapbox\.com\/mapbox-gl-js)/i);
  assert.doesNotMatch(html, /import\s*\{[^}]*\}\s*from\s*["']\.\/chat-client\.mjs["']/);
  assert.doesNotMatch(html, /import\s*\{[^}]*\}\s*from\s*["']\.\/chat-history-cache\.mjs["']/);
  assert.doesNotMatch(html, /import\s*\{[^}]*\}\s*from\s*["']\.\/trip-alerts-client\.mjs["']/);
  assert.match(html, /await ensureMapRuntime\(\)/);
  assert.match(html, /await ensureChatModules\(\)/);
});

test("all dynamically imported runtime modules are included in the Capacitor web copy", () => {
  for (const asset of [
    "role-transition.mjs",
    "role-runtime.mjs",
    "map-runtime-loader.mjs",
    "chat-runtime-loader.mjs",
    "roles/passenger.mjs",
    "roles/driver.mjs",
    "roles/operator.mjs",
    "roles/admin.mjs"
  ]) {
    assert.ok(copyScript.includes('"' + asset + '"'), "Missing web asset: " + asset);
  }
});

test("service worker does not pre-download the map engine and caches app modules on demand", () => {
  assert.doesNotMatch(serviceWorker, /STATIC_ASSETS/);
  assert.match(serviceWorker, /url\.origin === self\.location\.origin/);
  assert.ok(serviceWorker.includes('/\\.(?:mjs|js)$/.test(url.pathname)'));
});
