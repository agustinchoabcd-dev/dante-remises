import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";

const native = Capacitor.isNativePlatform();
const DantePhotoChooser = registerPlugin("DantePhotoChooser");
const DanteTripAlerts = registerPlugin("DanteTripAlerts");
const watches = new Map();
let nextWatchId = 1;

export async function chooseChatImage() {
  if (!native) return null;
  return DantePhotoChooser.pickImage();
}

export function isGeolocationAvailable() {
  return native || !!navigator.geolocation;
}

export function getCurrentPosition(success, error, options = {}) {
  if (!native) {
    navigator.geolocation.getCurrentPosition(success, error, options);
    return;
  }
  Geolocation.getCurrentPosition({
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: Math.max(options.timeout ?? 20000, 30000),
    maximumAge: options.maximumAge ?? 0
  }).then(success).catch(error);
}

export function watchPosition(success, error, options = {}) {
  if (!native) return navigator.geolocation.watchPosition(success, error, options);
  const localId = String(nextWatchId++);
  const entry = { nativeId: null, cancelled: false };
  watches.set(localId, entry);
  Geolocation.watchPosition({
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? 20000,
    maximumAge: options.maximumAge ?? 5000,
    timeout: options.timeout ?? 15000,
    maximumAge: options.maximumAge ?? 1000,
    interval: options.interval ?? 1000,
    minimumUpdateInterval: options.minimumUpdateInterval ?? 750
  }, (position, err) => {
    if (entry.cancelled) return;
    if (err) error?.({ code: 2, message: err.message || "No se pudo obtener GPS." });
    else if (position) success(position);
  }).then(nativeId => {
    entry.nativeId = nativeId;
    if (entry.cancelled) Geolocation.clearWatch({ id: nativeId }).catch(console.warn);
  }).catch(err => {
    watches.delete(localId);
    error?.({ code: 2, message: err.message || "No se pudo iniciar GPS." });
  });
  return localId;
}

export function clearWatch(id) {
  if (!native) {
    navigator.geolocation.clearWatch(id);
    return;
  }
  const entry = watches.get(String(id));
  if (!entry) return;
  entry.cancelled = true;
  watches.delete(String(id));
  if (entry.nativeId) Geolocation.clearWatch({ id: entry.nativeId }).catch(console.warn);
}

export async function requestLocationPermission() {
  if (!native) return !!navigator.geolocation;
  try {
    const current = await Geolocation.checkPermissions();
    if (current.location === "granted" || current.coarseLocation === "granted") return true;
    const requested = await Geolocation.requestPermissions({
      permissions: ["location", "coarseLocation"]
    });
    return requested.location === "granted" || requested.coarseLocation === "granted";
  } catch (error) {
    console.warn("Permiso de ubicación no concedido o servicio GPS desactivado:", error);
    return false;
  }
}

export async function requestStartupPermissions() {
  if (!native) return;
  await requestLocationPermission();
}

export async function requestTripNotificationPermission() {
  if (!native) return { granted: false };
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return { granted: true };
    const requested = await LocalNotifications.requestPermissions();
    return { granted: requested.display === "granted" };
  } catch (error) {
    console.warn("Permiso de notificaciones de viajes no concedido:", error);
    return { granted: false };
  }
}

export function isNativePlatform() {
  return native;
}

export async function getTripAlertToken() {
  if (!native) return null;
  const result = await DanteTripAlerts.getToken();
  return typeof result?.token === "string" ? result.token : null;
}

export async function canPostTripNotifications() {
  if (!native) return { granted: false };
  return DanteTripAlerts.canPostNotifications();
}

export async function openTripNotificationSettings() {
  if (!native) return { opened: false, granted: false };
  return DanteTripAlerts.openNotificationSettings();
}

export async function canDrawTripOverlay() {
  if (!native) return false;
  const result = await DanteTripAlerts.canDrawOverlays();
  return result?.granted === true;
}

export async function requestTripOverlayPermission() {
  if (!native) return { opened: false, granted: false };
  return DanteTripAlerts.requestOverlayPermission();
}

export async function getPendingTripAction() {
  if (!native) return null;
  const result = await DanteTripAlerts.getPendingTripAction();
  return result?.tripId ? result : null;
}

export async function clearPendingTripAction() {
  if (!native) return;
  await DanteTripAlerts.clearPendingTripAction();
}

export async function stopTripAlert() {
  if (!native) return;
  await DanteTripAlerts.stopAlert();
}
