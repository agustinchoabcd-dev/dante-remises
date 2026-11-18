const ROLE_TEMPLATE_URLS = Object.freeze({
  passenger: "./views/passenger.html"
});

/**
 * Loads a role's HTML into the single application mount point.
 * Templates are fetched only after authentication resolves the role.
 * The caller owns authorization and must call unmount() on session changes.
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
  const mount = documentRef.getElementById(mountId);
  if (!mount?.replaceChildren) throw new TypeError("Role view mount point is missing");

  const parse = parseTemplate || (html => {
    const template = documentRef.createElement("template");
    template.innerHTML = html;
    return template.content.cloneNode(true);
  });

  let generation = 0;
  const sourceCache = new Map();

  function assertNoDuplicateIds(fragment) {
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
    const requestGeneration = ++generation;
    let source = sourceCache.get(role);
    if (source === undefined) {
      const response = await fetchImpl(url, { method: "GET", credentials: "same-origin" });
      if (!response?.ok) throw new Error("Could not load role template (" + role + "): HTTP " + (response?.status ?? "unknown"));
      source = await response.text();
      sourceCache.set(role, source);
    }
    const fragment = parse(source, documentRef);
    assertNoDuplicateIds(fragment);
    if (requestGeneration !== generation) return { stale: true, role };
    mount.replaceChildren(fragment);
    if (mount.dataset) mount.dataset.role = role;
    onMounted({ role, mount });
    return { stale: false, role, mounted: true };
  }

  function unmount() {
    generation += 1;
    mount.replaceChildren();
    if (mount.dataset) delete mount.dataset.role;
  }

  return Object.freeze({ load, unmount });
}

export const roleTemplateUrls = ROLE_TEMPLATE_URLS;
