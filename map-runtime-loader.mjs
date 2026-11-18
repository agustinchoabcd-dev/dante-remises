const MAP_STYLES = Object.freeze([
  {
    href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
  },
  { href: "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.css" }
]);

const MAP_SCRIPTS = Object.freeze([
  {
    src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
  },
  { src: "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.js" },
  { src: "js/mapbox-config.js" },
  { src: "js/geocoding-config.js" },
  { src: "js/dante-geocoding.js" },
  { src: "js/dante-map.js" }
]);

function loadStyle(documentRef, resource) {
  const link = documentRef.createElement("link");
  link.rel = "stylesheet";
  link.href = resource.href;
  if (resource.integrity) {
    link.integrity = resource.integrity;
    link.crossOrigin = "anonymous";
  }

  return new Promise((resolve, reject) => {
    link.onload = resolve;
    link.onerror = () => reject(new Error("No se pudo cargar el estilo cartográfico."));
    documentRef.head.appendChild(link);
  });
}

function loadScript(documentRef, resource) {
  const script = documentRef.createElement("script");
  script.src = resource.src;
  script.async = false;
  if (resource.integrity) {
    script.integrity = resource.integrity;
    script.crossOrigin = "anonymous";
  }

  return new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error("No se pudo cargar un componente del mapa: " + resource.src));
    documentRef.head.appendChild(script);
  });
}

/**
 * Defers both map engines, their styles, provider configuration and adapters
 * until a passenger or staff workflow actually needs a map.
 */
export function createMapRuntimeLoader({
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window
} = {}) {
  if (!documentRef?.head || typeof documentRef.createElement !== "function") {
    throw new TypeError("A document head is required to load the map runtime");
  }
  if (!windowRef) throw new TypeError("A window object is required to load the map runtime");

  let loading = null;

  return function ensureMapRuntime() {
    if (windowRef.DanteMap && windowRef.DanteGeocoding) return Promise.resolve(windowRef.DanteMap);
    if (loading) return loading;

    loading = (async () => {
      await Promise.all(MAP_STYLES.map(style => loadStyle(documentRef, style)));
      for (const script of MAP_SCRIPTS) await loadScript(documentRef, script);

      if (!windowRef.DanteMap || !windowRef.DanteGeocoding) {
        throw new Error("El motor cartográfico no terminó de inicializarse.");
      }
      return windowRef.DanteMap;
    })().catch(error => {
      loading = null;
      throw error;
    });

    return loading;
  };
}

export const mapRuntimeResources = Object.freeze({
  styles: MAP_STYLES,
  scripts: MAP_SCRIPTS
});
