import test from "node:test";
import assert from "node:assert/strict";
import { resolveDriverUidForCar, resolveRoleFromProfile } from "./role-resolver.mjs";

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

test("legacy driver without a profile role or carId remains compatible", () => {
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

test("driver without a carId field falls back to legacy assignment", () => {
  const result = resolveRoleFromProfile({
    uid: "driver-legacy-car", adminUid,
    profile: { role: "driver", active: true },
    legacyStaff: legacyDriver
  });
  assert.equal(result.carId, "109");
});

test("driver with explicit null carId is rejected instead of using legacy assignment", () => {
  assert.throws(() => resolveRoleFromProfile({
    uid: "driver-unassigned", adminUid,
    profile: { role: "driver", active: true, carId: null },
    legacyStaff: legacyDriver
  }), /coche asignado/);
});

test("driver with a valid dynamic carId uses the dynamic assignment", () => {
  const result = resolveRoleFromProfile({
    uid: "driver-reassigned", adminUid,
    profile: { role: "driver", active: true, carId: "137" },
    legacyStaff: legacyDriver
  });
  assert.equal(result.carId, "137");
});

test("car without a dynamic driverUid field falls back to legacy UID", () => {
  assert.equal(resolveDriverUidForCar({
    driverUid: null, driverUidConfigured: false
  }, "legacy-driver-uid"), "legacy-driver-uid");
});

test("car with explicit null driverUid does not fall back to legacy UID", () => {
  assert.equal(resolveDriverUidForCar({
    driverUid: null, driverUidConfigured: true
  }, "legacy-driver-uid"), null);
});

test("car with a valid dynamic driverUid uses the dynamic UID", () => {
  assert.equal(resolveDriverUidForCar({
    driverUid: "dynamic-driver-uid", driverUidConfigured: true
  }, "legacy-driver-uid"), "dynamic-driver-uid");
});

test("car with an invalid explicit driverUid does not restore the legacy UID", () => {
  assert.equal(resolveDriverUidForCar({
    driverUid: "", driverUidConfigured: true
  }, "legacy-driver-uid"), null);
});

test("driver without any car assignment is rejected", () => {
  assert.throws(() => resolveRoleFromProfile({
    uid: "driver-2", adminUid, profile: { role: "driver", active: true }
  }), /coche asignado/);
});
