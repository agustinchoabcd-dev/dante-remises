export async function activate(context) {
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
    // A transient photo-service/network failure must not look like a logged-out session.
    // Keep the authenticated passenger workspace visible; trip requests remain gated by photo verification.
    context.showView("pasajero");
    return { view: "pasajero", photoReady: false, photoCheckUnavailable: true };
  }

  context.showPassengerOnboarding();
  return { view: "passengerOnboarding", photoReady: false };
}
