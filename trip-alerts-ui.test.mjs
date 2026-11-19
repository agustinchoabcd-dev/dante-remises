import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

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
  assert.match(html, /if\(sessionIsCurrent\(\)&&processed\)await clearPendingTripAction\(\)/);
});

test("Personal keeps pending requests map-free and opens the complete trip in Inicio", () => {
  const preview = html.match(/function renderDriverTripPreview\(trip,id\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const personalCard = html.match(/personalCard\.innerHTML=([\s\S]*?);\n\s*el\.innerHTML/)?.[1] || "";
  const activeCard = html.match(/function renderDriverActiveTrip\(trip,id\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(preview, /showDriverTripOnHome\(trip,id\)/);
  assert.doesNotMatch(preview, /driverTripMap|data-preview-accept|data-preview-reject/);
  assert.match(personalCard, /data-view-driver-trip/);
  assert.match(personalCard, /data-open-driver-trip-chat/);
  assert.match(personalCard, /data-reject-trip/);
  assert.doesNotMatch(personalCard, /data-accept-trip|driverTripMap/);
  assert.doesNotMatch(activeCard, /driverTripMap|renderDriverTripMap/);
  assert.match(html, /async function ensureDriverHomePendingRoute/);
  assert.match(html, /getDrivingRoute\(points(?:,\{steps:true\})?\)/);
  assert.match(html, /data-accept-trip/);
});


test("native floating trip alert strips postal and administrative address details", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /origin = cleanAddress\(safe\(intent\.getStringExtra\("origin"\), 180\)\)/);
  assert.match(service, /destination = cleanAddress\(safe\(intent\.getStringExtra\("destination"\), 180\)\)/);
  assert.match(service, /private static String cleanAddress\(String value\)/);
  assert.match(service, /Ubicación sin referencia/);
  assert.match(service, /result\.append\(", "\)\.append\(part\)/);
  assert.match(service, /latitude\|longitude/);
});


test("native trip alerts can display optional road distances supplied by FCM", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /originDistance = safe\(intent\.getStringExtra\("originDistance"\), 24\)/);
  assert.match(service, /destinationDistance = safe\(intent\.getStringExtra\("destinationDistance"\), 24\)/);
  assert.match(service, /distanceSuffix\(originDistance\)/);
  assert.match(service, /distanceSuffix\(destinationDistance\)/);
  assert.match(service, /String\.format\(java\.util\.Locale\.US, "%.1f km", meters \/ 1000\.0\)/);
  assert.match(service, /return " \(" \+ formatted \+ "\)"/);
  assert.doesNotMatch(service, /meters < 1000/);
  assert.match(service, /safe\(data\.get\("originDistance"\), 24\)/);
});


test("driver request cards show both road distances in kilometres", async () => {
  const homeState = await readFile(new URL("./driver-home-state.mjs", import.meta.url), "utf8");
  assert.match(homeState, /export function formatDriverCardDistance\(meters\)/);
  assert.match(html, /formatDriverCardDistance\(routeDistances\.pickupMeters\)/);
  assert.match(html, /formatDriverCardDistance\(routeDistances\.destinationMeters\)/);
  assert.match(html, /formatDriverCardDistance\(distances\.pickupMeters\)/);
  assert.match(html, /formatDriverCardDistance\(distances\.destinationMeters\)/);
});

