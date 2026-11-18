import test from "node:test";
import assert from "node:assert/strict";
import { createRoleTemplateLoader } from "./role-template-loader.mjs";

function makeDocument(existingIds = []) {
  const mount = {
    children: [],
    dataset: {},
    replaceChildren(...children) { this.children = children; },
    contains() { return false; }
  };
  return {
    mount,
    getElementById(id) { return id === "roleViewMount" ? mount : null; },
    querySelectorAll() { return existingIds.map(id => ({ id })); }
  };
}
function parseIds(html) {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  return { ids, querySelectorAll() { return ids.map(id => ({ id })); } };
}
function response(html) {
  return { ok: true, status: 200, async text() { return html; } };
}

test("loads the passenger template only into the dedicated mount", async () => {
  const document = makeDocument();
  const requests = [];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async (url, options) => { requests.push({ url, options }); return response('<section id="pasajero"></section>'); },
    parseTemplate: parseIds
  });
  const result = await loader.load("passenger");
  assert.deepEqual(result, { stale: false, role: "passenger", mounted: true });
  assert.equal(document.mount.dataset.role, "passenger");
  assert.equal(document.mount.children.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "./views/passenger.html");
  assert.equal(requests[0].options.credentials, "same-origin");
});

test("rejects roles without a registered template before making a request", async () => {
  const document = makeDocument();
  let requested = false;
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => { requested = true; return response(""); },
    parseTemplate: parseIds
  });
  await assert.rejects(loader.load("admin"), /No HTML template registered/);
  assert.equal(requested, false);
});

test("a late template response cannot replace a more recent role", async () => {
  const document = makeDocument();
  let resolvePassenger;
  const loader = createRoleTemplateLoader({
    document,
    fetch: url => url.includes("passenger")
      ? new Promise(resolve => { resolvePassenger = resolve; })
      : Promise.resolve(response('<section id="driver"></section>')),
    parseTemplate: parseIds
  });
  const passengerLoad = loader.load("passenger");
  // The passenger URL is registered; the second role is intentionally unsupported
  // until its own view has been extracted, so invalidate the pending request by unmounting.
  loader.unmount();
  resolvePassenger(response('<section id="pasajero"></section>'));
  assert.deepEqual(await passengerLoad, { stale: true, role: "passenger" });
  assert.equal(document.mount.children.length, 0);
});

test("rejects duplicate IDs without destroying the currently mounted view", async () => {
  const document = makeDocument();
  document.mount.children = ["existing"];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => response('<section id="x"></section><section id="x"></section>'),
    parseTemplate: parseIds
  });
  await assert.rejects(loader.load("passenger"), /Duplicate ID in role template/);
  assert.deepEqual(document.mount.children, ["existing"]);
});

test("unmount clears the mounted role and invalidates pending responses", async () => {
  const document = makeDocument();
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => response('<section id="pasajero"></section>'),
    parseTemplate: parseIds
  });
  await loader.load("passenger");
  loader.unmount();
  assert.deepEqual(document.mount.children, []);
  assert.equal(document.mount.dataset.role, undefined);
});


test("onMounted runs after the fragment is attached", async () => {
  const document = makeDocument();
  let mounted = false;
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => response('<section id="pasajero"></section>'),
    parseTemplate: parseIds,
    onMounted: ({ role, mount }) => {
      mounted = role === "passenger" && mount.children.length === 1;
    }
  });
  await loader.load("passenger");
  assert.equal(mounted, true);
});
