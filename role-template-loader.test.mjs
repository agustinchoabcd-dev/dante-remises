import test from "node:test";
import assert from "node:assert/strict";
import { createRoleTemplateLoader } from "./role-template-loader.mjs";

function makeDocument(existingIds = []) {
  const mounts = Object.fromEntries(["roleViewMount", "centralViewMount", "authViewMount"].map(id => [id, {
    children: [],
    dataset: {},
    replaceChildren(...children) { this.children = children; },
    contains(element) { return this.children.some(child => child.ids?.includes(element.id)); }
  }]));
  return {
    mount: mounts.roleViewMount,
    mounts,
    getElementById(id) { return mounts[id] || null; },
    querySelectorAll() {
      const mounted = Object.values(mounts).flatMap(mount => mount.children.flatMap(child => (child.ids || []).map(id => ({ id }))));
      return [...existingIds.map(id => ({ id })), ...mounted];
    }
  };
}
function parseIds(html) {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  return { ids, querySelectorAll() { return ids.map(id => ({ id })); } };
}
function response(html) {
  return { ok: true, status: 200, async text() { return html; } };
}

test("loads passenger and driver templates into the shared role mount", async () => {
  const document = makeDocument();
  const requests = [];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async (url, options) => { requests.push({ url, options }); return response('<section id="role-' + requests.length + '"></section>'); },
    parseTemplate: parseIds
  });
  const passenger = await loader.load("passenger");
  assert.deepEqual(passenger, { stale: false, role: "passenger", mounted: true });
  assert.equal(document.mount.dataset.role, "passenger");
  assert.equal(requests[0].url, "./views/passenger.html");
  const driver = await loader.load("driver");
  assert.deepEqual(driver, { stale: false, role: "driver", mounted: true });
  assert.equal(document.mount.dataset.role, "driver");
  assert.equal(requests[1].url, "./views/driver.html");
});

test("loads Central into its own mount independently from the driver workspace", async () => {
  const document = makeDocument();
  const requests = [];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async url => { requests.push(url); return response('<div id="' + (url.includes("central") ? "centralCars" : "driverStatus") + '"></div>'); },
    parseTemplate: parseIds
  });
  const central = await loader.load("central");
  const driver = await loader.load("driver");
  assert.deepEqual(central, { stale: false, role: "central", mounted: true });
  assert.deepEqual(driver, { stale: false, role: "driver", mounted: true });
  assert.equal(document.mounts.centralViewMount.dataset.role, "central");
  assert.equal(document.mounts.roleViewMount.dataset.role, "driver");
  assert.equal(requests.length, 2);
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

test("late responses are invalidated independently for each mount", async () => {
  const document = makeDocument();
  let resolvePassenger;
  const loader = createRoleTemplateLoader({
    document,
    fetch: url => url.includes("passenger")
      ? new Promise(resolve => { resolvePassenger = resolve; })
      : Promise.resolve(response('<section id="central"></section>')),
    parseTemplate: parseIds
  });
  const passengerLoad = loader.load("passenger");
  await loader.load("central");
  loader.unmount();
  resolvePassenger(response('<section id="pasajero"></section>'));
  assert.deepEqual(await passengerLoad, { stale: true, role: "passenger" });
  assert.equal(document.mounts.roleViewMount.children.length, 0);
  assert.equal(document.mounts.centralViewMount.children.length, 0);
});

test("rejects duplicate IDs without destroying the currently mounted view", async () => {
  const document = makeDocument();
  document.mount.children = [{ ids: ["existing"] }];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => response('<section id="x"></section><section id="x"></section>'),
    parseTemplate: parseIds
  });
  await assert.rejects(loader.load("passenger"), /Duplicate ID in role template/);
  assert.deepEqual(document.mount.children, [{ ids: ["existing"] }]);
});

test("rejects IDs already mounted in a different role workspace", async () => {
  const document = makeDocument();
  document.mounts.centralViewMount.children = [{ ids: ["shared-id"] }];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => response('<section id="shared-id"></section>'),
    parseTemplate: parseIds
  });
  await assert.rejects(loader.load("passenger"), /already exists outside its mount/);
});

test("unload clears only the selected workspace mount", async () => {
  const document = makeDocument();
  const loader = createRoleTemplateLoader({
    document,
    fetch: async url => response('<section id="' + (url.includes("central") ? "central" : "driver") + '"></section>'),
    parseTemplate: parseIds
  });
  await loader.load("driver");
  await loader.load("central");
  assert.equal(loader.unload("central"), true);
  assert.equal(document.mounts.centralViewMount.children.length, 0);
  assert.equal(document.mounts.centralViewMount.dataset.role, undefined);
  assert.equal(document.mounts.roleViewMount.dataset.role, "driver");
  assert.equal(document.mounts.roleViewMount.children.length, 1);
});

