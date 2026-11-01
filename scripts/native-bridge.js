import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";

const native = Capacitor.isNativePlatform();
const watches = new Map();
let nextWatchId = 1;

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
    interval: 3000
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

export async function requestStartupPermissions() {
  if (!native) return;
  try {
    const location = await Geolocation.checkPermissions();
    if (location.location !== "granted") {
      await Geolocation.requestPermissions({ permissions: ["location"] });
    }
  } catch (error) {
    console.warn("Permiso de ubicación no concedido o servicio GPS desactivado:", error);
  }
  try {
    const notifications = await LocalNotifications.checkPermissions();
    if (notifications.display !== "granted") {
      await LocalNotifications.requestPermissions();
    }
  } catch (error) {
    console.warn("Permiso de notificaciones no concedido:", error);
  }
}
