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
export async function requestStartupPermissions() {}
