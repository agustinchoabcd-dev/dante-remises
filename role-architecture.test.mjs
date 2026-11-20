import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, copyScript, serviceWorker, roleViewAccess, roleTemplateLoader, passengerTemplate, driverTemplate, centralTemplate, roleDomBindings, passengerModule, driverModule, operatorModule, adminModule, mapAdapter] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8"),
  readFile(new URL("./service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("./role-view-access.mjs", import.meta.url), "utf8"),
  readFile(new URL("./role-template-loader.mjs", import.meta.url), "utf8"),
  readFile(new URL("./views/passenger.html", import.meta.url), "utf8"),
  readFile(new URL("./views/driver.html", import.meta.url), "utf8"),
  readFile(new URL("./views/central.html", import.meta.url), "utf8"),
  readFile(new URL("./role-dom-bindings.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/passenger.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/driver.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/operator.mjs", import.meta.url), "utf8"),
  readFile(new URL("./roles/admin.mjs", import.meta.url), "utf8"),
  readFile(new URL("./js/dante-map.js", import.meta.url), "utf8")
]);


test("Central HTML is physically extracted and mounted for operators and administrators", () => {
  assert.ok(html.includes('<section id="central" class="hidden"><div id="centralViewMount"></div></section>'));
  assert.equal(html.includes('<h2>Central de Dante Remises</h2>'), false);
  assert.ok(centralTemplate.includes('<h2>Central de Dante Remises</h2>'));
  for (const id of ["centralDescription","centralAuthStatus","adminTripAlertPanel","adminDriverTripInbox","adminDriverActiveTrip","centralCars","passengerAdmin","passengerList"]) {
    assert.ok(centralTemplate.includes('id="' + id + '"'), "Missing Central control: " + id);
  }
  assert.ok(roleTemplateLoader.includes('central: "./views/central.html"'));
  assert.ok(operatorModule.includes('loadRoleView("central")'));
  assert.ok(adminModule.indexOf('loadRoleView("central")') < adminModule.indexOf('loadRoleView("driver")'));
  assert.ok(copyScript.includes('"views/central.html"'));
  assert.ok(html.includes("if(role==='central')"));
  assert.ok(html.includes("render('central-template-mounted')"));
});

test("driver HTML is physically extracted and mounted for driver and admin roles", () => {
  assert.doesNotMatch(html, /<section id="chofer"/);
  assert.ok(driverTemplate.includes('<section id="inicio"'));
  assert.ok(driverTemplate.includes('<section id="chofer"'));
  assert.ok(driverModule.includes('context.showView("inicio")'));
  assert.match(roleTemplateLoader, /driver: "\.\/views\/driver\.html"/);
  assert.match(driverModule, /loadRoleView\("driver"\)/);
  assert.match(adminModule, /loadRoleView\("driver"\)/);
  assert.ok(html.includes("byId('driverControls')?.classList.toggle"));
  assert.ok(html.includes("if(byId('roleSummary'))byId('roleSummary').textContent=roleText"));
  assert.ok(html.includes("loadRoleView:async role=>{"));
  assert.ok(html.includes("const result=await roleTemplateLoader.load(role);"));
  assert.ok(html.includes("if(role==='driver')"));
  assert.ok(html.includes("if(role==='central')"));
  assert.ok(html.includes("render('central-template-mounted')"));
});

