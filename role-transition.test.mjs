import test from "node:test";
import assert from "node:assert/strict";
import { createRoleTransitionController } from "./role-transition.mjs";

function createDocument() {
  const classes = new Set();
  return {
    classes,
    body: {
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value)
      }
    }
  };
}

test("role transition locks the interface until the matching transition completes", () => {
  const document = createDocument();
  const controller = createRoleTransitionController(document);
  const token = controller.begin();

  assert.equal(document.classes.has("dante-role-transition"), true);
  assert.equal(controller.isCurrent(token), true);
  assert.equal(controller.finish(token), true);
  assert.equal(document.classes.has("dante-role-transition"), false);
});

test("an older auth callback cannot unlock a newer role transition", () => {
  const document = createDocument();
  const controller = createRoleTransitionController(document);
  const oldToken = controller.begin();
  const newToken = controller.begin();

  assert.equal(controller.finish(oldToken), false);
  assert.equal(document.classes.has("dante-role-transition"), true);
  assert.equal(controller.finish(newToken), true);
  assert.equal(document.classes.has("dante-role-transition"), false);
});

test("invalidate cancels pending transition tokens", () => {
  const document = createDocument();
  const controller = createRoleTransitionController(document);
  const token = controller.begin();

  controller.invalidate();

  assert.equal(controller.isCurrent(token), false);
  assert.equal(controller.finish(token), false);
  assert.equal(document.classes.has("dante-role-transition"), false);
});
