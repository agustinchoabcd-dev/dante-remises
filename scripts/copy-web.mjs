import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../index.html", import.meta.url);
const destinationDirectory = new URL("../www/", import.meta.url);
const destination = new URL("../www/index.html", import.meta.url);

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);

console.log("Web app copied from index.html to www/index.html");
