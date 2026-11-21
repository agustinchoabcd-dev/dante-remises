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

test("admin starts in driver workspace and swaps mutually exclusive templates without changing role", async () => {
  const calls = [];
  const result = await activateRole("admin", {
    user: { uid: "admin-1" },
    role: { role: "admin", carId: "144" },
    loadRoleView: async role => calls.push("mount:" + role),
    unloadRoleView: role => calls.push("unmount:" + role),
    showView: view => calls.push("view:" + view),
    suspendDriverWorkspace: () => calls.push("suspend-driver-ui"),
    resumeDriverWorkspace: async () => calls.push("resume-driver-ui"),
    setAdminTripAlertPanel: enabled => calls.push("admin-alerts:" + enabled),
    renderAdminDriverTripSummary: () => calls.push("admin-trip-summary"),
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
  assert.ok(calls.includes("suspend-driver-ui"));
  assert.ok(calls.includes("unmount:driver"));
  assert.ok(calls.includes("admin-alerts:true"));
  assert.ok(calls.includes("admin-trip-summary"));
  assert.ok(calls.includes("view:central"));
  await Promise.resolve();

  await result.workspaceController.openDriverWorkspace();
  const returnSteps = ["mount:driver", "view:inicio", "unmount:central", "unmount:passenger", "resume-driver-ui"].map(item => calls.lastIndexOf(item));
  assert.ok(returnSteps.every((position, index) => position >= 0 && (index === 0 || position > returnSteps[index - 1])));
  assert.ok(calls.includes("resume-driver-ui"));
  assert.ok(calls.includes("unmount:central"));
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

test("admin can enter operator and passenger workspaces while retaining the admin identity", async () => {
  const calls = [];
  const result = await activateRole("admin", {
    user: { uid: "admin-1" }, role: { role: "admin", carId: "144" },
    loadRoleView: async role => { calls.push("mount:" + role); return {}; },
    unloadRoleView: role => calls.push("unmount:" + role),
    showView: view => calls.push("view:" + view),
    setWorkspaceRole: role => calls.push("workspace:" + role),
    stopOperatorPresence: async () => calls.push("stop-operator"),
    startOperatorPresence: () => calls.push("start-operator"),
    suspendDriverWorkspace: () => calls.push("suspend-driver"),
    suspendPassengerWorkspace: () => calls.push("suspend-passenger"),
    setAdminTripAlertPanel: enabled => calls.push("admin-alerts:" + enabled),
    loadPassengerPhoto: async () => { calls.push("passenger-photo"); return true; },
    showPassengerOnboarding: () => calls.push("passenger-onboarding"),
    resumePassengerWorkspace: () => calls.push("resume-passenger"),
    initializeAdminCars: async () => calls.push("cars"),
    syncDriverPushRegistration: async () => {},
    listenDriverInbox: () => {},
    restoreDriverActiveTrip: async () => {},
    startDriverGps: () => {},
    processPendingTripAction: async () => {}
  });
  await result.workspaceController.openOperatorWorkspace();
  assert.ok(calls.includes("workspace:operator"));
  assert.ok(calls.includes("start-operator"));
  assert.ok(calls.includes("view:central"));
  assert.ok(calls.includes("unmount:driver"));
  await result.workspaceController.openPassengerWorkspace();
  assert.ok(calls.includes("workspace:passenger"));
  assert.ok(calls.includes("mount:passenger"));
  assert.ok(calls.includes("passenger-photo"));
  assert.ok(calls.includes("view:pasajero"));
  assert.ok(calls.includes("resume-passenger"));
  assert.ok(calls.includes("unmount:central"));
  await result.background;
});

test("a stale Central load cannot override a newer driver workspace selection", async () => {
  let finishCentral;
  const calls = [];
  const result = await activateRole("admin", {
    user: { uid: "admin-1" }, role: { role: "admin", carId: "144" },
    loadRoleView: role => role === "central"
      ? new Promise(resolve => { finishCentral = resolve; })
      : Promise.resolve({}),
    unloadRoleView: role => calls.push("unmount:" + role),
    showView: view => calls.push("view:" + view),
    setWorkspaceRole: role => calls.push("workspace:" + role),
    initializeAdminCars: async () => {},
    syncDriverPushRegistration: async () => {},
    listenDriverInbox: () => {},
    restoreDriverActiveTrip: async () => {},
    startDriverGps: () => {},
    processPendingTripAction: async () => {}
  });
  const central = result.workspaceController.openAdminPanel();
  for (let attempt = 0; attempt < 10 && !finishCentral; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(typeof finishCentral, "function", "Central mount should begin before a newer workspace is selected");
  const driver = await result.workspaceController.openDriverWorkspace();
  finishCentral({});
  const staleCentral = await central;
  assert.deepEqual(driver, { view: "inicio" });
  assert.deepEqual(staleCentral, { stale: true });
  assert.equal(calls.includes("view:central"), false);
  await result.background;
});

test("all-roles workspace is one shell that navigates existing modules on demand", async () => {
  const calls = [];
  const result = await activateRole("admin", {
    user: { uid: "admin-1" }, role: { role: "admin", carId: "144" },
    loadRoleView: async role => { calls.push("mount:" + role); return {}; },
    unloadRoleView: role => calls.push("unmount:" + role),
    showView: view => calls.push("view:" + view),
    setWorkspaceRole: role => calls.push("workspace:" + role),
    setAllRolesMode: enabled => calls.push("all-roles:" + enabled),
    stopOperatorPresence: async () => calls.push("stop-operator"),
    startOperatorPresence: () => calls.push("start-operator"),
    suspendDriverWorkspace: () => calls.push("suspend-driver"),
    suspendPassengerWorkspace: () => calls.push("suspend-passenger"),
    setAdminTripAlertPanel: enabled => calls.push("admin-alerts:" + enabled),
    loadPassengerPhoto: async () => true,
    showPassengerOnboarding: () => calls.push("passenger-onboarding"),
    resumePassengerWorkspace: () => calls.push("resume-passenger"),
    initializeAdminCars: async () => {},
    syncDriverPushRegistration: async () => {},
    listenDriverInbox: () => {},
    restoreDriverActiveTrip: async () => {},
    startDriverGps: () => {},
    processPendingTripAction: async () => {}
  });
  const opened = await result.workspaceController.openAllRolesWorkspace();
  assert.deepEqual(opened, { view: "inicio" });
  assert.ok(calls.includes("all-roles:true"));
  assert.ok(calls.includes("workspace:driver"));
  await result.workspaceController.selectAllRole("operator");
  assert.ok(calls.includes("workspace:operator"));
  assert.ok(calls.includes("start-operator"));
  assert.ok(calls.includes("all-roles:true"));
  await result.workspaceController.selectAllRole("passenger");
  assert.ok(calls.includes("workspace:passenger"));
  assert.ok(calls.includes("resume-passenger"));
  await result.workspaceController.selectAllRole("admin");
  assert.ok(calls.includes("workspace:admin"));
  assert.ok(calls.includes("view:central"));
  await result.background;
});