test("unloading an inactive sibling role never clears the active shared template", async () => {
  const document = makeDocument();
  const loader = createRoleTemplateLoader({
    document,
    fetch: async url => response('<section id="' + (url.includes("passenger") ? "pasajero" : "driver") + '"></section>'),
    parseTemplate: parseIds
  });
  await loader.load("driver");
  assert.equal(loader.unload("passenger"), false);
  assert.equal(document.mounts.roleViewMount.dataset.role, "driver");
  assert.equal(document.mounts.roleViewMount.children.length, 1);
  await loader.load("passenger");
  assert.equal(loader.unload("driver"), false);
  assert.equal(document.mounts.roleViewMount.dataset.role, "passenger");
  assert.equal(document.mounts.roleViewMount.children.length, 1);
});

test("unloading a shared mount invalidates every pending role request without touching Central", async () => {
  const document = makeDocument();
  let resolvePassenger;
  const loader = createRoleTemplateLoader({
    document,
    fetch: url => url.includes("passenger")
      ? new Promise(resolve => { resolvePassenger = resolve; })
      : Promise.resolve(response('<section id="central"></section>')),
    parseTemplate: parseIds
  });
  const passengerLoad = loader.load("passenger");
  await loader.load("central");
  loader.unloadMount("driver");
  resolvePassenger(response('<section id="pasajero"></section>'));
  assert.deepEqual(await passengerLoad, { stale: true, role: "passenger" });
  assert.equal(document.mounts.roleViewMount.children.length, 0);
  assert.equal(document.mounts.centralViewMount.dataset.role, "central");
  assert.equal(document.mounts.centralViewMount.children.length, 1);
});

test("admin workspace swap releases the inactive template and remounts it on return", async () => {
  const document = makeDocument();
  const loader = createRoleTemplateLoader({
    document,
    fetch: async url => response('<section id="' + (url.includes("central") ? "central" : url.includes("driver") ? "driver" : "passenger") + '"></section>'),
    parseTemplate: parseIds
  });
  await loader.load("driver");
  await loader.load("central");
  loader.unloadMount("driver");
  assert.equal(document.mounts.roleViewMount.children.length, 0);
  assert.equal(document.mounts.centralViewMount.children.length, 1);
  loader.unload("central");
  await loader.load("driver");
  assert.equal(document.mounts.centralViewMount.children.length, 0);
  assert.equal(document.mounts.roleViewMount.dataset.role, "driver");
  assert.equal(document.mounts.roleViewMount.children.length, 1);
});

test("unmount clears every role mount and invalidates pending responses", async () => {
  const document = makeDocument();
  const loader = createRoleTemplateLoader({
    document,
    fetch: async url => response('<section id="' + (url.includes("central") ? "central" : "pasajero") + '"></section>'),
    parseTemplate: parseIds
  });
  await loader.load("passenger");
  await loader.load("central");
  loader.unmount();
  assert.deepEqual(document.mounts.roleViewMount.children, []);
  assert.deepEqual(document.mounts.centralViewMount.children, []);
  assert.equal(document.mounts.roleViewMount.dataset.role, undefined);
  assert.equal(document.mounts.centralViewMount.dataset.role, undefined);
});

test("onMounted runs after the fragment is attached", async () => {
  const document = makeDocument();
  let mounted = false;
  const loader = createRoleTemplateLoader({
    document,
    fetch: async () => response('<section id="pasajero"></section>'),
    parseTemplate: parseIds,
    onMounted: ({ role, mount }) => { mounted = role === "passenger" && mount.children.length === 1; }
  });
  await loader.load("passenger");
  assert.equal(mounted, true);
});

test("authentication template mounts separately from passenger, driver and Central workspaces", async () => {
  const document = makeDocument();
  const requests = [];
  const loader = createRoleTemplateLoader({
    document,
    fetch: async url => {
      requests.push(url);
      return response('<section id="' + (url.includes("auth") ? "acceso" : "driverView") + '"></section>');
    },
    parseTemplate: parseIds
  });
  await loader.load("driver");
  await loader.load("auth");
  assert.equal(document.mounts.roleViewMount.dataset.role, "driver");
  assert.equal(document.mounts.authViewMount.dataset.role, "auth");
  assert.deepEqual(requests, ["./views/driver.html", "./views/auth.html"]);
});

test("preloads only the selected role template and shares its request with mount", async()=>{
 const document=makeDocument();const requests=[];
 let release;
 const loader=createRoleTemplateLoader({
  document,
  fetch:async url=>{requests.push(url);await new Promise(resolve=>{release=resolve});return response('<section id="driver"></section>')},
  parseTemplate:parseIds
 });
 const preload=loader.preload("driver");
 const mount=loader.load("driver");
 await Promise.resolve();
 assert.deepEqual(requests,["./views/driver.html"]);
 release();
 assert.deepEqual(await preload,{role:"driver",preloaded:true});
 assert.deepEqual(await mount,{stale:false,role:"driver",mounted:true});
 assert.equal(document.mount.dataset.role,"driver");
 assert.equal(requests.length,1);
});
