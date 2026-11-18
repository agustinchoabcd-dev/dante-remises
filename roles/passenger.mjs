export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  if (context.loadRoleView) {
    const mounted = await context.loadRoleView("passenger");
    if (mounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  }
  const photoReady = await context.loadPassengerPhoto();
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  if (photoReady) {
    context.showView("pasajero");
    return { view: "pasajero", photoReady: true };
  }

  context.showPassengerOnboarding();
  return { view: "passengerOnboarding", photoReady: false };
}
