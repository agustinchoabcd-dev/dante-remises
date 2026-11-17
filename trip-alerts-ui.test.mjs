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
