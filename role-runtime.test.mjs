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

test("temporary passenger photo verification failures keep the authenticated passenger workspace", async () => {
  const calls = [];
  const result = await activateRole("passenger", {
    loadPassengerPhoto: async () => { calls.push("photo"); return null; },
    showView: view => calls.push("view:" + view),
    showPassengerOnboarding: () => calls.push("onboarding")
  });

  assert.deepEqual(calls, ["photo", "view:pasajero"]);
  assert.equal(result.view, "pasajero");
  assert.equal(result.photoCheckUnavailable, true);
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

test("driver activation opens Inicio and starts driver operations", async () => {
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

  assert.equal(result.view, "inicio");
  await result.background;
  assert.deepEqual(calls, ["mount:driver", "view:inicio", "push", "inbox", "restore", "gps", "pending"]);
});

test("operator activation does not load driver operations", async () => {
  const calls = [];
  const result = await activateRole("operator", {
    loadRoleView: async role => calls.push("mount:" + role),
    showView: view => calls.push("view:" + view),
    startOperatorPresence: () => calls.push("operator-presence")
  });

  assert.equal(result.view, "central");
  await result.background;
  assert.deepEqual(calls, ["mount:central", "view:central", "operator-presence"]);
});

test("admin starts in driver workspace and lazily opens/unloads the admin panel", async () => {
  const calls = [];
  const result = await activateRole("admin", {
    user: { uid: "admin-1" },
    role: { role: "admin", carId: "144" },
    loadRoleView: async role => calls.push("mount:" + role),
    unloadRoleView: role => calls.push("unmount:" + role),
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

  assert.equal(result.view, "inicio");
  assert.deepEqual(calls.slice(0, 2), ["mount:driver", "view:inicio"]);
  assert.equal(typeof result.workspaceController.openAdminPanel, "function");
  await result.workspaceController.openAdminPanel();
  assert.ok(calls.includes("mount:central"));
  assert.ok(calls.includes("admin-alerts:true"));
  assert.ok(calls.includes("profiles"));
  assert.equal(calls.at(-1), "view:central");

  result.workspaceController.openDriverWorkspace();
  assert.deepEqual(calls.slice(-2), ["view:inicio", "unmount:central"]);
  await result.background;
  for (const operation of ["cars", "push", "inbox", "restore", "gps", "pending"]) {
    assert.ok(calls.includes(operation), "Missing admin driver operation: " + operation);
  }
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
