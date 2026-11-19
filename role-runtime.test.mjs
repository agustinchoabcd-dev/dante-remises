import test from "node:test";
import assert from "node:assert/strict";
import { activateRole } from "./role-runtime.mjs";

test("unknown role is rejected instead of falling back to another role", async () => {
  await assert.rejects(() => activateRole("unknown", {}), /Unsupported Dante Remises role/);
});

test("passenger activation waits for photo readiness and selects only the passenger view", async () => {
  const calls = [];
  const result = await activateRole("passenger", {
    loadPassengerPhoto: async () => { calls.push("photo"); return true; },
    showView: view => calls.push("view:" + view),
    showPassengerOnboarding: () => calls.push("onboarding")
  });

  assert.deepEqual(calls, ["photo", "view:pasajero"]);
  assert.equal(result.view, "pasajero");
});

test("passenger without a ready photo uses onboarding, not another role view", async () => {
  const calls = [];
  const result = await activateRole("passenger", {
    loadPassengerPhoto: async () => false,
    showView: view => calls.push("view:" + view),
    showPassengerOnboarding: () => calls.push("onboarding")
  });

  assert.deepEqual(calls, ["onboarding"]);
  assert.equal(result.view, "passengerOnboarding");
});

test("driver activation shows the driver view and starts driver operations", async () => {
  const calls = [];
  const result = await activateRole("driver", {
    user: { uid: "driver-1" },
    role: { role: "driver", carId: "109" },
    loadRoleView: async role => calls.push("mount:" + role),
    showView: view => calls.push("view:" + view),
    syncDriverPushRegistration: () => calls.push("push"),
    listenDriverInbox: () => calls.push("inbox"),
    restoreDriverActiveTrip: async () => calls.push("restore"),
    startDriverGps: () => calls.push("gps"),
    processPendingTripAction: async () => calls.push("pending")
  });

  assert.equal(result.view, "chofer");
  await result.background;
  assert.deepEqual(calls, ["mount:driver", "view:chofer", "push", "inbox", "restore", "gps", "pending"]);
});

test("operator activation does not load driver operations", async () => {
  const calls = [];
  const result = await activateRole("operator", {
    showView: view => calls.push("view:" + view),
    startOperatorPresence: () => calls.push("operator-presence")
  });

  assert.equal(result.view, "central");
  await result.background;
  assert.deepEqual(calls, ["view:central", "operator-presence"]);
});

test("admin activation keeps central tools and the car 144 driver runtime", async () => {
  const calls = [];
  const result = await activateRole("admin", {
    user: { uid: "admin-1" },
    role: { role: "admin", carId: "144" },
    loadRoleView: async role => calls.push("mount:" + role),
    showView: view => calls.push("view:" + view),
    setAdminTripAlertPanel: enabled => calls.push("admin-alerts:" + enabled),
    loadAdminProfiles: async () => calls.push("profiles"),
    initializeAdminCars: async () => calls.push("cars"),
    syncDriverPushRegistration: () => calls.push("push"),
    listenDriverInbox: () => calls.push("inbox"),
    restoreDriverActiveTrip: async () => calls.push("restore"),
    startDriverGps: () => calls.push("gps"),
    processPendingTripAction: async () => calls.push("pending")
  });

  assert.equal(result.view, "central");
  await result.background;
  assert.deepEqual(calls, [
    "mount:driver", "view:central", "admin-alerts:true", "profiles", "cars",
    "push", "inbox", "restore", "gps", "pending"
  ]);
});

test("stale passenger auth callback cannot reveal its view after a newer login", async () => {
  let current = true;
  const calls = [];
  const result = await activateRole("passenger", {
    isCurrent: () => current,
    loadPassengerPhoto: async () => { current = false; return true; },
    showView: view => calls.push("view:" + view),
    showPassengerOnboarding: () => calls.push("onboarding")
  });

  assert.equal(result.stale, true);
  assert.deepEqual(calls, []);
});

test("stale staff callbacks cannot reveal or activate an old role", async () => {
  const calls = [];
  const context = {
    isCurrent: () => false,
    user: { uid: "old-user" },
    role: { role: "driver", carId: "109" },
    showView: view => calls.push("view:" + view),
    showPassengerOnboarding: () => calls.push("onboarding"),
    loadPassengerPhoto: async () => true,
    setAdminTripAlertPanel: enabled => calls.push("admin-alerts:" + enabled),
    startOperatorPresence: () => calls.push("operator-presence"),
    syncDriverPushRegistration: () => calls.push("push"),
    listenDriverInbox: () => calls.push("inbox"),
    restoreDriverActiveTrip: async () => calls.push("restore"),
    startDriverGps: () => calls.push("gps"),
    processPendingTripAction: async () => calls.push("pending"),
    loadAdminProfiles: async () => calls.push("profiles"),
    initializeAdminCars: async () => calls.push("cars")
  };

  for (const role of ["driver", "operator", "admin"]) {
    const result = await activateRole(role, context);
    assert.equal(result.stale, true);
  }
  assert.deepEqual(calls, []);
});
