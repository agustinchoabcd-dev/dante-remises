import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url)
);

let manifest = await readFile(manifestPath, "utf8");
const manifestOpen = manifest.match(/<manifest\b[^>]*>/);

if (!manifestOpen) {
  throw new Error("No se encontró la etiqueta <manifest> en AndroidManifest.xml");
}

const declarations = [
  '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />'
];

for (const declaration of declarations) {
  const permissionName = declaration.match(/android:name="([^"]+)"/)?.[1];
  const alreadyDeclared = permissionName
    ? manifest.includes(`android:name="${permissionName}"`)
    : manifest.includes('android.hardware.location.gps');

  if (!alreadyDeclared) {
    manifest = manifest.replace(
      manifestOpen[0],
      `${manifestOpen[0]}\n${declaration}`
    );
  }
}

await writeFile(manifestPath, manifest, "utf8");
console.log("AndroidManifest.xml: permisos de ubicación aproximada y precisa declarados.");
