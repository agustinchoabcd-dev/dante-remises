import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const manifestPath = path.resolve("android/app/src/main/AndroidManifest.xml");
const gradlePath = path.resolve("android/app/build.gradle");
const nativeRoot = path.resolve("android-native/src/main/java");
const javaRoot = path.resolve("android/app/src/main/java");
let manifest = await readFile(manifestPath, "utf8");
let gradle = await readFile(gradlePath, "utf8");

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const result = await findFile(full, name);
      if (result) return result;
    } else if (entry.name === name) return full;
  }
  return null;
}
const activityPath = await findFile(javaRoot, "MainActivity.java");
if (!activityPath) throw new Error("No se encontró MainActivity.java.");
const activity = await readFile(activityPath, "utf8");
const packageName = activity.match(/^package\s+([A-Za-z0-9_.]+);/m)?.[1];
if (!packageName) throw new Error("No se pudo identificar el package Android.");
const packageDir = path.join(javaRoot, ...packageName.split("."));
await mkdir(packageDir, { recursive: true });

async function copyJava(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await copyJava(full);
    else if (entry.name.endsWith(".java")) {
      const source = (await readFile(full, "utf8")).replaceAll("__PACKAGE__", packageName);
      await writeFile(path.join(packageDir, entry.name), source, "utf8");
    }
  }
}
await copyJava(nativeRoot);

for (const permission of [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE"
]) {
  if (!manifest.includes('android:name="' + permission + '"')) {
    manifest = manifest.replace(/<manifest\b[^>]*>/, match => match + '\n    <uses-permission android:name="' + permission + '" />');
  }
}
if (!manifest.includes('android:name=".DantePushApplication"')) {
  manifest = manifest.replace("<application", '<application android:name=".DantePushApplication"');
}
const components = `
        <service android:name=".DanteFirebaseMessagingService" android:exported="false">
            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
        </service>
        <service android:name=".DanteTripAlertService" android:exported="false" android:foregroundServiceType="specialUse">
            <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="User-visible alert for incoming passenger ride requests; the driver can accept or reject." />
        </service>
`;
if (!manifest.includes('android:name=".DanteFirebaseMessagingService"')) {
  manifest = manifest.replace("</application>", components + "\n    </application>");
}

const configPath = path.resolve("android/app/google-services.json");
let config = { apiKey: "", appId: "", projectId: "", senderId: "" };
try {
  const json = JSON.parse(await readFile(configPath, "utf8"));
  const client = (json.client || []).find(item => item?.client_info?.android_client_info?.package_name === packageName);
  if (!client) throw new Error("google-services.json no contiene el package " + packageName);
  config = {
    apiKey: client.api_key?.[0]?.current_key || "",
    appId: client.client_info?.mobilesdk_app_id || "",
    projectId: json.project_info?.project_id || "",
    senderId: json.project_info?.project_number || ""
  };
  if (Object.values(config).some(value => !value)) throw new Error("google-services.json está incompleto.");
  console.log("Configuración Firebase Android cargada para " + packageName + ".");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.warn("FIREBASE_ANDROID_CONFIG_MISSING: la APK compilará, pero FCM no podrá registrar dispositivos.");
}
const javaString = value => '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
const options = `package ${packageName};
final class DanteFirebaseOptions {
    static final String API_KEY = ${javaString(config.apiKey)};
    static final String APP_ID = ${javaString(config.appId)};
    static final String PROJECT_ID = ${javaString(config.projectId)};
    static final String SENDER_ID = ${javaString(config.senderId)};
    static boolean isConfigured() {
        return !API_KEY.isEmpty() && !APP_ID.isEmpty() && !PROJECT_ID.isEmpty() && !SENDER_ID.isEmpty();
    }
    private DanteFirebaseOptions() {}
}
`;
await writeFile(path.join(packageDir, "DanteFirebaseOptions.java"), options, "utf8");

let main = activity;
const pluginRegistration = "registerPlugin(DanteTripAlertsPlugin.class);";
if (!main.includes(pluginRegistration)) {
  const photoRegistration = "registerPlugin(DantePhotoChooserPlugin.class);";
  if (main.includes(photoRegistration)) main = main.replace(photoRegistration, photoRegistration + "\n        " + pluginRegistration);
  else {
    const marker = /(\s*)super\.onCreate\(savedInstanceState\);/;
    if (!marker.test(main)) throw new Error("No se encontró super.onCreate en MainActivity.");
    main = main.replace(marker, (match, indent) => indent + pluginRegistration + "\n" + match);
  }
}

if (!main.includes("savePendingTripAction(getIntent())")) {
  main = main.replace("super.onCreate(savedInstanceState);", "super.onCreate(savedInstanceState);\\n        savePendingTripAction(getIntent());");
}
if (!main.includes("private void savePendingTripAction(")) {
  const helper = `
    private void savePendingTripAction(android.content.Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra("danteTripAction");
        String tripId = intent.getStringExtra("danteTripId");
        if (tripId == null || tripId.isEmpty() ||
            !("accept".equals(action) || "reject".equals(action))) return;
        getSharedPreferences("dante_trip_alerts", MODE_PRIVATE).edit()
            .putString("pending_action", action)
            .putString("pending_trip_id", tripId)
            .apply();
        stopService(new android.content.Intent(this, DanteTripAlertService.class));
    }

    @Override
    public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        savePendingTripAction(intent);
    }
`;
  main = main.replace(/\\s*}\\s*$/, "\\n" + helper + "}\\n");
}
await writeFile(activityPath, main, "utf8");

const bom = 'implementation platform("com.google.firebase:firebase-bom:35.2.0")';
if (!gradle.includes(bom)) {
  if (!gradle.includes("dependencies {")) throw new Error("No se encontró dependencies en android/app/build.gradle.");
  gradle = gradle.replace("dependencies {", 'dependencies {\n    ' + bom + '\n    implementation "com.google.firebase:firebase-messaging"');
}
await writeFile(gradlePath, gradle, "utf8");
await writeFile(manifestPath, manifest, "utf8");
console.log("Android trip alerts patched.");
