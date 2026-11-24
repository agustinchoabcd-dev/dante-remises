import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("administrative sections are separate lazy-loaded templates and modules", async () => {
  const source = await readFile(new URL("./admin-panel.mjs", import.meta.url), "utf8");
  for (const section of ["overview", "fleet", "trips", "passengers", "health"]) {
    assert.ok(source.includes(section + ":"));
    assert.ok(source.includes("./views/admin/" + section + ".html"));
    assert.ok(source.includes("./admin/sections/" + section + ".mjs"));
  }
  assert.ok(source.includes("Promise.all(["));
  assert.match(source, /activeModule?.unmount/);
  assert.match(source, /generation/);
});

test("trip history remains explicitly unavailable until the Firebase trip model is validated", async () => {
  const html = await readFile(new URL("./views/admin/trips.html", import.meta.url), "utf8");
  assert.match(html, /estructura actual todavía no ofrece un historial administrativo validado/);
  assert.doesNotMatch(html, /delete.*trip|eliminar.*viaje/i);
});

test("admin shell does not embed every operational section", async () => {
  const html = await readFile(new URL("./views/admin/shell.html", import.meta.url), "utf8");
  assert.match(html, /data-admin-content/);
  assert.doesNotMatch(html, /id="centralCars"|id="passengerList"|id="adminOperationalHealthContent"/);
});

test("summary is data-driven and does not contain invented fleet or trip totals", async () => {
  const html = await readFile(new URL("./views/admin/overview.html", import.meta.url), "utf8");
  const module = await readFile(new URL("./admin/sections/overview.mjs", import.meta.url), "utf8");
  assert.match(html, /id="adminOverviewFree"/);
  assert.match(html, /id="adminOverviewTodayTrips"/);
  assert.match(module, /loadAdminOverviewData/);
  assert.doesNotMatch(html, /4 vehículos registrados|[0-9]+ viajes hoy/);
});
