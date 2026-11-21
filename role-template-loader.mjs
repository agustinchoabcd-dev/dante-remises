const ROLE_TEMPLATE_URLS = Object.freeze({
  passenger: "./views/passenger.html",
  driver: "./views/driver.html",
  central: "./views/central.html"
});
const ROLE_TEMPLATE_MOUNTS = Object.freeze({
  passenger: "roleViewMount",
  driver: "roleViewMount",
  central: "centralViewMount"
});

/**
 * Passenger and driver share the main role mount. Central has a separate
 * mount so Admin can keep Central and the car-144 driver workspace together.
 */
export function createRoleTemplateLoader({
  document: documentRef = globalThis.document,
  fetch: fetchImpl = globalThis.fetch,
  mountId = "roleViewMount",
  parseTemplate,
  onMounted = () => {}
} = {}) {
  if (!documentRef?.getElementById || typeof fetchImpl !== "function") {
    throw new TypeError("A document and fetch implementation are required");
  }
  const defaultMount = documentRef.getElementById(mountId);
  if (!defaultMount?.replaceChildren) throw new TypeError("Role view mount point is missing");

  const parse = parseTemplate || (html => {
    const template = documentRef.createElement("template");
    template.innerHTML = html;
    return template.content.cloneNode(true);
  });
  const generations = new Map();
  const sourceCache = new Map();

  function getMount(role) {
    const targetId = ROLE_TEMPLATE_MOUNTS[role] || mountId;
    const mount = documentRef.getElementById(targetId);
    if (!mount?.replaceChildren) throw new TypeError("Role view mount point is missing: " + targetId);
    return { mount, targetId };
  }

  function assertNoDuplicateIds(fragment, mount) {
    if (!fragment?.querySelectorAll) throw new TypeError("A parsed role template must be a DOM fragment");
    const incoming = [...fragment.querySelectorAll("[id]")].map(element => element.id).filter(Boolean);
    const seen = new Set();
    for (const id of incoming) {
      if (seen.has(id)) throw new Error("Duplicate ID in role template: " + id);
      seen.add(id);
    }
    for (const element of documentRef.querySelectorAll?.("[id]") || []) {
      if (!mount.contains?.(element) && seen.has(element.id)) {
        throw new Error("Role template ID already exists outside its mount: " + element.id);
      }
    }
  }

  async function load(role) {
    const url = ROLE_TEMPLATE_URLS[role];
    if (!url) throw new Error("No HTML template registered for role: " + String(role));
    const { mount, targetId } = getMount(role);
    const requestGeneration = (generations.get(targetId) || 0) + 1;
    generations.set(targetId, requestGeneration);
    let source = sourceCache.get(role);
    if (source === undefined) {
      const response = await fetchImpl(url, { method: "GET", credentials: "same-origin" });
      if (!response?.ok) throw new Error("Could not load role template (" + role + "): HTTP " + (response?.status ?? "unknown"));
      source = await response.text();
      sourceCache.set(role, source);
    }
    const fragment = parse(source, documentRef);
    assertNoDuplicateIds(fragment, mount);
    if (requestGeneration !== generations.get(targetId)) return { stale: true, role };
    mount.replaceChildren(fragment);
    if (mount.dataset) mount.dataset.role = role;
    onMounted({ role, mount });
    return { stale: false, role, mounted: true };
  }

  function unload(role) {
    const targetId = ROLE_TEMPLATE_MOUNTS[role] || mountId;
    generations.set(targetId, (generations.get(targetId) || 0) + 1);
    const mount = documentRef.getElementById(targetId);
    if (!mount?.replaceChildren) return false;
    mount.replaceChildren();
    if (mount.dataset) delete mount.dataset.role;
    return true;
  }

  function unmount() {
    for (const targetId of new Set([mountId, ...Object.values(ROLE_TEMPLATE_MOUNTS)])) {
      generations.set(targetId, (generations.get(targetId) || 0) + 1);
      const mount = documentRef.getElementById(targetId);
      if (!mount?.replaceChildren) continue;
      mount.replaceChildren();
      if (mount.dataset) delete mount.dataset.role;
    }
  }
  return Object.freeze({ load, unload, unmount });
}
export const roleTemplateUrls = ROLE_TEMPLATE_URLS;
