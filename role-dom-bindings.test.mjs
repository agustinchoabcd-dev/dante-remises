import test from "node:test";
import assert from "node:assert/strict";
import { createRoleDomBindings } from "./role-dom-bindings.mjs";

function fakeElement() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(event, handler, options) {
      const entries = listeners.get(event) || [];
      entries.push({ handler, options });
      listeners.set(event, entries);
    },
    removeEventListener(event, handler) {
      listeners.set(event, (listeners.get(event) || []).filter(entry => entry.handler !== handler));
    }
  };
}
function fakeDocument() {
  const elements = new Map();
  return {
    elements,
    getElementById(id) { return elements.get(id) || null; },
    mount(id) { const element = fakeElement(); elements.set(id, element); return element; },
    unmount(id) { elements.delete(id); }
  };
}

test("bind attaches immediately when the current HTML element exists", () => {
  const document = fakeDocument();
  const button = document.mount("loginButton");
  const handler = () => {};
  const { bind } = createRoleDomBindings(document);
  bind("loginButton", "click", handler);
  assert.equal(button.listeners.get("click")?.[0]?.handler, handler);
});

test("bind queues missing elements and flush attaches them after template mount", () => {
  const document = fakeDocument();
  const { bind, flush } = createRoleDomBindings(document);
  const handler = () => {};
  bind("passengerCars", "click", handler);
  assert.equal(flush(), 0);
  const cars = document.mount("passengerCars");
  assert.equal(flush(), 1);
  assert.equal(cars.listeners.get("click")?.[0]?.handler, handler);
});

test("repeated flush does not duplicate listeners on the same element", () => {
  const document = fakeDocument();
  const { bind, flush } = createRoleDomBindings(document);
  const handler = () => {};
  bind("chatForm", "submit", handler);
  document.mount("chatForm");
  assert.equal(flush(), 1);
  assert.equal(flush(), 0);
  assert.equal(document.elements.get("chatForm").listeners.get("submit").length, 1);
});

test("a newly mounted replacement element receives the same registered handler", () => {
  const document = fakeDocument();
  const { bind, flush } = createRoleDomBindings(document);
  const handler = () => {};
  bind("setBusy", "click", handler);
  const first = document.mount("setBusy");
  flush();
  document.unmount("setBusy");
  const second = document.mount("setBusy");
  assert.equal(flush(), 1);
  assert.equal(first.listeners.get("click").length, 1);
  assert.equal(second.listeners.get("click").length, 1);
});

test("unbind removes the registration and current listener", () => {
  const document = fakeDocument();
  const button = document.mount("logoutButton");
  const { bind, flush } = createRoleDomBindings(document);
  const handler = () => {};
  const unbind = bind("logoutButton", "click", handler);
  assert.equal(button.listeners.get("click").length, 1);
  unbind();
  assert.equal(button.listeners.get("click").length, 0);
  document.unmount("logoutButton");
  document.mount("logoutButton");
  assert.equal(flush(), 0);
});
