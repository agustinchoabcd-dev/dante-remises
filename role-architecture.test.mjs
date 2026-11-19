import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, copyScript, serviceWorker, roleViewAccess, roleTemplateLoader, passengerTemplate, driverTemplate, roleDomBindings, passengerModule, driverModule, adminModule] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8"),
  readFile(new URL("./service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("./role-view-access.mjs", import.meta.url), "utf8"),
  readFile(new URL("./role-template-loader.mjs", import.meta.url), "utf8"),
  readFile(new URL("./views/passenger.html", import.meta.url), "utf8"),
  readFile(new URL("./views/driver.html", import.meta.url), "utf8"),
  readFile(new URL("./role-dom-bindings.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/passenger.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/driver.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/admin.mjs", import.meta.url), "utf8")
]);


test("driver HTML is physically extracted and mounted for driver and admin roles", () => {
  assert.doesNotMatch(html, /<section id="chofer"/);
  assert.ok(driverTemplate.includes('<section id="chofer"'));
  assert.match(roleTemplateLoader, /driver: "\.\/views\/driver\.html"/);
  assert.match(driverModule, /loadRoleView\("driver"\)/);
  assert.match(adminModule, /loadRoleView\("driver"\)/);
  assert.ok(html.includes("byId('driverControls')?.classList.toggle"));
  assert.ok(html.includes("if(byId('roleSummary'))byId('roleSummary').textContent=roleText"));
  assert.match(html, /loadRoleView:async role=>\{const result=await roleTemplateLoader\.load\(role\);if\(authGeneration!==authStateGeneration\)return \{stale:true\};if\(role==='driver'\)/);
});

test("driver view controls are registered through deferred role DOM bindings", () => {
  for (const id of ["driverStatus","driverTripInbox","driverActiveTrip","driverGpsStatus","busyDuration","setBusy","outDuration","setOut","setFree"]) {
    assert.ok(driverTemplate.includes('id="' + id + '"'), "Missing driver control: " + id);
  }
  assert.match(html, /bindRoleDom\('setBusy'/);
  assert.match(html, /bindRoleDom\('setOut'/);
  assert.match(html, /bindRoleDom\('setFree'/);
});

test("passenger HTML is physically extracted and mounted only after role resolution", () => {
  assert.ok(html.includes('<div id="roleViewMount"></div>'));
  assert.doesNotMatch(html, /<section id="pasajero"/);
  assert.doesNotMatch(html, /<section id="passengerOnboarding"/);
  assert.match(html, /createRoleTemplateLoader\(\{document,onMounted:\(\)=>flushRoleDomBindings\(\)\}\)/);
  assert.match(passengerModule, /loadRoleView\("passenger"\)/);
  assert.ok(passengerTemplate.includes('<section id="pasajero"'));
  assert.ok(passengerTemplate.includes('<section id="passengerOnboarding"'));
});

test("role event bindings survive a view being absent and mounted later", () => {
  assert.match(html, /createRoleDomBindings\(document\)/);
  assert.match(html, /const flushRoleDomBindings=roleDomBindings\.flush/);
  for (const match of passengerTemplate.matchAll(/\bid="([^"]+)"/g)) {
    assert.equal(html.includes("byId('" + match[1] + "').addEventListener("), false, "Passenger listener must be deferred: " + match[1]);
    assert.equal(html.includes('byId("' + match[1] + '").addEventListener('), false, "Passenger listener must be deferred: " + match[1]);
  }
  assert.match(html, /bindRoleDom\('passengerCars'/);
  assert.match(roleDomBindings, /function flush\(\)/);
});

test("passenger map resources are disposed and stale async work is invalidated on role changes", () => {
  assert.match(html, /passengerViewGeneration\+\+/);
  assert.match(html, /passengerRouteRequestVersion\+\+/);
  assert.match(html, /realMap\.remove\(\)/);
  assert.match(html, /autocompleteRequestIds\.origin\+\+/);
});

test("passenger address inputs register handlers before their HTML is mounted", () => {
  assert.ok(html.includes("['origin','destination'].forEach(id=>bindRoleDom(id,'input'"));
});

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
    "role-view-access.mjs",
    "role-template-loader.mjs",
    "role-dom-bindings.mjs",
    "views/passenger.html",
    "views/driver.html",
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
  assert.ok(serviceWorker.includes('/\\.(?:mjs|js|html)$/.test(url.pathname)'));
  assert.ok(roleTemplateLoader.includes('passenger: "./views/passenger.html"'));
  assert.ok(roleTemplateLoader.includes("requestGeneration !== generation"));
  assert.ok(passengerTemplate.includes('id="pasajero"'));
  assert.ok(passengerTemplate.includes('id="passengerOnboarding"'));
  assert.ok(!passengerTemplate.includes('id="central"'));
});

test("auth callback hides role views before asynchronous cleanup and activation", () => {
  const authStart = html.indexOf("onAuthStateChanged(auth,async user=>{");
  const hideIndex = html.indexOf("hideRoleViews(document)", authStart);
  const asyncCleanup = html.indexOf("await stopOperatorPresence()", authStart);
  const roleActivation = html.indexOf("roleActivation=await activateRole(currentRole.role", authStart);

  assert.notEqual(authStart, -1);
  assert.notEqual(hideIndex, -1);
  assert.notEqual(asyncCleanup, -1);
  assert.notEqual(roleActivation, -1);
  assert.ok(hideIndex < asyncCleanup);
  assert.ok(hideIndex < roleActivation);
  const callback = html.slice(authStart, html.indexOf("\n});", authStart));
  assert.ok(callback.indexOf("roleTemplateLoader.unmount()") < callback.indexOf("await stopOperatorPresence()"));

  for (const view of ["pasajero", "chofer", "central", "chat", "configuracion", "passengerOnboarding"]) {
    assert.ok(roleViewAccess.includes('"' + view + '"'), "Missing role view in visibility controller: " + view);
  }
});

test("role view controller is the only path that activates a workspace", () => {
  const callbackStart = html.indexOf("onAuthStateChanged(auth,async user=>{");
  const callbackEnd = html.indexOf("\n});", callbackStart);
  const callback = html.slice(callbackStart, callbackEnd);
  assert.match(callback, /hideRoleViews\(document\)/);
  assert.match(html, /applyRoleView\(document,currentRole\?\.role,v\)/);
  assert.doesNotMatch(callback, /byId\(['"](?:pasajero|chofer|central|chat|configuracion)['"]\)\.classList\.toggle\(['"]hidden['"]/);
  assert.doesNotMatch(callback, /byId\(['"]central['"]\)\.classList\.remove\(['"]hidden['"]/);
  for (const view of ["pasajero", "chofer", "central", "chat", "configuracion"]) {
    const directMutations = [
      "byId('" + view + "').classList.remove('hidden')",
      "byId('" + view + "').classList.toggle('hidden'",
      'byId("' + view + '").classList.remove("hidden")',
      'byId("' + view + '").classList.toggle("hidden"'
    ];
    for (const marker of directMutations) {
      assert.equal(html.includes(marker), false, "Role view visibility must be controlled centrally: " + view);
    }
  }
});
