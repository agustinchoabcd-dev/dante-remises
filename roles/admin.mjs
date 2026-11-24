export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  const driverModule = await import("./driver.mjs");
  context.setWorkspaceRole?.("driver");
  const initialMount = await driverModule.mount(context);
  if (initialMount?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  const isCurrent = () => !context.isCurrent || context.isCurrent();
  let workspaceGeneration = 0;
  const isWorkspaceCurrent = generation => isCurrent() && generation === workspaceGeneration;
  const workspaceContext = generation => Object.freeze({ ...context, isCurrent: () => isWorkspaceCurrent(generation) });
  const stopOperator = async () => { await context.stopOperatorPresence?.(); };
  const stopPassenger = () => { context.suspendPassengerWorkspace?.(); };
  const suspendDriver = () => { context.suspendDriverWorkspace?.(); };
  const unmountAdmin = async () => { await context.unmountAdminPanel?.(); };

  const workspaceController = Object.freeze({
    async openAdminPanel({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await unmountAdmin();
      context.unloadRoleView?.("central");
      stopPassenger();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("admin");
      const mounted = await context.mountAdminPanel?.(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      context.showView?.("central");
      suspendDriver();
      context.unloadRoleMount?.("driver");
      context.stopDriverInbox?.();
      return { view: "admin" };
    },

    async openDriverWorkspace({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await unmountAdmin();
      stopPassenger();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("driver");
      const mounted = await driverModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      context.unloadRoleView?.("central");
      await context.resumeDriverWorkspace?.();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      return { view: "inicio" };
    },

    async openOperatorWorkspace({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await unmountAdmin();
      stopPassenger();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("operator");
      const operatorModule = await import("./operator.mjs");
      const mounted = await operatorModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      suspendDriver();
      context.unloadRoleMount?.("driver");
      context.setAdminTripAlertPanel?.(false);
      context.listenDriverInbox?.();
      context.startOperatorPresence?.();
      return { view: "central" };
    },

    async openPassengerWorkspace({ keepAllRoles = false } = {}) {
      const generation = ++workspaceGeneration;
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await stopOperator();
      if (!isWorkspaceCurrent(generation)) return { stale: true };
      await unmountAdmin();
      stopPassenger();
      suspendDriver();
      context.setAllRolesMode?.(keepAllRoles);
      context.setWorkspaceRole?.("passenger");
      const passengerModule = await import("./passenger.mjs");
      const mounted = await passengerModule.mount(workspaceContext(generation));
      if (mounted?.stale || !isWorkspaceCurrent(generation)) return { stale: true };
      context.unloadRoleView?.("central");
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
    const results = await Promise.allSettled([context.initializeAdminCars(), driverModule.activateDriverOperations(context)]);
    for (const result of results) if (result.status === "rejected") console.error("No se pudo completar una tarea secundaria del administrador:", result.reason);
  })();
  return { view: initialMount.view, background, workspaceController };
}
