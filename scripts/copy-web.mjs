import { copyFile, mkdir } from "node:fs/promises";

const sourceDirectory = new URL("../", import.meta.url);
const destinationDirectory = new URL("../www/", import.meta.url);
const webAssets = [
  "index.html",
  "role-resolver.mjs",
  "chat-client.mjs"
];

await mkdir(destinationDirectory, { recursive: true });

for (const asset of webAssets) {
  await copyFile(
    new URL(asset, sourceDirectory),
    new URL(asset, destinationDirectory)
  );
}

console.log(`Web application copied to www/: ${webAssets.join(", ")}`);
