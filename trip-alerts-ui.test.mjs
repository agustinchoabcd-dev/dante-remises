import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, nativeBridge, webBridge] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./scripts/native-bridge.js", import.meta.url), "utf8"),
  readFile(new URL("./native-bridge.js", import.meta.url), "utf8")
]);

test("trip alert permissions live only in Settings, not in driver or admin trip panels", () => {
  assert.equal((html.match(/id="settingsEnableTripNotifications"/g) || []).length, 1);
  assert.equal((html.match(/id="settingsEnableTripOverlay"/g) || []).length, 1);
  for (const obsoleteId of [
    "enableDriverNotifications",
    "enableDriverTripOverlay",
    "enableAdminNotifications",
    "enableAdminTripOverlay",
    "driverTripAlertSettings"
  ]) assert.equal(html.includes('id="' + obsoleteId + '"'), false, obsoleteId + " must be removed");
  assert.match(html, /id="tripAlertPermissionsCard"/);
  assert.equal((html.match(/id="tripAlertRegistrationStatus"/g) || []).length, 1);
});

test("staff entry starts the one-time Android notification and overlay permission flow", () => {
  assert.match(html, /if\(v==='chofer'\)void ensureDriverTripAlertPermissions\(\)/);
  assert.match(html, /requestTripNotificationPermission\(\)/);
  assert.match(html, /requestTripOverlayPermission\(\)/);
  const automaticFlow = html.match(/async function ensureDriverTripAlertPermissions\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(automaticFlow, /openTripNotificationSettings\(\)/);
  assert.match(nativeBridge, /LocalNotifications\.requestPermissions\(\)/);
  assert.match(nativeBridge, /export async function requestTripNotificationPermission/);
});

test("startup permissions no longer ask passengers for trip notifications", () => {
  const startup = nativeBridge.match(/export async function requestStartupPermissions\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(startup, /requestLocationPermission/);
  assert.doesNotMatch(startup, /LocalNotifications/);
});

test("browser bridge keeps every imported trip-alert API available without native behavior", () => {
  for (const name of [
    "requestTripNotificationPermission",
    "getTripAlertToken",
    "canDrawTripOverlay",
    "requestTripOverlayPermission",
    "canPostTripNotifications",
    "openTripNotificationSettings",
    "getPendingTripAction",
    "clearPendingTripAction",
    "stopTripAlert"
  ]) assert.match(webBridge, new RegExp("export async function " + name + "\\("), name);
});


test("native trip overlay exposes accept, view and reject as separate actions", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /dispatchAction\("accept"\)/);
  assert.match(service, /dispatchAction\("view"\)/);
  assert.match(service, /dispatchAction\("reject"\)/);
  assert.match(service, /addAction\(0, "Ver viaje"/);
});

test("pending native actions are processed after the app becomes visible and are cleared only after handling", () => {
  assert.match(html, /document\.addEventListener\('visibilitychange',processNativeTripActionWhenVisible\)/);
  assert.match(html, /\['accept','view','reject'\]/);
  assert.match(html, /if\(processed\)await clearPendingTripAction\(\)/);
});

test("viewing and accepting a driver trip show its pickup and destination map", () => {
  assert.match(html, /function renderDriverTripPreview\(trip,id\)/);
  assert.match(html, /function renderDriverTripMap\(trip,id,mode/);
  assert.match(html, /driverTripPointIcon\('#e53935','Inicio'\)/);
  assert.match(html, /data-accept-trip/);
  assert.match(html, /data-view-trip/);
});


test("trip preview expands the existing inbox card instead of creating a duplicate active-trip card", () => {
  assert.match(html, /driverTripPreviewId=id;activeTripData=trip;showView\('chofer'\);byId\('driverActiveTrip'\)\.classList\.add\('hidden'\)/);
  assert.match(html, /el\.dataset\.tripCard=t\.tripId/);
  assert.match(html, /driverTripCardMarkup\(t,t\.tripId,expanded\)/);
});

test("driver trip cards show pickup distance and passenger destination distance in compact form", () => {
  assert.match(html, /function tripDistanceMeters\(a,b\)/);
  assert.match(html, /function formatTripDistance\(meters\)/);
  assert.match(html, /driverTripStreet\(trip\.origin\?\.label\)/);
  assert.match(html, /trip-destination-distance/);
  assert.match(html, /Paradas: '\+esc\(stops\.join\(' · '\)\)/);
});

test("accepted trips navigate from the driver's live location to pickup, then from pickup to destination", () => {
  assert.match(html, /renderDriverTripMap\(trip,id,trip\.status==='accepted'\?'pickup':'passenger','driverTripMap'\)/);
  assert.match(html, /requestDriverRoadRoute\(live,origin\)/);
  assert.match(html, /requestDriverRoadRoute\(origin,destination\)/);
  assert.match(html, /animateDriverRouteArrow\(routeAB,routeBC,routeVisualAB,routeVisualBC\)/);
  assert.match(html, /driverNavigationMode==='pickup'\|\|driverNavigationMode==='preview'/);
  assert.match(html, /latestDriverPosition=loc;updateDriverNavigationPosition\(loc\)/);
});


test("pickup distance refreshes as the driver's GPS position changes", () => {
  assert.match(html, /class="trip-pickup-line"/);
  assert.match(html, /requestDriverRoadRoute\(location,trip\.origin\)/);
  assert.match(html, /line\.textContent=driverTripStreet\(trip\.origin\?\.label\)/);
  assert.match(html, /driverPendingTripsById\.forEach\(trip=>\{[\s\S]*?refreshDriverPickupRoadDistance\(trip,location\)/);
});


test("passenger GPS and manual map points are reverse-geocoded to street labels", () => {
  assert.match(html, /async function reverseGeocodeTripPoint\(point\)/);
  assert.match(html, /realMap\.on\('click',async e=>/);
  assert.match(html, /const point=await reverseGeocodeTripPoint\(\{lat:pos\.coords\.latitude,lon:pos\.coords\.longitude\}\)/);
  assert.match(html, /Calle cercana no disponible/);
  assert.match(html, /function isCoordinateOrPlaceholderLabel\(label\)/);
});

test("driver trip summary shows street-and-number lines with separate A-B and B-C distances", () => {
  assert.match(html, /const pickup=driverTripStreet\(trip\.origin\?\.label\),destination=driverTripStreet\(trip\.destination\?\.label\)/);
  assert.match(html, /class="trip-pickup-line"/);
  assert.match(html, /class="trip-destination-address"/);
  assert.match(html, /class="trip-destination-distance"/);
  assert.match(html, /requestDriverRoadRoute\(live,origin\)/);
  assert.match(html, /requestDriverRoadRoute\(origin,destination\)/);
});

test("A-B and B-C route layers use separate gradients and looping triangular arrows", () => {
  assert.match(html, /function addDriverGradientRoute\(route,startColor,endColor,segmentId\)/);
  assert.match(html, /function animateDriverRouteArrow\(routeAB,routeBC/);
  assert.match(html, /startColor:'#ffd43b',endColor:'#e53935'/);
  assert.match(html, /startColor:'#176b3a',endColor:'#8ce99a'/);
  assert.match(html, /requestAnimationFrame\(step\)/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /function stopDriverNavigationAnimations\(\)/);
});


test("live GPS updates pickup distance for every pending request, not only an expanded preview", () => {
  assert.match(html, /driverPendingTripsById=new Map\(\)/);
  assert.match(html, /driverPendingTripsById\.forEach\(trip=>\{if\(driverTripPreviewId===trip\.tripId&&driverTripMapTripId===trip\.tripId\)return;void refreshDriverPickupRoadDistance\(trip,location\)\}\)/);
  assert.match(html, /if\(!expanded\)\{void refreshDriverDestinationRoadDistance\(t\);if\(validTripCoordinate\(latestDriverPosition\)\)void refreshDriverPickupRoadDistance\(t,latestDriverPosition\);\}/);
});


test("driver trip map marks A, B and C and labels each segment by its endpoints", () => {
  assert.match(html, /function driverTripPointIcon\(background,label='\'\)/);
  assert.match(html, /driverTripPointIcon\('#ffd43b'\)/);
  assert.match(html, /driverTripPointIcon\('#e53935','Inicio'\)/);
  assert.match(html, /driverTripPointIcon\('#8ce99a','Fin'\)/);
  assert.match(html, /bindPopup\('Ubicación del chofer'\)/);
  assert.match(html, /bindPopup\('Inicio'\)/);
  assert.match(html, /bindPopup\('Fin'\)/);
  assert.doesNotMatch(html, /Punto [ABC] ·/);
});


test("one triangular arrow traverses A-B and then B-C sequentially before looping", () => {
  const animation = html.match(/function animateDriverRouteArrow\(routeAB,routeBC[\s\S]*?\n\}/)?.[0] || "";
  assert.match(animation, /const segments=\[/);
  assert.match(animation, /segmentIndex=Math\.min\(segments\.length-1,Math\.floor\(elapsed\/duration\)\)/);
  assert.match(animation, /driverNavigationArrowAnimations\.push\(animation\)/);
  assert.equal((animation.match(/L\.marker\(/g) || []).length, 1);
  assert.match(html, /driver-arrow-window/);
  assert.match(html, /fill="#20a765"/);
});


test("pending request pickup distances refresh even when no trip is expanded", () => {
  const updater = html.match(/function updateDriverNavigationPosition\(location\)[\s\S]*?\n\}/)?.[0] || "";
  assert.match(updater, /if\(!validTripCoordinate\(location\)\)return/);
  assert.ok(updater.indexOf("driverPendingTripsById.forEach") < updater.indexOf("if(!activeTripData)return"));
});


test("route gradients move in sync with the arrow and share its interpolated color", () => {
  assert.match(html, /function updateDriverRouteGradient\(visual,progress,currentColor\)/);
  assert.match(html, /updateDriverRouteGradient\(segment\.visual,progress,color\)/);
  assert.match(html, /arrowStops\.forEach\(\(stop,i\)=>stop\.setAttribute\('stop-color',colors\[i\]\)\)/);
  assert.match(html, /const color=driverInterpolateColor\(segment\.startColor,segment\.endColor,progress\)/);
});

test("the aerodynamic arrow stays green while its inner triangular window follows the route gradient", () => {
  const animation = html.match(/function animateDriverRouteArrow\(routeAB,routeBC[\s\S]*?\n\}/)?.[0] || "";
  assert.match(animation, /M2 12 C8 7\.5 16 3\.7 27 2\.4/);
  assert.match(animation, /fill="#20a765"/);
  assert.match(animation, /class="driver-arrow-window"/);
  assert.match(animation, /fill="url\(#'/);
});

test("the animation pauses briefly at B and C before continuing and looping", () => {
  const animation = html.match(/function animateDriverRouteArrow\(routeAB,routeBC[\s\S]*?\n\}/)?.[0] || "";
  assert.match(animation, /duration=5200,pause=220/);
  assert.match(animation, /segmentCycle=duration\+pause/);
  assert.match(animation, /progress=Math\.max\(0,Math\.min\(1,segmentElapsed\/duration\)\)/);
});
