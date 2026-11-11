import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("android/app/src/main/java");

const manifestPath = path.resolve("android/app/src/main/AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
const manifestOpen = manifest.match(/<manifest\b[^>]*>/);
if (!manifestOpen) throw new Error("No se encontró <manifest> en AndroidManifest.xml");

for (const permission of [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
]) {
  if (!manifest.includes(`android:name="${permission}"`)) {
    manifest = manifest.replace(
      manifestOpen[0],
      `${manifestOpen[0]}\n    <uses-permission android:name="${permission}" />`
    );
  }
}
if (!manifest.includes('android:name="android.hardware.microphone"')) {
  manifest = manifest.replace(
    manifestOpen[0],
    `${manifestOpen[0]}\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />`
  );
}
await writeFile(manifestPath, manifest, "utf8");
console.log("AndroidManifest.xml: permisos de micrófono y audio declarados (micrófono opcional).");

async function findMainActivity(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findMainActivity(fullPath);
      if (found) return found;
    } else if (/^MainActivity\.(java|kt)$/.test(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

const activityPath = await findMainActivity(root);
if (!activityPath) {
  throw new Error("No se encontró MainActivity.java/kt en el proyecto Android generado.");
}

let source = await readFile(activityPath, "utf8");
const marker = "setMediaPlaybackRequiresUserGesture(false)";
if (source.includes(marker)) {
  console.log("MainActivity: reproducción de audio automática ya habilitada.");
} else if (activityPath.endsWith(".java")) {
  const statement = "getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);";
  const onCreate = /super\.onCreate\(savedInstanceState\);/;
  if (onCreate.test(source)) {
    source = source.replace(onCreate, match => match + "\n        " + statement);
  } else {
    const classOpen = /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/;
    if (!classOpen.test(source)) throw new Error("MainActivity.java no tiene la estructura BridgeActivity esperada.");
    source = source.replace(classOpen, match => match + "\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        " + statement + "\n    }");
  }
  await writeFile(activityPath, source, "utf8");
  console.log("MainActivity.java: WebView permite el sonido de inicio sin esperar el primer toque.");
} else {
  throw new Error("Se encontró MainActivity.kt; el parche de audio automático aún no contempla Kotlin.");
}
