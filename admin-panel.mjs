const SECTION_FILES = Object.freeze({
  overview: "./views/admin/overview.html",
  fleet: "./views/admin/fleet.html",
  trips: "./views/admin/trips.html",
  passengers: "./views/admin/passengers.html",
  health: "./views/admin/health.html"
});
const SECTION_MODULES = Object.freeze({
  overview: () => import("./admin/sections/overview.mjs"),
  fleet: () => import("./admin/sections/fleet.mjs"),
  trips: () => import("./admin/sections/trips.mjs"),
  passengers: () => import("./admin/sections/passengers.mjs"),
  health: () => import("./admin/sections/health.mjs")
});
const LABELS = Object.freeze({
  overview: "Resumen", fleet: "Flota", trips: "Viajes",
  passengers: "Pasajeros", health: "Salud operativa"
});

export async function mount(root, context = {}) {
  if (!root?.replaceChildren) throw new TypeError("Admin panel mount point is required");
  const fetchImpl = context.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("Admin panel requires fetch");
  let generation = 0, activeSection = "", activeModule = null, activeModuleContext = null, activeCleanup = null, disposed = false;
  const shellResponse = await fetchImpl("./views/admin/shell.html", { credentials: "same-origin" });
  if (!shellResponse?.ok) throw new Error("No se pudo cargar el panel administrativo");
  const shell = await shellResponse.text();
  if (disposed || (context.isCurrent && !context.isCurrent())) return { stale: true };
  root.innerHTML = shell;
  context.flushRoleDomBindings?.();
  const nav = root.querySelector("[data-admin-nav]");
  const content = root.querySelector("[data-admin-content]");
  const title = root.querySelector("[data-admin-title]");
  const status = root.querySelector("[data-admin-status]");
  if (!nav || !content || !title) throw new Error("La estructura del panel administrativo está incompleta");

  async function openSection(section) {
    if (!SECTION_FILES[section] || disposed || (context.isCurrent && !context.isCurrent())) return false;
    const request = ++generation;
    if (activeModule?.unmount) {
      try { await activeModule.unmount(activeModuleContext); } catch (error) { console.warn("No se pudo desmontar la sección administrativa:", error); }
    }
    if (activeCleanup) { try { await activeCleanup(); } catch (error) { console.warn("No se pudo liberar la sección administrativa:", error); } }
    activeModule = null; activeModuleContext = null; activeCleanup = null;
    activeSection = section;
    nav.querySelectorAll("[data-admin-section]").forEach(button => {
      const selected = button.dataset.adminSection === section;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    title.textContent = LABELS[section];
    if (status) status.textContent = "Cargando sección…";
    content.replaceChildren();
    try {
      const [response, module] = await Promise.all([
        fetchImpl(SECTION_FILES[section], { credentials: "same-origin" }),
        SECTION_MODULES[section]()
      ]);
      if (!response?.ok) throw new Error("HTTP " + (response?.status ?? "desconocido"));
      const markup = await response.text();
      if (disposed || request !== generation || (context.isCurrent && !context.isCurrent())) return false;
      const template = root.ownerDocument.createElement("template");
      template.innerHTML = markup;
      content.replaceChildren(template.content.cloneNode(true));
      context.flushRoleDomBindings?.();
      activeModule = module;
      activeModuleContext = { ...context, root: content, section, openSection };
      const mountedSection = await module.mount?.(activeModuleContext);
      activeCleanup = typeof mountedSection === "function" ? mountedSection : (typeof mountedSection?.unmount === "function" ? () => mountedSection.unmount() : null);
      if (disposed || request !== generation || (context.isCurrent && !context.isCurrent())) return false;
      if (status) status.textContent = "Módulo activo · " + LABELS[section];
      return true;
    } catch (error) {
      if (request !== generation || disposed) return false;
      content.textContent = "No se pudo cargar esta sección. Podés volver a intentarlo.";
      if (status) status.textContent = "Error de carga";
      console.error("Admin section load failed:", section, error);
      return false;
    }
  }

  const onNavigation = event => {
    const button = event.target.closest?.("[data-admin-section]");
    if (!button || !nav.contains(button)) return;
    void openSection(button.dataset.adminSection);
  };
  nav.addEventListener("click", onNavigation);
  const controller = Object.freeze({
    openSection,
    get activeSection() { return activeSection; },
    async unmount() {
      if (disposed) return;
      disposed = true;
      generation++;
      nav.removeEventListener("click", onNavigation);
      try { await activeModule?.unmount?.(activeModuleContext); if (activeCleanup) await activeCleanup(); } catch (error) { console.warn(error); }
      activeModule = null; activeModuleContext = null; activeCleanup = null;
      root.replaceChildren();
    }
  });
  await openSection("overview");
  return controller;
}
