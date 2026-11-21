export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  const driverMounted = await context.loadRoleView("driver");
  if (driverMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  context.setWorkspaceRole?.("driver");
  context.showView("inicio");

  const isCurrent = () => !context.isCurrent || context.isCurrent();
  let workspaceGeneration = 0;
  const isWorkspaceCurrent = generation => isCurrent() && generation === workspaceGeneration;
  const stopOperator = async () => { await context.stopOperatorPresence?.(); };
  const stopPassenger = () => { context.suspendPassengerWorkspace?.(); };
  const suspendDriver = () => { context.suspendDriverWorkspace?.(); };
  const workspaceController = Object.freeze({
    async openAdminPanel() {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      stopPassenger();
      context.setWorkspaceRole?.("admin");
      const mounted = await context.loadRoleView("central");
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      suspendDriver();
      context.unloadRoleView("driver");
      context.unloadRoleView("passenger");
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
      await stopOperator();
      stopPassenger();
      context.setWorkspaceRole?.("driver");
      const mounted = await context.loadRoleView("driver");
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      context.showView("inicio");
      context.unloadRoleView("central");
      context.unloadRoleView("passenger");
      await context.resumeDriverWorkspace?.();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      return { view: "inicio" };
    },
    async openOperatorWorkspace() {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      stopPassenger();
      context.setWorkspaceRole?.("operator");
      const mounted = await context.loadRoleView("central");
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      suspendDriver();
      context.unloadRoleView("driver");
      context.unloadRoleView("passenger");
      context.setAdminTripAlertPanel(false);
      context.listenDriverInbox?.();
      context.showView("central");
      context.startOperatorPresence?.();
      return { view: "central" };
    },
    async openPassengerWorkspace() {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      context.setWorkspaceRole?.("passenger");
      const mounted = await context.loadRoleView("passenger");
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      suspendDriver();
      stopPassenger();
      context.unloadRoleView("driver");
      context.unloadRoleView("central");
      const photoReady = await context.loadPassengerPhoto();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      if (photoReady === true || photoReady === null) context.showView("pasajero");
      else context.showPassengerOnboarding();
      context.resumePassengerWorkspace?.();
      return { view: photoReady === false ? "passengerOnboarding" : "pasajero", photoReady };
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
