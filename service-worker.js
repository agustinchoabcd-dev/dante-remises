const STATIC_CACHE = "dante-static-v1";
const STATIC_ASSETS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];
const ALLOWED_HOSTS = new Set(["unpkg.com", "cdn.jsdelivr.net", "storage.googleapis.com"]);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.allSettled(STATIC_ASSETS.filter(Boolean).map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("dante-static-") && name !== STATIC_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!ALLOWED_HOSTS.has(url.hostname)) return;
  const isPinnedLibrary = url.hostname === "unpkg.com" && url.pathname.startsWith("/leaflet@1.9.4/") ||
    url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@mediapipe/tasks-vision@1.2.0/") ||
    url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/mediapipe-models/face_detector/blaze_face_short_range/float16/1/");
  if (!isPinnedLibrary) return;
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type !== "opaque") {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
