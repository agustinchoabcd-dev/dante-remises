export async function activate(context) {
  context.showView("central");
  context.setAdminTripAlertPanel(true);

  const background = (async () => {
    const driverModule = await import("./driver.mjs");
    const results = await Promise.allSettled([
      context.loadAdminProfiles(),
      context.initializeAdminCars(),
      driverModule.activateDriverOperations(context)
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("No se pudo completar una tarea secundaria del administrador:", result.reason);
      }
    }
  })();

  return { view: "central", background };
}
