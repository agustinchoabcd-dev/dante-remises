const STATIC_CACHE = "dante-static-v2";
const ALLOWED_HOSTS = new Set(["unpkg.com", "cdn.jsdelivr.net", "storage.googleapis.com"]);

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith("dante-static-") && name !== STATIC_CACHE).map(name => caches.delete(name)));
    } catch {}
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin application modules are cached only after they are requested.
  // This keeps role/chat/map chunks out of first-install downloads while
  // preserving their availability after the user has opened those features.
  if (url.origin === self.location.origin &&
      /\\.(?:mjs|js)$/.test(url.pathname) &&
      !url.pathname.endsWith("/service-worker.js")) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) {
        event.waitUntil(fetch(request).then(response => {
          if (response.ok) return cache.put(request, response.clone());
          return undefined;
        }).catch(() => undefined));
        return cached;
      }

      const response = await fetch(request);
      if (response.ok) {
        try { await cache.put(request, response.clone()); } catch {}
      }
      return response;
    })());
    return;
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) return;
  const isPinnedLibrary = (url.hostname === "unpkg.com" && url.pathname.startsWith("/leaflet@1.9.4/")) ||
    (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@mediapipe/tasks-vision@1.2.0/")) ||
    (url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/mediapipe-models/face_detector/blaze_face_short_range/float16/1/"));
  if (!isPinnedLibrary) return;

  event.respondWith((async () => {
    let cache = null;
    try {
      cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch {}

    const response = await fetch(request);
    if (cache && response.ok && response.type !== "opaque") {
      try { await cache.put(request, response.clone()); } catch {}
    }
    return response;
  })());
});
