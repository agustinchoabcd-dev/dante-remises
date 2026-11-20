// Puente de compatibilidad para ejecutar la misma aplicación en un navegador.
// La versión Android genera su propio bundle desde scripts/native-bridge.js.
const geolocation = () => typeof navigator !== "undefined" ? navigator.geolocation : null;

export function isGeolocationAvailable() {
  return !!geolocation();
}

export function getCurrentPosition(success, error, options = {}) {
  const api = geolocation();
  if (!api) {
    error?.({ code: 2, message: "La geolocalización no está disponible en este navegador." });
    return;
  }
  api.getCurrentPosition(success, error, options);
}

export function watchPosition(success, error, options = {}) {
  const api = geolocation();
  if (!api) {
    error?.({ code: 2, message: "La geolocalización no está disponible en este navegador." });
    return null;
  }
  return api.watchPosition(success, error, options);
}

export function clearWatch(id) {
  if (id !== null && id !== undefined) geolocation()?.clearWatch(id);
}

// Los permisos nativos se solicitan únicamente dentro de la APK.
export async function requestLocationPermission() {
  // En navegador el permiso se solicita al ejecutar getCurrentPosition/watchPosition.
  return !!geolocation();
}

export async function requestPreciseLocationPermission() {
  return !!geolocation();
}

export async function requestStartupPermissions() {}


// La versión web no dispone de permisos ni alertas push nativas.
export async function requestTripNotificationPermission() { return { granted: false }; }
export async function getTripAlertToken() { return null; }
export async function canPostTripNotifications() { return { granted: false }; }
export async function openTripNotificationSettings() { return { opened: false, granted: false }; }
export async function canDrawTripOverlay() { return false; }
export async function requestTripOverlayPermission() { return { opened: false, granted: false }; }
export async function getPendingTripAction() { return null; }
export async function clearPendingTripAction() {}
export async function stopTripAlert() {}
