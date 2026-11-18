export async function activate(context) {
  const photoReady = await context.loadPassengerPhoto();

  if (photoReady) {
    context.showView("pasajero");
    return { view: "pasajero", photoReady: true };
  }

  context.showPassengerOnboarding();
  return { view: "passengerOnboarding", photoReady: false };
}