test("driver request cards use structured places and separate road-leg distances", async () => {
  const [geocoding, homeState, html] = await Promise.all([
    readFile(new URL("./js/dante-geocoding.js", import.meta.url), "utf8"),
    readFile(new URL("./driver-home-state.mjs", import.meta.url), "utf8"),
    readFile(new URL("./index.html", import.meta.url), "utf8")
  ]);
  assert.match(geocoding, /placeName:String\(properties\.name/);
  assert.match(geocoding, /async function reverseDetails\(point\)/);
  assert.match(homeState, /export function formatDriverTripPlace\(point = \{\}\)/);
  assert.match(homeState, /export function getDriverRequestRouteDistances\(route\)/);
  assert.match(html, /data-driver-distance-kind="pickup"/);
  assert.match(html, /data-driver-distance-kind="destination"/);
  assert.match(html, /function driverHomeRequestRoutePoints\(trip,location=latestDriverLocation\)/);
  assert.match(html, /\.\.\.stops,trip\.destination/);
  assert.match(html, /getDrivingRoute\(points,\{steps:true\}\)/);
});

test("passenger sends road distances from fresh driver GPS to the alert Worker", () => {
  assert.match(html, /async function calculateTripAlertRoadDistances\(carId,origin,destination\)/);
  assert.match(html, /driverLocations\/\'\+carId/);
  assert.match(html, /getDrivingRoute\(points,\{steps:true\}\)/);
  assert.match(html, /tripId,\.\.\.alertDistances/);
});

test("local GPS updates are not throttled by Firebase writes", () => {
  const callback=html.match(/driverWatchId=watchPosition\(async pos=>\{([\s\S]*?)\},err=>/)?.[1]||"";
  const mapUpdate=callback.indexOf("updateDriverHomeLocation(loc)");
  const navigationUpdate=callback.indexOf("updateDriverHomeNavigationPosition(loc)");
  const writeThrottle=callback.indexOf("if(now-driverLocationWriteAt<4000)return");
  assert.ok(mapUpdate>=0&&navigationUpdate>mapUpdate&&writeThrottle>navigationUpdate);
});

test("active navigation requires fresh GPS and preserves progress across fixes", () => {
  assert.match(html,/gpsAge>=45000/);
  assert.match(html,/previousProgress:driverHomeNavigation\.lastProgress/);
  assert.match(html,/driverHomeNavigation\.lastProgress=progress\.progress/);
  assert.match(html,/La ubicación cambió durante el cálculo/);
});

test("Mapbox preview animates all route legs and active navigation follows GPS progress", async () => {
  const [map, html] = await Promise.all([
    readFile(new URL("./js/dante-map.js", import.meta.url), "utf8"),
    readFile(new URL("./index.html", import.meta.url), "utf8")
  ]);
  assert.match(map, /addRoutePreview\(id, legs, options = \{\}\)/);
  assert.match(map, /const validLegs = \(legs \|\| \[\]\)\.filter\(leg => leg\?\.geometry && geoCoordinates\(leg\.geometry\)\.length > 1\)/);
  assert.match(map, /palette\[currentLeg\] \|\| palette\[1\]/);
  assert.match(map, /const colors = palette\[index\] \|\| palette\[1\]/);
  assert.match(map, /function movingGradientColorAt/);
  assert.match(map, /arrowPath\?\.setAttribute\('fill',movingGradientColorAt/);
  assert.match(map, /width="42" height="42"/);
  assert.match(map, /lineMetrics:true/);
  assert.match(map, /points\.length > 2 && legLines\.length === 1/);
  assert.match(map, /buildMovingGradient/);
  assert.match(map, /setRouteProgress\(id,progress\)/);
  assert.match(map, /fill-rule="evenodd"/);
  assert.match(html, /addRoutePreview\('driver-home-pending-route',previewLegs/);
  assert.match(html, /setRouteProgress\?\.\('driver-home-navigation-route',progress\.progress\)/);
  assert.match(html, /addTripEndpointMarker\(markerId,\{lat,lon\},'pickup','Inicio'\)/);
  assert.match(html, /'destination','Final'\)/);
  const navigation = html.match(/function updateDriverHomeNavigationPosition\(loc,skipCamera=false\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(navigation, /Rutas:|© Geoapify|© Mapbox/);
  const accept = html.match(/async function handleDriverTripDecision\(id,decision\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(accept, /removeRoute\('driver-home-pending-route'\)/);
});


test("preview reconstructs a missing destination leg from the complete route geometry", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console, URLSearchParams, fetch };
  runInNewContext(source, sandbox);
  const points = [{lat:0,lon:0},{lat:0,lon:0.01},{lat:0.01,lon:0.02}];
  const route = {
    geometry: {type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0],[0.015,0.005],[0.02,0.01]]},
    legs: [{geometry:{type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0]]}}, {geometry:null}]
  };
  const normalized = sandbox.window.DanteMap.normalizeRouteLegs(route,points);
  assert.equal(normalized.legs.length,2);
  assert.ok(normalized.legs[0].geometry.coordinates.length>=2);
  assert.ok(normalized.legs[1].geometry.coordinates.length>=2);
  assert.deepEqual(Array.from(normalized.legs[1].geometry.coordinates[0]),[0.01,0]);
  assert.deepEqual(Array.from(normalized.legs[1].geometry.coordinates.at(-1)),[0.02,0.01]);
});

test("preview gradient highlight is centered on arrow progress and arrow remains green with a transparent window", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console, URLSearchParams, fetch };
  runInNewContext(source, sandbox);
  const gradient = Array.from(sandbox.window.DanteMap.buildMovingGradient(0.5,"#14532d","#4ade80"));
  assert.equal(gradient[5],0.41);
  assert.equal(gradient[7],0.5);
  assert.equal(gradient[8],"#4ade80");
  assert.equal(gradient[9],0.59);
  assert.match(source,/fill="#198754" fill-rule="evenodd"/);
  assert.match(source,/stroke="#fff" stroke-width="2\\.4"/);
  assert.doesNotMatch(source,/arrowPath\\?\\.setAttribute\\('fill'/);
  assert.match(source,/handles\\[currentLeg\\]\\?\\.setGradient\\(buildMovingGradient\\(progress/);
});
