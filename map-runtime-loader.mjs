const MAP_STYLES = Object.freeze([
  {
    engine: "leaflet",
    href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
  },
  { engine: "mapbox", href: "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.css" }
]);

const MAP_ENGINE_SCRIPTS = Object.freeze([
  {
    engine: "leaflet",
    src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
  },
  { engine: "mapbox", src: "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl.js" }
]);

const MAP_SUPPORT_SCRIPTS = Object.freeze([
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
    link.onerror = () => reject(new Error("No se pudo cargar el estilo cartográfico: " + resource.engine));
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
 * until a passenger or staff workflow actually needs a map. Either rendering
 * engine may fail independently: Mapbox remains preferred, Leaflet is fallback.
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
  const loadedStyles = new Set();
  const loadedScripts = new Set();

  const ensureStyle = resource => {
    if (loadedStyles.has(resource.href)) return Promise.resolve(true);
    return loadStyle(documentRef, resource)
      .then(() => { loadedStyles.add(resource.href); return true; })
      .catch(() => false);
  };
  const ensureScript = resource => {
    if (loadedScripts.has(resource.src)) return Promise.resolve(true);
    return loadScript(documentRef, resource)
      .then(() => { loadedScripts.add(resource.src); return true; })
      .catch(() => false);
  };

  return function ensureMapRuntime() {
    if (windowRef.DanteMap && windowRef.DanteGeocoding) return Promise.resolve(windowRef.DanteMap);
    if (loading) return loading;

    loading = (async () => {
      const [mapboxStyle, mapboxScript] = await Promise.all([
        ensureStyle(MAP_STYLES[1]),
        ensureScript(MAP_ENGINE_SCRIPTS[1])
      ]);
      let mapboxReady = mapboxStyle && mapboxScript && !!windowRef.mapboxgl;

      if (!mapboxReady) {
        windowRef.mapboxgl = undefined;
        loadedScripts.delete(MAP_ENGINE_SCRIPTS[1].src);
        const [leafletStyle, leafletScript] = await Promise.all([
          ensureStyle(MAP_STYLES[0]),
          ensureScript(MAP_ENGINE_SCRIPTS[0])
        ]);
        const leafletReady = leafletStyle && leafletScript && !!windowRef.L;
        if (!leafletReady) {
          windowRef.L = undefined;
          loadedScripts.delete(MAP_ENGINE_SCRIPTS[0].src);
          throw new Error("No se pudo cargar ningún motor cartográfico compatible.");
        }
      }
      const configScripts = MAP_SUPPORT_SCRIPTS.slice(0, 2);
      const configReady = await Promise.all(configScripts.map(ensureScript));
      if (configReady.some(ready => !ready)) throw new Error("No se pudo cargar la configuración del mapa.");
      const runtimeScripts = MAP_SUPPORT_SCRIPTS.slice(2);
      const runtimeReady = await Promise.all(runtimeScripts.map(ensureScript));
      if (runtimeReady.some(ready => !ready)) throw new Error("No se pudieron cargar los componentes del mapa.");

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
  scripts: Object.freeze([...MAP_ENGINE_SCRIPTS, ...MAP_SUPPORT_SCRIPTS])
});
