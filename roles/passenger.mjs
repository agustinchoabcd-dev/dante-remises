export async function mount(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  if (context.loadRoleView) {
    const mounted = await context.loadRoleView("passenger");
    if (mounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  }

  const photoReady = await context.loadPassengerPhoto();
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  if (photoReady === true) {
    context.showView("pasajero");
    return { view: "pasajero", photoReady: true };
  }

  if (photoReady === null) {
    // A temporary photo-service failure must not turn an authenticated session into a blank screen.
    context.showView("pasajero");
    return { view: "pasajero", photoReady: false, photoCheckUnavailable: true };
  }

  context.showPassengerOnboarding();
  return { view: "passengerOnboarding", photoReady: false };
}

export async function activate(context) {
  return mount(context);
}
