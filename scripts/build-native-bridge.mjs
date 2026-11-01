import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(new URL("../www/", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("./native-bridge.js", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  outfile: new URL("../www/native-bridge.js", import.meta.url).pathname,
  logLevel: "info"
});
console.log("Native Capacitor bridge bundled into www/native-bridge.js");
