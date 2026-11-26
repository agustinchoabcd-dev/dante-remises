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
  assert.match(source, /previousModule\?\.unmount/);
  assert.match(source, /generation/);
});

test("trip history remains explicitly unavailable until the Firebase trip model is validated", async () => {
  const html = await readFile(new URL("./views/admin/trips.html", import.meta.url), "utf8");
  assert.match(html, /estructura actual todavía no ofrece un historial administrativo validado/);
  assert.doesNotMatch(html, /delete.*trip|eliminar.*viaje/i);
});

test("admin shell uses the agreed expanded categorized menu and bottom profile", async () => {
  const html = await readFile(new URL("./views/admin/shell.html", import.meta.url), "utf8");
  assert.match(html, /id="adminMenuToggle"/);
  assert.match(html, /data-admin-menu-backdrop/);
  assert.match(html, /id="adminMenuPanel"/);
  for (const category of ["Operación", "Personas", "Sistema"]) assert.ok(html.includes(category));
  assert.match(html, /Mi perfil/);
  assert.match(html, /id="adminWorkspaceSelector"/);
  for (const id of ["adminWorkspaceDriverButton", "adminWorkspaceOperatorButton", "adminWorkspacePassengerButton", "adminWorkspaceAllButton"]) {
    assert.ok(html.includes('id="' + id + '"'), "Workspace control missing: " + id);
  }
  assert.doesNotMatch(html, /admin-module-nav|overflow-x:auto/);
  assert.match(html, /data-admin-content/);
  assert.doesNotMatch(html, /id="centralCars"|id="passengerList"|id="adminOperationalHealthContent"/);
});

test("admin navigation closes accessibly and guards stale section transitions", async () => {
  const source = await readFile(new URL("./admin-panel.mjs", import.meta.url), "utf8");
  assert.match(source, /function closeMenu/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /request !== generation/);
  assert.match(source, /previousModule/);
});

test("summary is data-driven and does not contain invented fleet or trip totals", async () => {
  const html = await readFile(new URL("./views/admin/overview.html", import.meta.url), "utf8");
  const module = await readFile(new URL("./admin/sections/overview.mjs", import.meta.url), "utf8");
  assert.match(html, /id="adminOverviewFree"/);
  assert.match(html, /id="adminOverviewTodayTrips"/);
  assert.match(module, /loadAdminOverviewData/);
  assert.doesNotMatch(html, /4 vehículos registrados|[0-9]+ viajes hoy/);
});

test("admin overview state dependency is included in the Capacitor web bundle", async () => {
  const copyScript = await readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8");
  assert.match(copyScript, /"admin\/overview-state\.mjs"/);
});
