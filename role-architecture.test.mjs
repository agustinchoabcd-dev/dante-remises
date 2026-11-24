import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, copyScript, serviceWorker, roleViewAccess, roleTemplateLoader, passengerTemplate, driverTemplate, centralTemplate, roleDomBindings, passengerModule, driverModule, operatorModule, adminModule, mapAdapter, diagnosticsMonitor, driverInboxState] = await Promise.all([
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
  readFile(new URL("./js/dante-map.js", import.meta.url), "utf8"),
  readFile(new URL("./diagnostics-monitor.mjs", import.meta.url), "utf8"),
  readFile(new URL("./driver-inbox-state.mjs", import.meta.url), "utf8")
]);


test("Central HTML is physically extracted and mounted for operators and administrators", () => {
  assert.ok(html.includes('<section id="central" class="hidden"><div id="centralViewMount"></div></section>'));
  assert.equal(html.includes('<h2>Central de Dante Remises</h2>'), false);
  assert.ok(centralTemplate.includes('<h2>Central de Dante Remises</h2>'));
  assert.ok(centralTemplate.includes('id="adminOperationalHealthPanel"'));
  for (const id of ["centralDescription","centralAuthStatus","adminTripAlertPanel","adminDriverTripInbox","adminDriverActiveTrip","centralCars","passengerAdmin","passengerList"]) {
    assert.ok(centralTemplate.includes('id="' + id + '"'), "Missing Central control: " + id);
  }
  assert.ok(roleTemplateLoader.includes('central: "./views/central.html"'));
  assert.ok(operatorModule.includes('loadRoleView("central")'));
  assert.match(adminModule, /driverModule\.mount\(context\)/);
  assert.match(adminModule, /centralModule\.mount\(workspaceContext\(generation\)\)/);
  assert.match(driverModule, /context\.showView\("inicio"\)/);
  assert.match(html, /id="adminWorkspaceSettingsCard"/);
  assert.match(html, /id="openAdminWorkspaceButton"/);
  assert.match(html, /bindRoleDom\('openAdminWorkspaceButton','click',async\(\)=>/);
  assert.match(html, /adminWorkspaceController\?\.openAdminPanel\(\)/);
  assert.match(html, /adminWorkspaceSettingsCard'\)\?\.classList\.toggle\('hidden',!isAdmin\)/);
  assert.match(adminModule, /context\.suspendDriverWorkspace\?\.\(\)/);
  assert.match(adminModule, /context\.unloadRoleMount\?\.\("driver"\)/);
  assert.match(adminModule, /context\.resumeDriverWorkspace\?\.\(\)/);
  assert.match(adminModule, /context\.unloadRoleView\("central"\)/);
  assert.match(adminModule, /workspaceController/);
  assert.match(html, /data-view="central">Central<\/button>/);
  assert.doesNotMatch(html, /Central \/ Operadores/);
  assert.match(html, /if\(byId\('driverGpsStatus'\)\)/);
  assert.ok(copyScript.includes('"views/central.html"'));
  assert.ok(html.includes("if(role==='central')"));
  assert.ok(html.includes("render('role-template-mounted:'+role)"));
});


test("startup recovery never reveals the login shell while an authenticated callback is pending", () => {
  const start = html.indexOf("const startupSafetyTimer=window.setTimeout(()=>{");
  const end = html.indexOf("\nlet authStateGeneration=0;", start);
  assert.ok(start >= 0 && end > start);
  const timer = html.slice(start, end);
  assert.ok(timer.includes("if(startupAuthReady)return;"));
  assert.ok(timer.includes("byId('startupCaption')"));
  assert.ok(timer.includes("Estamos verificando tu sesión y preparando el acceso"));
  assert.ok(timer.includes("auth.startup.recovery_pending"));
  assert.equal(timer.includes("byId('acceso')"), false);
  assert.equal(timer.includes("finishStartupScreen()"), false);
  assert.equal(timer.includes("roleTransition.finish"), false);
  assert.ok(html.includes('id="startupCaption"'));
});

test("returning to the driver workspace preserves the three-tab home instead of forcing map fullscreen", () => {
  const start = html.indexOf("resumeDriverWorkspace:async()=>{");
  const end = html.indexOf("\n    }\n   }),roleTemplatePreload", start);
  assert.ok(start >= 0 && end > start);
  const resume = html.slice(start, end);
  assert.ok(resume.includes("scheduleDriverHomeMapInit()"));
  assert.equal(resume.includes("await initDriverHomeMap()"), false);
  assert.equal(resume.includes("setDriverHomeFullscreen(true)"), false);
  const showStart = html.indexOf("function showView(v){");
  const showEnd = html.indexOf("\nfunction renderDriverHomeStatus", showStart);
  const showView = html.slice(showStart, showEnd);
  assert.ok(showView.includes("setDriverHomeFullscreen(false)"));
});

test("Central has no redundant return-to-driver control; the workspace selector remains", () => {
  assert.equal(centralTemplate.includes("adminReturnToDriverButton"), false);
  assert.equal(centralTemplate.includes("Volver al espacio de chófer"), false);
  assert.equal(html.includes("adminReturnToDriverButton"), false);
  assert.ok(centralTemplate.includes('id="adminWorkspaceDriverButton"'));
  assert.ok(html.includes("bindRoleDom('adminWorkspaceDriverButton'"));
});

test("driver HTML is physically extracted and mounted for driver and admin roles", () => {
  assert.doesNotMatch(html, /<section id="chofer"/);
  assert.ok(driverTemplate.includes('<section id="inicio"'));
  assert.ok(driverTemplate.includes('<section id="chofer"'));
  assert.ok(driverModule.includes('context.showView("inicio")'));
  assert.match(roleTemplateLoader, /driver: "\.\/views\/driver\.html"/);
  assert.match(driverModule, /loadRoleView\("driver"\)/);
  assert.match(adminModule, /driverModule\.mount\(workspaceContext\(generation\)\)/);
  assert.ok(html.includes("byId('driverControls')?.classList.toggle"));
  assert.ok(html.includes("if(byId('roleSummary'))byId('roleSummary').textContent=roleText"));
  assert.ok(html.includes("loadRoleView:async role=>{"));
  assert.ok(html.includes("const result=await roleTemplateLoader.load(role);"));
  assert.ok(html.includes("if(role==='driver')"));
  assert.ok(html.includes("if(role==='central')"));
  assert.ok(html.includes("render('role-template-mounted:'+role)"));
});

test("admin can operate the car-144 driver workspace without changing its admin role", () => {
  assert.match(html, /if\(driverHomeConnectBusy\|\|!isDriverCapableRole\(\)\|\|!currentUser\)return/);
  assert.match(html, /if\(driverHomeDisconnectBusy\|\|!isDriverCapableRole\(\)\)return/);
  assert.match(html, /if\(isDriverCapableRole\(\)&&!driverWantsOnline&&!activeTripId\)return/);
  assert.match(html, /const carId=currentDriverCarId\(\)/);
  assert.doesNotMatch(html, /driverHomeConnectButton'\)\?\.classList\.toggle\('hidden',!!car\?\.online\|\|currentRole\?\.role==='admin'\)/);
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

test("passenger navigation controls return after photo onboarding completes", () => {
  assert.match(html, /document\.querySelectorAll\('\.tabs'\)\.forEach\(el=>el\.classList\.toggle\('hidden',!currentUser\|\|v==='passengerOnboarding'\)\)/);
  assert.match(html, /byId\('appFooter'\)\?\.classList\.toggle\('hidden',!currentUser\)/);
  assert.match(html, /byId\('versionNote'\)\?\.classList\.toggle\('hidden',!currentUser\)/);
});

test("operator workspace updates the Central description from its active workspace", () => {
  assert.match(html, /isOperatorWorkspaceActive\(\)\?'Panel de operador: consulta de disponibilidad/);
});

test("diagnostics accepts every operational event emitted by presence, status, staff-photo and push flows", () => {
  for (const type of [
    "firebase.status.location_cleanup.error",
    "firebase.status.rollback_read.error",
    "firebase.presence.registration.stale",
    "firebase.staffPhotos.updated_error",
    "trip.push.registration",
    "trip.push.registration.error",
    "trip.push.road-distances",
    "trip.push.road-distances.error",
    "trip.push.requested",
    "trip.push.request.error"
  ]) assert.ok(diagnosticsMonitor.includes('"'+type+'"'), "Diagnostics drops event: "+type);
  for (const detail of ["status","accepted","registered","provider","originAvailable","destinationAvailable"]) {
    assert.ok(diagnosticsMonitor.includes('"'+detail+'"'), "Diagnostics drops detail: "+detail);
  }
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
  assert.ok(callback.includes("await Promise.all([activateRole(currentRole.role"));
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
    "views/auth.html",
    "roles/auth.mjs",
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
  const roleActivation = html.indexOf("roleActivation=await Promise.all([activateRole(currentRole.role", authStart);

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
  assert.match(html, /applyRoleView\(document,workspaceRole,v\)/);
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

test("stopping the selected passenger driver also detaches its Firebase location listener", () => {
  const start = html.indexOf("function stopPassengerLocationWatch()");
  const end = html.indexOf("\nbindRoleDom('requestSelectedDriver'", start);
  assert.ok(start >= 0 && end > start);
  const cleanup = html.slice(start, end);
  assert.match(cleanup, /if\(liveLocationUnsub\)\{liveLocationUnsub\(\);liveLocationUnsub=null\}/);
  assert.match(cleanup, /selectedCarMarker/);
});

test("admin workspace switching separates identity from the active workspace", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const central = await readFile(new URL("./views/central.html", import.meta.url), "utf8");
  const admin = await readFile(new URL("./roles/admin.mjs", import.meta.url), "utf8");
  assert.ok(html.includes("let activeWorkspaceRole = null;"));
  assert.ok(html.includes("function currentWorkspaceRole()"));
  assert.ok(html.includes("function isPassengerWorkspaceActive()"));
  assert.ok(html.includes("function isOperatorWorkspaceActive()"));
  assert.ok(html.includes("passengerActiveTripId=null,passengerActiveTripData=null"));
  assert.ok(central.includes('id="adminWorkspaceSelector"'));
  assert.ok(html.includes('id="adminWorkspaceReturnButton"'));
  assert.ok(html.includes('id="allRolesWorkspace"'));
  assert.ok(html.includes('id="allRoleAdminButton"'));
  assert.ok(html.includes('id="allRoleDriverButton"'));
  assert.ok(html.includes('id="allRoleOperatorButton"'));
  assert.ok(html.includes('id="allRolePassengerButton"'));
  assert.ok(html.includes('function setAllRolesMode(enabled)'));
  assert.match(admin, /openOperatorWorkspace\(\{/);
  assert.match(admin, /openPassengerWorkspace\(\{/);
  assert.ok(admin.includes('context.setWorkspaceRole?.("passenger")'));
});

test("authentication is a lazy isolated template and startup waits for Firebase auth restoration", () => {
  assert.match(html, /id="authViewMount"/);
  assert.doesNotMatch(html, /<section id="acceso">/);
  assert.match(html, /await auth\.authStateReady\(\)/);
  assert.match(html, /auth\.state\.stale_initial_callback/);
  assert.match(roleTemplateLoader, /auth: "\.\/views\/auth\.html"/);
  assert.match(roleTemplateLoader, /auth: "authViewMount"/);
  assert.match(html, /ensureAuthView\(\)/);
});

test("admin workspace hides the floating driver map control", () => {
  assert.match(html, /admin-workspace-active/);
  assert.match(html, /driverHomeMapHomeButton.*classList\.add\('hidden'\)/);
});

test("driver inbox handles absent role mounts and loads trip records concurrently",()=>{
 const start=html.indexOf("function listenDriverInbox(){");
 const end=html.indexOf("\nasync function dismissNativeTripAlert()",start);
 const inbox=html.slice(start,end);
 assert.match(inbox,/if\(driverTarget\)targets\.push/);
 assert.match(inbox,/if\(adminTarget\)targets\.push/);
 assert.match(inbox,/loadPendingDriverTrips\(snap\.val\(\)/);
 assert.match(inbox,/\.catch\(error=>/);
 assert.match(driverInboxState,/Promise\.all\(/);
 assert.ok(copyScript.includes('"driver-inbox-state.mjs"'));
});

test("driver can connect and start GPS without waiting for the map engine",()=>{
 const start=html.indexOf("async function connectDriverHome(){");
 const end=html.indexOf("\nasync function disconnectDriverHome()",start);
 const connect=html.slice(start,end);
 assert.equal(connect.includes("await initDriverHomeMap()"),false);
 assert.match(connect,/await registerDriverPresence/);
 assert.match(connect,/void startDriverGps\(\)/);
 assert.match(connect,/scheduleDriverHomeMapInit\(\)/);
 const showStart=html.indexOf("function showView(v){");
 const showEnd=html.indexOf("\nfunction renderDriverHomeStatus",showStart);
 assert.match(html.slice(showStart,showEnd),/scheduleDriverHomeMapInit\(\)/);
});

test("root admin role skips the profile network read and role template preloads in parallel",()=>{
 const roleStart=html.indexOf("async function resolveAuthenticatedRole(user)");
 const roleEnd=html.indexOf("\ndocument.addEventListener('visibilitychange'",roleStart);
 const resolver=html.slice(roleStart,roleEnd);
 assert.match(resolver,/if\(user\.uid===ADMIN_UID\)return resolveRoleFromProfile/);
 assert.match(html,/Promise\.all\(\[activateRole\(currentRole\.role/);
 assert.match(html,/roleTemplateLoader\.preload\(initialTemplateRole\)/);
});

test("driver location fixes are validated and published without re-registering onDisconnect every sample",()=>{
 assert.match(html,/validateDriverLocationFix\(pos/);
 assert.match(html,/driverLocationDisconnectPaths\.has\(locationPath\)/);
 assert.match(html,/driverLocationDisconnectPaths\.clear\(\)/);
 assert.match(html,/maximumAge:5000,timeout:20000,interval:2500,minimumUpdateInterval:1500/);
});

test("location permission is requested only when a location feature is used",()=>{
 assert.doesNotMatch(html,/requestStartupPermissions\(\)/);
 assert.match(html,/requestPreciseLocationPermission\(\)/);
 assert.match(html,/requestLocationPermission\(\)/);
});

test("remote branding synchronization never gates the first authenticated screen",()=>{
 const ready=something=>html.indexOf(something);
 const branding=ready("function finishBrandingStartup()");
 const release=ready("finishBrandingStartup();\nfunction readLogoSettings()");
 const remote=ready("onValue(ref(db,'branding/logo/updatedAt')");
 assert.ok(branding>=0&&release>branding&&remote>release);
 assert.match(html.slice(remote,remote+500),/if\(startupAuthReady\)void syncLogoFromMetadata/);
 const auth=html.lastIndexOf("startupAuthReady=true;");
 assert.ok(auth>remote);
 assert.match(html.slice(auth,auth+450),/void syncLogoFromMetadata\(logoRemoteUpdatedAt\)/);
});

test("GPS retries and in-flight writes are declared and invalidated on stop",()=>{
 assert.match(html,/driverLocationWriteInFlight=false/);
 assert.match(html,/driverGpsRetryTimer=null/);
 assert.match(html,/driverGpsRetryAttempts=0/);
 assert.match(html,/driverGpsGeneration=0/);
 assert.match(html,/driverLocationDisconnectPaths=new Set\(\)/);
 assert.match(html,/driverGpsGeneration\+\+/);
});

test("driver GPS reacquires a fresh watch when the app returns to foreground",()=>{
 assert.match(html,/document\.addEventListener\('visibilitychange',\(\)=>\{/);
 assert.match(html,/if\(document\.visibilityState!=='visible'\)return/);
 assert.match(html,/if\(isDriverCapableRole\(\)&&\(driverWantsOnline\|\|activeTripId\)\)/);
 assert.match(html,/clearWatch\(driverWatchId\);driverWatchId=null/);
 assert.match(html,/perf\.mark\('gps\.watch\.foreground_resume'\)/);
});

test("admin health exposes live GPS accuracy and diagnostic upload state",()=>{
 assert.match(html,/gpsAgeSeconds/);
 assert.match(html,/latestDriverLocation\.accuracy/);
 assert.match(html,/diagnostics\.syncStatus/);
 assert.match(html,/diagnostics\.syncError/);
 assert.match(html,/diagnostics\.lastUploadAt/);
});
test("deferred active-trip map focus handles promise failures",()=>{
 assert.match(html,/focusDriverHomeMap\(\)\.catch\(error=>/);
 assert.match(html,/ensureDriverHomeNavigationRoute\(\)\.catch\(error=>/);
});
