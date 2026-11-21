export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  // El administrador conserva su identidad y permisos; la primera interfaz
  // es el espacio de trabajo de chófer del coche 144.
  const driverMounted = await context.loadRoleView("driver");
  if (driverMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };

  // Central queda preparada para abrirse desde Configuración, sin mostrarse
  // durante el inicio ni duplicar la interfaz operativa.
  const centralMounted = await context.loadRoleView("central");
  if (centralMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };

  context.showView("inicio");
  context.setAdminTripAlertPanel(true);
  const background = (async () => {
    const driverModule = await import("./driver.mjs");
    const isCurrent = () => !context.isCurrent || context.isCurrent();
    if (!isCurrent()) return;
    const runIfCurrent = async task => {
      if (!isCurrent()) return;
      await task();
    };
    const results = await Promise.allSettled([
      runIfCurrent(context.loadAdminProfiles),
      runIfCurrent(context.initializeAdminCars),
      runIfCurrent(() => driverModule.activateDriverOperations(context))
    ]);
    for (const result of results) {
      if (result.status === "rejected") console.error("No se pudo completar una tarea secundaria del administrador:", result.reason);
    }
  })();
  return { view: "inicio", background };
}
