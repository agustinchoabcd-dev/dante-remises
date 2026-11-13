import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
if (!manifest.includes("android.media.action.IMAGE_CAPTURE")) {
  manifest = manifest.replace(
    manifestOpen[0],
    `${manifestOpen[0]}\n    <queries><intent><action android:name="android.media.action.IMAGE_CAPTURE" /></intent></queries>`
  );
}
const providerMarker = 'android:name="androidx.core.content.FileProvider"';
if (!manifest.includes(providerMarker)) {
  if (!manifest.includes("</application>")) throw new Error("No se encontró </application> en AndroidManifest.xml");
  const provider = `
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="com.danteremises.test.dante.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/dante_file_paths" />
        </provider>
`;
  manifest = manifest.replace("</application>", provider + "    </application>");
}
await writeFile(manifestPath, manifest, "utf8");
console.log("AndroidManifest.xml: audio, consultas de cámara y FileProvider configurados.");

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
if (!activityPath) throw new Error("No se encontró MainActivity.java/kt en el proyecto Android generado.");
if (!activityPath.endsWith(".java")) throw new Error("Se encontró MainActivity.kt; el parche nativo requiere MainActivity.java.");

let source = await readFile(activityPath, "utf8");
const packageMatch = source.match(/^package\s+([A-Za-z0-9_.]+);/m);
if (!packageMatch) throw new Error("No se pudo determinar el package de MainActivity.java.");
const packageName = packageMatch[1];
const packageDirectory = path.dirname(activityPath);
const pluginPath = path.join(packageDirectory, "DantePhotoChooserPlugin.java");
const pluginSource = `package ${packageName};

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;

@CapacitorPlugin(name = "DantePhotoChooser")
public class DantePhotoChooserPlugin extends Plugin {
    private Uri pendingCameraUri;
    private File pendingCameraFile;

    @PluginMethod
    public void pickImage(PluginCall call) {
        try {
            File directory = new File(getContext().getCacheDir(), "chat-images");
            if (!directory.exists() && !directory.mkdirs()) {
                call.reject("No se pudo preparar el almacenamiento temporal de la fotografía.");
                return;
            }

            pendingCameraFile = File.createTempFile("chat-photo-", ".jpg", directory);
            pendingCameraUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".dante.fileprovider",
                pendingCameraFile
            );

            Intent contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            contentIntent.setType("image/*");

            Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (cameraIntent.resolveActivity(getContext().getPackageManager()) != null) {
                cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
                cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else {
                cameraIntent = null;
            }

            Intent chooser = Intent.createChooser(contentIntent, "Seleccionar fotografía");
            if (cameraIntent != null) {
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { cameraIntent });
            }
            startActivityForResult(call, chooser, "pickImageResult");
        } catch (Exception error) {
            cleanupTemporaryPhoto();
            call.reject("No se pudo abrir el selector de fotografías.", error);
        }
    }

    @ActivityCallback
    private void pickImageResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            cleanupTemporaryPhoto();
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            cleanupTemporaryPhoto();
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri selectedUri = result.getData() != null ? result.getData().getData() : null;
        if (selectedUri == null) selectedUri = pendingCameraUri;
        if (selectedUri == null) {
            cleanupTemporaryPhoto();
            call.reject("Android no devolvió una fotografía.");
            return;
        }

        try (InputStream input = getContext().getContentResolver().openInputStream(selectedUri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("No se pudo leer la fotografía seleccionada.");
            byte[] buffer = new byte[8192];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 16 * 1024 * 1024) {
                    throw new IllegalStateException("La fotografía supera los 16 MB permitidos.");
                }
                output.write(buffer, 0, count);
            }
            String mimeType = getContext().getContentResolver().getType(selectedUri);
            if (mimeType == null || !mimeType.startsWith("image/")) mimeType = "image/jpeg";
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("mimeType", mimeType);
            response.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("No se pudo leer la fotografía seleccionada.", error);
        } finally {
            cleanupTemporaryPhoto();
        }
    }

    private void cleanupTemporaryPhoto() {
        if (pendingCameraFile != null && pendingCameraFile.exists()) pendingCameraFile.delete();
        pendingCameraFile = null;
        pendingCameraUri = null;
    }
}
`;
await writeFile(pluginPath, pluginSource, "utf8");
console.log("DantePhotoChooserPlugin.java: selector Android con cámara y archivos registrado como plugin local.");

const resourcesDirectory = path.resolve("android/app/src/main/res/xml");
await mkdir(resourcesDirectory, { recursive: true });
await writeFile(
  path.join(resourcesDirectory, "dante_file_paths.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="chat_images" path="chat-images/" /></paths>\n',
  "utf8"
);

const registration = "registerPlugin(DantePhotoChooserPlugin.class);";
if (!source.includes(registration)) {
  const superOnCreate = /(\s*)super\.onCreate\(savedInstanceState\);/;
  if (superOnCreate.test(source)) {
    source = source.replace(superOnCreate, (match, indent) => `${indent}${registration}\n${indent}super.onCreate(savedInstanceState);`);
  } else {
    const classOpen = /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/;
    if (!classOpen.test(source)) throw new Error("MainActivity.java no tiene la estructura BridgeActivity esperada.");
    source = source.replace(
      classOpen,
      match => match + `\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        ${registration}\n        super.onCreate(savedInstanceState);\n    }`
    );
  }
}
const audioMarker = "setMediaPlaybackRequiresUserGesture(false)";
if (!source.includes(audioMarker)) {
  const statement = "getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);";
  const superOnCreate = /(\s*super\.onCreate\(savedInstanceState\);)/;
  if (!superOnCreate.test(source)) throw new Error("No se encontró super.onCreate para configurar el WebView.");
  source = source.replace(superOnCreate, match => match + "\n        " + statement);
}
await writeFile(activityPath, source, "utf8");
console.log("MainActivity.java: plugin registrado y reproducción de audio del WebView habilitada.");
