export async function mount(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  const mounted = await context.loadAuthView();
  if (mounted?.stale || (context.isCurrent && !context.isCurrent())) return { stale: true };
  context.showAuthPage("passenger");
  return { view: "auth" };
}
