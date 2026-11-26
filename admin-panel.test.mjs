import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("administrative sections are separate lazy-loaded templates and modules", async () => {
  const source = await readFile(new URL("./admin-panel.mjs", import.meta.url), "utf8");
  for (const section of ["overview", "fleet", "trips", "passengers", "health", "staff"]) {
    assert.ok(source.includes(section + ":"));
    assert.ok(source.includes("./views/admin/" + section + ".html"));
    assert.ok(source.includes("./admin/sections/" + section + ".mjs"));
  }
  assert.ok(source.includes("Promise.all(["));
  assert.match(source, /previousModule\?\.unmount/);
  assert.match(source, /generation/);
});

test("trip history is read-only and uses filters over the real trip model", async () => {
  const html = await readFile(new URL("./views/admin/trips.html", import.meta.url), "utf8");
  const module = await readFile(new URL("./admin/sections/trips.mjs", import.meta.url), "utf8");
  const model = await readFile(new URL("./admin/trips-state.mjs", import.meta.url), "utf8");
  assert.match(html, /id="adminTripHistorySearch"/);
  assert.match(html, /id="adminTripHistoryStatus"/);
  assert.match(module, /loadAdminOverviewData/);
  assert.match(model, /createdAt/);
  assert.match(model, /updatedAt/);
  assert.match(html, /no modifica ni elimina viajes/);
  assert.doesNotMatch(html, /delete.*trip|eliminar.*viaje/i);
});

test("admin shell uses the agreed expanded categorized menu and bottom profile", async () => {
  const html = await readFile(new URL("./views/admin/shell.html", import.meta.url), "utf8");
  assert.match(html, /id="adminMenuToggle"/);
  assert.match(html, /data-admin-menu-backdrop/);
  assert.match(html, /id="adminMenuPanel"/);
  for (const category of ["Operación", "Personas", "Sistema"]) assert.ok(html.includes(category));
  assert.match(html, /Mi perfil/);
  assert.match(html, /data-admin-section="staff"/);
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
  assert.match(html, /data-admin-go="staff"/);
  assert.doesNotMatch(html, /Verificaciones.*Integración pendiente/);
});

test("admin overview state dependency is included in the Capacitor web bundle", async () => {
  const copyScript = await readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8");
  assert.match(copyScript, /"admin\/overview-state\.mjs"/);
});

test("admin workspace hides the global greeting without removing it from other roles", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /postLoginGreeting'\)\?\.classList\.toggle\('hidden',role==='admin'\)/);
  assert.match(html, /if\(role==='admin'\)\{greeting\.classList\.add\('hidden'\);return\}/);
  assert.match(html, /role==='passenger'\?\x60Hola/);
});

test("passenger directory filters only passenger profiles and leaves identity review pending honestly", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const module = await readFile(new URL("./admin/sections/passengers.mjs", import.meta.url), "utf8");
  const template = await readFile(new URL("./views/admin/passengers.html", import.meta.url), "utf8");
  assert.match(html, /profile\.role==='passenger'/);
  assert.match(module, /adminPassengerSearch/);
  assert.match(template, /no tiene un estado de revisión/);
});

test("staff directory is a separate read-only module and its assets are copied to Capacitor", async () => {
  const copyScript = await readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8");
  const shell = await readFile(new URL("./views/admin/shell.html", import.meta.url), "utf8");
  const module = await readFile(new URL("./admin/sections/staff.mjs", import.meta.url), "utf8");
  assert.match(shell, /data-admin-section="staff"/);
  assert.match(module, /loadAdminStaffData/);
  for (const asset of ["admin/staff-state.mjs", "admin/sections/staff.mjs", "views/admin/staff.html"]) {
    assert.ok(copyScript.includes('"' + asset + '"'), "Missing admin asset: " + asset);
  }
});

test("admin sections use the available width and keep health content responsive", async () => {
  const shell = await readFile(new URL("./views/admin/shell.html", import.meta.url), "utf8");
  const health = await readFile(new URL("./views/admin/health.html", import.meta.url), "utf8");
  assert.match(shell, /\.admin-workspace \.card\.panel\{width:100%;max-width:none;margin:0\}/);
  assert.match(shell, /\.admin-history-controls\{display:grid/);
  assert.match(shell, /@media\(max-width:380px\)/);
  assert.match(health, /class="admin-section-heading"/);
  assert.match(health, /id="adminHealthRefreshButton"/);
  assert.match(health, /no representa un historial persistente/i);
});

test("health refresh button is owned by the lazy health module, not bound twice globally", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const module = await readFile(new URL("./admin/sections/health.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(html, /bindRoleDom\('adminHealthRefreshButton'/);
  assert.match(module, /addEventListener\("click",refresh\)/);
  assert.match(module, /removeEventListener\("click",refresh\)/);
});
