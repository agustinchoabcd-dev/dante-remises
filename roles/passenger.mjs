export async function activate(context) {
  const photoReady = await context.loadPassengerPhoto();
  if (context.isCurrent && !context.isCurrent()) return { stale: true };

  if (photoReady) {
    context.showView("pasajero");
    return { view: "pasajero", photoReady: true };
  }

  context.showPassengerOnboarding();
  return { view: "passengerOnboarding", photoReady: false };
}
