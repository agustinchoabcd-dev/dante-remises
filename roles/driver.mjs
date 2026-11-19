export async function activateDriverOperations(context) {
  const isCurrent = () => !context.isCurrent || context.isCurrent();
  if (!isCurrent()) return;

  void context.syncDriverPushRegistration(context.user, context.role);
  context.listenDriverInbox();
  await context.restoreDriverActiveTrip();
  if (!isCurrent()) return;

  context.startDriverGps();
  if (!isCurrent()) return;
  await context.processPendingTripAction();
}

export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  const mounted = await context.loadRoleView("driver");
  if (mounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  context.showView("inicio");

  return {
    view: "chofer",
    background: activateDriverOperations(context)
  };
}
