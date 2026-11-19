import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

test("Mapbox prototype is isolated and pinned to the current GL JS CDN version", () => {
  assert.match(html, /mapbox-gl-js\/v3\.35\.0\/mapbox-gl\.js/);
  assert.match(html, /mapbox-gl-js\/v3\.35\.0\/mapbox-gl\.css/);
  assert.match(html, /Laboratorio cartográfico/);
});

test("the prototype checks Mapbox and WebGL2 support before map initialization", () => {
  assert.match(html, /mapboxgl\.supported\(\)/);
  assert.match(html, /window\.WebGL2RenderingContext/);
  assert.match(html, /if \(!supported\)/);
});

test("only public tokens are accepted and no token is hardcoded or persisted", () => {
  assert.match(html, /token\.startsWith\('pk\.'\)/);
  assert.doesNotMatch(html, /sk\.[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});

test("the prototype centers on Santa Rosa de Calamuchita and creates only one map instance", () => {
  assert.match(html, /center: \[-64\.5368, -32\.0717\]/);
  assert.match(html, /map = new mapboxgl\.Map\(/);
  assert.match(html, /if \(map\)/);
  assert.match(html, /map\.remove\(\)/);
});

test("the prototype does not integrate search, directions, Firebase, or chat", () => {
  assert.doesNotMatch(html, /api\.mapbox\.com\/directions/);
  assert.doesNotMatch(html, /searchbox|geocod/);
  assert.doesNotMatch(html, /firebase|chat-client|tripInbox/);
});


test("the prototype allows at most one Mapbox initialization attempt per page session", () => {
  assert.match(html, /let mapInitializationAttempted = false/);
  assert.match(html, /if \(mapInitializationAttempted\)/);
  assert.match(html, /mapInitializationAttempted = true/);
  assert.match(html, /loadButton\.textContent = 'Intento utilizado'/);
  assert.match(html, /loadButton\.disabled = true/);
  assert.match(html, /no se permite otra inicialización/);
});
