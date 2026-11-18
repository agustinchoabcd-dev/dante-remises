export async function activate(context) {
  context.showView("central");

  return {
    view: "central",
    background: Promise.resolve().then(() => context.startOperatorPresence())
  };
}
