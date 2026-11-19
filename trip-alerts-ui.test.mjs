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
});


test("native trip alerts can display optional road distances supplied by FCM", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /originDistance = safe\(intent\.getStringExtra\("originDistance"\), 24\)/);
  assert.match(service, /destinationDistance = safe\(intent\.getStringExtra\("destinationDistance"\), 24\)/);
  assert.match(service, /distanceSuffix\(originDistance\)/);
  assert.match(service, /distanceSuffix\(destinationDistance\)/);
  assert.match(service, /safe\(data\.get\("originDistance"\), 24\)/);
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

test("Mapbox preview animates all route legs and active navigation follows GPS progress", async () => {
  const [map, html] = await Promise.all([
    readFile(new URL("./js/dante-map.js", import.meta.url), "utf8"),
    readFile(new URL("./index.html", import.meta.url), "utf8")
  ]);
  assert.match(map, /addRoutePreview\(id, legs, options = \{\}\)/);
  assert.match(map, /const validLegs = \(legs \|\| \[\]\)\.filter\(leg => leg\?\.geometry && geoCoordinates\(leg\.geometry\)\.length > 1\)/);
  assert.match(map, /palette\[currentLeg\] \|\| palette\[1\]/);
  assert.match(map, /lineMetrics:true/);
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
