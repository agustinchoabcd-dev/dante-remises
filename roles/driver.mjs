export async function activateDriverOperations(context) {
  void context.syncDriverPushRegistration(context.user, context.role);
  context.listenDriverInbox();
  await context.restoreDriverActiveTrip();
  context.startDriverGps();
  await context.processPendingTripAction();
}

export async function activate(context) {
  context.showView("chofer");

  return {
    view: "chofer",
    background: activateDriverOperations(context)
  };
}
