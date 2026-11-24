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
  let generation = 0, activeSection = "", disposed = false;
  const document = root.ownerDocument;
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
  const menu = root.querySelector("#adminMenuPanel");
  const menuToggle = root.querySelector("#adminMenuToggle");
  const menuClose = root.querySelector("#adminMenuClose");
  const backdrop = root.querySelector("[data-admin-menu-backdrop]");
  if (!nav || !content || !title || !menu || !menuToggle || !menuClose || !backdrop) {
    throw new Error("La estructura del panel administrativo está incompleta");
  }

  function closeMenu(restoreFocus = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    backdrop.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && !disposed) menuToggle.focus();
  }

  function openMenu() {
    if (disposed || !menu.hidden) return;
    menu.hidden = false;
    backdrop.hidden = false;
    menuToggle.setAttribute("aria-expanded", "true");
    menuClose.focus();
  }

  function onMenuToggle() {
    if (menu.hidden) openMenu();
    else closeMenu();
  }
  function onMenuClose() { closeMenu(); }
  function onBackdropClick() { closeMenu(); }
  function onMenuKeydown(event) {
    if (menu.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...menu.querySelectorAll('button:not(:disabled):not([hidden])')];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  let activeModule = null, activeModuleContext = null, activeCleanup = null;
  async function openSection(section) {
    if (!SECTION_FILES[section] || disposed || (context.isCurrent && !context.isCurrent())) return false;
    const request = ++generation;
    const previousModule = activeModule;
    const previousContext = activeModuleContext;
    const previousCleanup = activeCleanup;
    activeModule = null;
    activeModuleContext = null;
    activeCleanup = null;
    if (previousModule?.unmount) {
      try { await previousModule.unmount(previousContext); }
      catch (error) { console.warn("No se pudo desmontar la sección administrativa:", error); }
    }
    if (disposed || request !== generation || (context.isCurrent && !context.isCurrent())) return false;
    if (previousCleanup) {
      try { await previousCleanup(); }
      catch (error) { console.warn("No se pudo liberar la sección administrativa:", error); }
    }
    if (disposed || request !== generation || (context.isCurrent && !context.isCurrent())) return false;

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
    closeMenu();
    void openSection(button.dataset.adminSection);
  };
  nav.addEventListener("click", onNavigation);
  menuToggle.addEventListener("click", onMenuToggle);
  menuClose.addEventListener("click", onMenuClose);
  backdrop.addEventListener("click", onBackdropClick);
  menu.addEventListener("keydown", onMenuKeydown);

  const controller = Object.freeze({
    openSection,
    get activeSection() { return activeSection; },
    async unmount() {
      if (disposed) return;
      disposed = true;
      generation++;
      nav.removeEventListener("click", onNavigation);
      menuToggle.removeEventListener("click", onMenuToggle);
      menuClose.removeEventListener("click", onMenuClose);
      backdrop.removeEventListener("click", onBackdropClick);
      menu.removeEventListener("keydown", onMenuKeydown);
      menu.hidden = true;
      backdrop.hidden = true;
      menuToggle.setAttribute("aria-expanded", "false");
      const previousModule = activeModule;
      const previousContext = activeModuleContext;
      const previousCleanup = activeCleanup;
      activeModule = null;
      activeModuleContext = null;
      activeCleanup = null;
      try { await previousModule?.unmount?.(previousContext); if (previousCleanup) await previousCleanup(); }
      catch (error) { console.warn("No se pudo desmontar el panel administrativo:", error); }
      root.replaceChildren();
    }
  });
  await openSection("overview");
  return controller;
}