test("driver view controls are registered through deferred role DOM bindings", () => {
  for (const id of ["driverHomeStatus","driverHomeStatusText","driverHomeMap","driverHomeMapShell","driverHomeRecenterButton","driverHomeNavigation","driverHomeNavigationStage","driverHomeNavigationInstruction","driverHomeNavigationMeta","driverHomeActiveTrip","driverHomeRequests","driverHomeTripInbox","driverHomeConnectButton","driverHomeMapHomeButton","driverHomeCurtain","driverHomeCurtainGrip","driverHomeConnectedMessage","driverHomeDisconnectButton","driverStatus","driverTripInbox","driverActiveTrip","driverGpsStatus","busyDuration","setBusy","outDuration","setOut","setFree"]) {
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

test("passenger profile completion clearly preserves the signed-in state", () => {
  assert.match(passengerTemplate, /Tu sesión está iniciada/);
  assert.match(passengerTemplate, /id="passengerOnboardingBack"[^>]*>Cerrar sesión/);
});

test("temporary passenger photo verification errors do not look like logout", () => {
  assert.match(html, /passengerPhotoCheckUnavailable=true/);
  assert.match(html, /!passengerPhotoReady&&!passengerPhotoCheckUnavailable/);
  assert.match(html, /Tu sesión sigue activa/);
  assert.match(passengerModule, /photoReady === null/);
  assert.match(passengerModule, /context\.showView\("pasajero"\)/);
});

test("role event bindings survive a view being absent and mounted later", () => {
  assert.match(html, /createRoleDomBindings\(document\)/);
  assert.match(html, /const flushRoleDomBindings=roleDomBindings\.flush/);
  for (const match of passengerTemplate.matchAll(/\bid="([^"]+)"/g)) {
    assert.equal(html.includes("byId('" + match[1] + "').addEventListener("), false, "Passenger listener must be deferred: " + match[1]);
    assert.equal(html.includes('byId("' + match[1] + '").addEventListener('), false, "Passenger listener must be deferred: " + match[1]);
  }
  assert.match(html, /bindRoleDom\('passengerCars'/);
  assert.match(html, /bindRoleDom\('adminDriverTripInbox'/);
  assert.equal(html.includes("byId('adminDriverTripInbox')?.addEventListener("), false);
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
  assert.match(html, /getDriverNavigationTarget/);
  assert.match(html, /getDriverNavigationProgress/);
  assert.match(html, /driverHomeMapShell/);
  assert.match(html, /data-accept-trip/);
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
    "driver-home-state.mjs",
    "driver-navigation-state.mjs",
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
  assert.ok(roleTemplateLoader.includes('central: "./views/central.html"'));
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

  for (const view of ["pasajero", "inicio", "chofer", "central", "chat", "configuracion", "passengerOnboarding"]) {
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
  for (const view of ["pasajero", "inicio", "chofer", "central", "chat", "configuracion"]) {
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

test("driver map has separate trip refocus and current GPS centering controls", () => {
  assert.ok(driverTemplate.includes('id="driverHomeRecenterButton"'));
  assert.ok(driverTemplate.includes('id="driverHomeCenterLocationButton"'));
  assert.match(driverTemplate, /Focalizar el recorrido completo/);
  assert.match(driverTemplate, /Centrar en mi ubicación/);
  assert.match(html, /bindRoleDom\('driverHomeCenterLocationButton'/);
  assert.match(html, /driverHomeMap\.centerOn\?\.\(latestDriverLocation,16\)/);
  assert.match(html, /String\(driverHomePendingRouteTripId\)===String\(driverHomeFocusTripId\)/);
  assert.match(html, /driverHomeMap\.fitGeometry\(driverHomePendingRoute\.geometry,driverHomeFitPadding\(\),points\)/);
});

test("trip endpoints use passenger and red destination pins in both map engines", () => {
  assert.equal((mapAdapter.match(/addTripEndpointMarker\(id, point, kind = 'pickup'/g)||[]).length, 2);
  assert.match(mapAdapter, /pickup \? '#ed9418' : '#dc3545'/);
  assert.match(mapAdapter, /<circle cx="20" cy="16" r="5" fill="#fff"\/>/);
  assert.match(html, /addTripEndpointMarker\(markerId/);
  assert.match(html, /'destination','Final'/);
});

test("provider credits are centralized in Settings and absent from role templates", () => {
  assert.match(html, /id="creditsSettingsCard"/);
  assert.match(html, /Créditos y APIs utilizadas/);
  for (const [role, template] of [
    ["passenger", passengerTemplate],
    ["driver", driverTemplate],
    ["central", centralTemplate]
  ]) {
    assert.doesNotMatch(template, /Powered by Geoapify|OpenStreetMap|LocationIQ/, role + " must not show inline credits");
  }
});
