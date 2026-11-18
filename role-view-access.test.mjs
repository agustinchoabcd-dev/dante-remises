import test from "node:test";
import assert from "node:assert/strict";
import { canAccessRoleView } from "./role-view-access.mjs";

test("each role can access only its own workspace and shared screens", () => {
  const allowed = {
    passenger: ["pasajero", "chat", "configuracion"],
    driver: ["chofer", "chat", "configuracion"],
    operator: ["central", "chat", "configuracion"],
    admin: ["central", "chofer", "chat", "configuracion"]
  };
  const allViews = ["pasajero", "chofer", "central", "chat", "configuracion"];

  for (const role of Object.keys(allowed)) {
    for (const view of allViews) {
      assert.equal(canAccessRoleView(role, view), allowed[role].includes(view), role + " access to " + view);
    }
  }
});

test("unknown roles and unknown views are denied by default", () => {
  assert.equal(canAccessRoleView("unknown", "central"), false);
  assert.equal(canAccessRoleView("passenger", "admin"), false);
  assert.equal(canAccessRoleView(null, "pasajero"), false);
});
