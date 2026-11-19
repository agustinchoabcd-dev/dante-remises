export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  const centralMounted = await context.loadRoleView("central");
  if (centralMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  const driverMounted = await context.loadRoleView("driver");
  if (driverMounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  context.showView("central");
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
  return { view: "central", background };
}
