export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  const driverModule = await import("./driver.mjs");
  context.setWorkspaceRole?.("driver");
  const initialMount = await driverModule.mount(context);
  if (initialMount?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };

  const isCurrent = () => !context.isCurrent || context.isCurrent();
  let workspaceGeneration = 0;
  const isWorkspaceCurrent = generation => isCurrent() && generation === workspaceGeneration;
  const workspaceContext = generation => Object.freeze({
    ...context,
    isCurrent: () => isWorkspaceCurrent(generation)
  });
  const stopOperator = async () => { await context.stopOperatorPresence?.(); };
  const stopPassenger = () => { context.suspendPassengerWorkspace?.(); };
  const suspendDriver = () => { context.suspendDriverWorkspace?.(); };

  const workspaceController = Object.freeze({
    async openAdminPanel({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      stopPassenger();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("admin");

      // Reuse the existing Central module for its view/template lifecycle.
      const centralModule = await import("./operator.mjs");
      const mounted = await centralModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };

      suspendDriver();
      context.unloadRoleView("driver");
      context.unloadRoleView("passenger");
      context.setAdminTripAlertPanel(true);
      context.renderAdminDriverTripSummary?.();
      context.listenDriverInbox?.();
      context.renderAdminOperationalHealth?.();
      void Promise.resolve(context.loadAdminProfiles?.()).catch(error => {
        console.error("No se pudieron cargar los perfiles administrativos:", error);
      });
      return { view: "central" };
    },

    async openDriverWorkspace({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      stopPassenger();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("driver");

      const driverModule = await import("./driver.mjs");
      const mounted = await driverModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };

      context.unloadRoleView("central");
      context.unloadRoleView("passenger");
      await context.resumeDriverWorkspace?.();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      return { view: "inicio" };
    },

    async openOperatorWorkspace({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      stopPassenger();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("operator");

      const operatorModule = await import("./operator.mjs");
      const mounted = await operatorModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };

      suspendDriver();
      context.unloadRoleView("driver");
      context.unloadRoleView("passenger");
      context.setAdminTripAlertPanel(false);
      context.listenDriverInbox?.();
      context.startOperatorPresence?.();
      return { view: "central" };
    },

    async openPassengerWorkspace({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      stopPassenger();
      suspendDriver();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("passenger");

      const passengerModule = await import("./passenger.mjs");
      const mounted = await passengerModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };

      context.unloadRoleView("driver");
      context.unloadRoleView("central");
      await context.resumePassengerWorkspace?.();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      return mounted;
    },

    async openAllRolesWorkspace() {
      return workspaceController.openDriverWorkspace({ keepAllRoles: true });
    },

    async selectAllRole(role) {
      if (role === "admin") return workspaceController.openAdminPanel({ keepAllRoles: true });
      if (role === "driver") return workspaceController.openDriverWorkspace({ keepAllRoles: true });
      if (role === "operator") return workspaceController.openOperatorWorkspace({ keepAllRoles: true });
      if (role === "passenger") return workspaceController.openPassengerWorkspace({ keepAllRoles: true });
      return { unsupported: true };
    }
  });

  const background = (async () => {
    const results = await Promise.allSettled([
      context.initializeAdminCars(),
      driverModule.activateDriverOperations(context)
    ]);
    for (const result of results) {
      if (result.status === "rejected") console.error("No se pudo completar una tarea secundaria del administrador:", result.reason);
    }
  })();

  return { view: initialMount.view, background, workspaceController };
}
