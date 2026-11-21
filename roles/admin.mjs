export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  // La identidad autenticada sigue siendo admin; el primer workspace es chófer.
  const driverMounted = await context.loadRoleView("driver");
  if (driverMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };

  context.showView("inicio");

  const isCurrent = () => !context.isCurrent || context.isCurrent();
  const workspaceController = Object.freeze({
    async openAdminPanel() {
      if (!isCurrent()) return { stale: true };
      const mounted = await context.loadRoleView("central");
      if (mounted?.stale || !isCurrent()) return { stale: true };
      context.setAdminTripAlertPanel(true);
      await context.loadAdminProfiles();
      if (!isCurrent()) return { stale: true };
      context.showView("central");
      return { view: "central" };
    },
    openDriverWorkspace() {
      if (!isCurrent()) return { stale: true };
      context.showView("inicio");
      context.unloadRoleView("central");
      return { view: "inicio" };
    }
  });

  const background = (async () => {
    const driverModule = await import("./driver.mjs");
    if (!isCurrent()) return;
    const results = await Promise.allSettled([
      context.initializeAdminCars(),
      driverModule.activateDriverOperations(context)
    ]);
    for (const result of results) {
      if (result.status === "rejected") console.error("No se pudo completar una tarea secundaria del administrador:", result.reason);
    }
  })();

  return { view: "inicio", background, workspaceController };
}
