import { copyFile, mkdir } from "node:fs/promises";

const sourceDirectory = new URL("../", import.meta.url);
const destinationDirectory = new URL("../www/", import.meta.url);
const webAssets = [
  "index.html",
  "role-transition.mjs",
  "role-runtime.mjs",
  "role-view-access.mjs",
  "role-template-loader.mjs",
  "role-dom-bindings.mjs",
  "views/passenger.html",
  "map-runtime-loader.mjs",
  "chat-runtime-loader.mjs",
  "roles/passenger.mjs",
  "roles/driver.mjs",
  "roles/operator.mjs",
  "roles/admin.mjs",
  "js/dante-map.js",
  "js/mapbox-config.js",
  "js/dante-geocoding.js",
  "js/geocoding-config.js",
  "assets/chat-wallpaper.jpg",
  "service-worker.js",
  "media-cache.mjs",
  "role-resolver.mjs",
  "chat-client.mjs",
  "chat-history-cache.mjs",
  "perf-monitor.mjs",
  "diagnostics-monitor.mjs",
  "availability-refresh.mjs",
  "app-telemetry.mjs",
  "trip-alerts-client.mjs"
];

await mkdir(destinationDirectory, { recursive: true });
await mkdir(new URL("assets/", destinationDirectory), { recursive: true });
await mkdir(new URL("js/", destinationDirectory), { recursive: true });
await mkdir(new URL("roles/", destinationDirectory), { recursive: true });
await mkdir(new URL("views/", destinationDirectory), { recursive: true });

for (const asset of webAssets) {
  await copyFile(
    new URL(asset, sourceDirectory),
    new URL(asset, destinationDirectory)
  );
}

console.log(`Web application copied to www/: ${webAssets.join(", ")}`);
