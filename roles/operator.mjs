export async function activate(context) {
  if (context.isCurrent && !context.isCurrent()) return { stale: true };
  context.showView("central");

  return {
    view: "central",
    background: Promise.resolve().then(() => {
      if (!context.isCurrent || context.isCurrent()) context.startOperatorPresence();
    })
  };
}
