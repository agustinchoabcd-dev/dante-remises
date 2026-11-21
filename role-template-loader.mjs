const ROLE_TEMPLATE_URLS = Object.freeze({ auth: "./views/auth.html", passenger: "./views/passenger.html", driver: "./views/driver.html", central: "./views/central.html" });
const ROLE_TEMPLATE_MOUNTS = Object.freeze({ auth: "authViewMount", passenger: "roleViewMount", driver: "roleViewMount", central: "centralViewMount" });

export function createRoleTemplateLoader({ document: documentRef = globalThis.document, fetch: fetchImpl = globalThis.fetch, mountId = "roleViewMount", parseTemplate, onMounted = () => {} } = {}) {
  if (!documentRef?.getElementById || typeof fetchImpl !== "function") throw new TypeError("A document and fetch implementation are required");
  const defaultMount = documentRef.getElementById(mountId);
  if (!defaultMount?.replaceChildren) throw new TypeError("Role view mount point is missing");
  const parse = parseTemplate || (html => { const template = documentRef.createElement("template"); template.innerHTML = html; return template.content.cloneNode(true); });
  const generations = new Map(), pendingRoles = new Map(), sourceCache = new Map(), sourceLoads = new Map();

  function getSource(role) {
    if (sourceCache.has(role)) return Promise.resolve(sourceCache.get(role));
    let pending = sourceLoads.get(role);
    if (!pending) {
      const url = ROLE_TEMPLATE_URLS[role];
      pending = (async () => {
        const response = await fetchImpl(url, { method: "GET", credentials: "same-origin" });
        if (!response?.ok) throw new Error("Could not load role template (" + role + "): HTTP " + (response?.status ?? "unknown"));
        const source = await response.text();
        sourceCache.set(role, source);
        return source;
      })();
      sourceLoads.set(role, pending);
      pending.then(
        () => { if (sourceLoads.get(role) === pending) sourceLoads.delete(role); },
        () => { if (sourceLoads.get(role) === pending) sourceLoads.delete(role); }
      );
    }
    return pending;
  }
  async function preload(role) {
    if (!ROLE_TEMPLATE_URLS[role]) throw new Error("No HTML template registered for role: " + String(role));
    await getSource(role);
    return { role, preloaded: true };
  }
  function getMount(role) {
    const targetId = ROLE_TEMPLATE_MOUNTS[role] || mountId;
    const mount = documentRef.getElementById(targetId);
    if (!mount?.replaceChildren) throw new TypeError("Role view mount point is missing: " + targetId);
    return { mount, targetId };
  }
  function assertNoDuplicateIds(fragment, mount) {
    if (!fragment?.querySelectorAll) throw new TypeError("A parsed role template must be a DOM fragment");
    const incoming = [...fragment.querySelectorAll("[id]")].map(element => element.id).filter(Boolean), seen = new Set();
    for (const id of incoming) { if (seen.has(id)) throw new Error("Duplicate ID in role template: " + id); seen.add(id); }
    for (const element of documentRef.querySelectorAll?.("[id]") || []) {
      if (!mount.contains?.(element) && seen.has(element.id)) throw new Error("Role template ID already exists outside its mount: " + element.id);
    }
  }
  function clearPendingRole(mount, targetId, role) {
    if (pendingRoles.get(targetId) !== role) return;
    pendingRoles.delete(targetId);
    if (mount.dataset?.pendingRole === role) delete mount.dataset.pendingRole;
  }
  async function load(role) {
    const url = ROLE_TEMPLATE_URLS[role];
    if (!url) throw new Error("No HTML template registered for role: " + String(role));
    const { mount, targetId } = getMount(role);
    const requestGeneration = (generations.get(targetId) || 0) + 1;
    generations.set(targetId, requestGeneration); pendingRoles.set(targetId, role);
    if (mount.dataset) mount.dataset.pendingRole = role;
    try {
      const source = await getSource(role);
      const fragment = parse(source, documentRef);
      assertNoDuplicateIds(fragment, mount);
      if (requestGeneration !== generations.get(targetId)) { clearPendingRole(mount, targetId, role); return { stale: true, role }; }
      mount.replaceChildren(fragment);
      if (mount.dataset) { mount.dataset.role = role; delete mount.dataset.pendingRole; }
      clearPendingRole(mount, targetId, role);
      onMounted({ role, mount });
      return { stale: false, role, mounted: true };
    } catch (error) {
      if (requestGeneration === generations.get(targetId)) clearPendingRole(mount, targetId, role);
      throw error;
    }
  }
  function unload(role) {
    const { mount, targetId } = getMount(role);
    const activeRole = mount.dataset?.role, pendingRole = pendingRoles.get(targetId);
    if (activeRole !== role && pendingRole !== role) return false;
    generations.set(targetId, (generations.get(targetId) || 0) + 1);
    clearPendingRole(mount, targetId, role);
    if (activeRole === role) { mount.replaceChildren(); if (mount.dataset) delete mount.dataset.role; }
    return true;
  }
  function unloadMount(role) {
    const { mount, targetId } = getMount(role);
    generations.set(targetId, (generations.get(targetId) || 0) + 1);
    pendingRoles.delete(targetId); mount.replaceChildren();
    if (mount.dataset) { delete mount.dataset.role; delete mount.dataset.pendingRole; }
    return true;
  }
  function unmount() {
    for (const targetId of new Set([mountId, ...Object.values(ROLE_TEMPLATE_MOUNTS)])) {
      generations.set(targetId, (generations.get(targetId) || 0) + 1); pendingRoles.delete(targetId);
      const mount = documentRef.getElementById(targetId);
      if (!mount?.replaceChildren) continue;
      mount.replaceChildren();
      if (mount.dataset) { delete mount.dataset.role; delete mount.dataset.pendingRole; }
    }
  }
  return Object.freeze({ load, preload, unload, unloadMount, unmount });
}
export const roleTemplateUrls = ROLE_TEMPLATE_URLS;
