import test from "node:test";
import assert from "node:assert/strict";
import { resolveRoleFromProfile } from "./role-resolver.mjs";

const adminUid = "root-admin";
const driverUid = "driver-1";
const legacyDriver = { role: "driver", name: "Chofer legado", carId: "109" };

test("root admin remains admin and assigned to car 144", () => {
  const result = resolveRoleFromProfile({
    uid: adminUid, adminUid, profile: { role: "passenger", active: false },
    legacyStaff: { role: "admin", name: "Agustin" }
  });
  assert.equal(result.role, "admin");
  assert.equal(result.carId, "144");
});

test("dynamic driver profile resolves assigned car", () => {
  const result = resolveRoleFromProfile({
    uid: driverUid, adminUid, profile: { role: "driver", active: true, carId: "109", name: "Matias" }
  });
  assert.equal(result.role, "driver");
  assert.equal(result.carId, "109");
  assert.equal(result.name, "Matias");
});

test("dynamic operator does not receive a car", () => {
  const result = resolveRoleFromProfile({
    uid: "operator-1", adminUid, profile: { role: "operator", active: true, carId: "109" }
  });
  assert.equal(result.role, "operator");
  assert.equal(result.carId, null);
});

test("inactive profile is rejected", () => {
  assert.throws(() => resolveRoleFromProfile({
    uid: "passenger-1", adminUid, profile: { role: "passenger", active: false }
  }), /desactivada/);
});

test("legacy driver without a profile role remains compatible", () => {
  const result = resolveRoleFromProfile({
    uid: driverUid, adminUid, profile: { name: "Chofer legado" },
    legacyStaff: legacyDriver
  });
  assert.equal(result.role, "driver");
  assert.equal(result.carId, "109");
});

test("explicit passenger role overrides legacy staff mapping", () => {
  const result = resolveRoleFromProfile({
    uid: driverUid, adminUid, profile: { role: "passenger", active: true },
    legacyStaff: legacyDriver
  });
  assert.equal(result.role, "passenger");
  assert.equal(result.carId, null);
});

test("non-root UID cannot become admin", () => {
  const result = resolveRoleFromProfile({
    uid: "not-root", adminUid, profile: { role: "admin", active: true }
  });
  assert.equal(result, null);
});

test("driver without car assignment is rejected", () => {
  assert.throws(() => resolveRoleFromProfile({
    uid: "driver-2", adminUid, profile: { role: "driver", active: true }
  }), /coche asignado/);
});
