import test from "node:test";
import assert from "node:assert/strict";
import { applyRoleView, canAccessRoleView, hideRoleViews } from "./role-view-access.mjs";

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : Boolean(force);
    if (shouldAdd) this.values.add(value);
    else this.values.delete(value);
    return shouldAdd;
  }
}
function createElement(view = null) { return { classList: new FakeClassList(), dataset: view ? { view } : {} }; }
function createDocument() {
  const ids = ["pasajero", "inicio", "chofer", "central", "chat", "configuracion", "passengerOnboarding"];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const tabs = ["pasajero", "inicio", "chofer", "central", "chat"].map(view => createElement(view));
  return { getElementById(id) { return elements[id] || null; }, querySelectorAll(selector) { return selector === ".tab" ? tabs : []; }, elements, tabs };
}
const allowed = {
  passenger: ["pasajero", "passengerOnboarding", "chat", "configuracion"],
  driver: ["inicio", "chofer", "chat", "configuracion"],
  operator: ["central", "chat", "configuracion"],
  admin: ["central", "chofer", "chat", "configuracion"]
};
test("each role can access only its own workspace and shared screens", () => {
  const allViews = ["pasajero", "passengerOnboarding", "inicio", "chofer", "central", "chat", "configuracion"];
  for (const role of Object.keys(allowed)) for (const view of allViews) assert.equal(canAccessRoleView(role, view), allowed[role].includes(view));
});
test("unknown roles and unknown views are denied by default", () => {
  assert.equal(canAccessRoleView("unknown", "central"), false);
  assert.equal(canAccessRoleView("passenger", "admin"), false);
  assert.equal(canAccessRoleView(null, "pasajero"), false);
});
test("authentication reset hides every role view and navigation tab", () => {
  const doc = createDocument();
  for (const element of Object.values(doc.elements)) element.classList.remove("hidden");
  for (const tab of doc.tabs) tab.classList.remove("hidden");
  hideRoleViews(doc);
  for (const [id, element] of Object.entries(doc.elements)) assert.equal(element.classList.contains("hidden"), true, id);
  for (const tab of doc.tabs) {
    assert.equal(tab.classList.contains("hidden"), true);
    assert.equal(tab.classList.contains("active"), false);
  }
});
test("activating a role view leaves exactly one workspace visible", () => {
  for (const [role, views] of Object.entries(allowed)) for (const view of views) {
    const doc = createDocument();
    assert.equal(applyRoleView(doc, role, view), true);
    for (const [id, element] of Object.entries(doc.elements)) assert.equal(element.classList.contains("hidden"), id !== view, role + " / " + id);
    for (const tab of doc.tabs) {
      assert.equal(tab.classList.contains("hidden"), !views.includes(tab.dataset.view));
      assert.equal(tab.classList.contains("active"), tab.dataset.view === view);
    }
  }
});
test("an unauthorized view cannot be activated", () => {
  const doc = createDocument();
  assert.equal(applyRoleView(doc, "passenger", "central"), false);
  assert.equal(doc.elements.central.classList.contains("hidden"), false);
  assert.equal(doc.elements.pasajero.classList.contains("hidden"), false);
});

test("missing role templates are tolerated, but a missing target view is not activated", () => {
  const partial = {
    getElementById(id) {
      return id === "pasajero" ? createElement() : null;
    },
    querySelectorAll() { return []; }
  };
  assert.doesNotThrow(() => hideRoleViews(partial));
  assert.equal(applyRoleView(partial, "passenger", "pasajero"), true);
  assert.equal(applyRoleView(partial, "passenger", "central"), false);
  assert.equal(applyRoleView(partial, "driver", "chofer"), false);
});
