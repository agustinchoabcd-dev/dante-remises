export async function mount(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  const mounted = await context.loadRoleView("central");
  if (mounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  context.showView("central");
  return { view: "central" };
}

export async function activate(context) {
  const mounted = await mount(context);
  if (mounted?.stale) return mounted;
  return {
    ...mounted,
    background: Promise.resolve().then(() => {
      if (!context.isCurrent || context.isCurrent()) context.startOperatorPresence();
    })
  };
}
