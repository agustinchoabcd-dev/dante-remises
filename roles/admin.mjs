export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  // La identidad autenticada sigue siendo admin; el primer workspace es chófer.
  const driverMounted = await context.loadRoleView("driver");
  if (driverMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };

  context.showView("inicio");

  const isCurrent = () => !context.isCurrent || context.isCurrent();
  let workspaceGeneration = 0;
  const isWorkspaceCurrent = generation => isCurrent() && generation === workspaceGeneration;
  const workspaceController = Object.freeze({
    async openAdminPanel() {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      const mounted = await context.loadRoleView("central");
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };

      // La plantilla nueva ya está lista: liberar la interfaz de chófer,
      // pero conservar GPS, presencia, push y la bandeja operativa.
      context.suspendDriverWorkspace?.();
      context.unloadRoleView("driver");
      context.setAdminTripAlertPanel(true);
      context.renderAdminDriverTripSummary?.();
      context.listenDriverInbox?.();
      context.showView("central");
      void Promise.resolve(context.loadAdminProfiles?.()).catch(error => {
        console.error("No se pudieron cargar los perfiles administrativos:", error);
      });
      return { view: "central" };
    },
    async openDriverWorkspace() {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      const mounted = await context.loadRoleView("driver");
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };

      context.showView("inicio");
      context.unloadRoleView("central");
      await context.resumeDriverWorkspace?.();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
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
