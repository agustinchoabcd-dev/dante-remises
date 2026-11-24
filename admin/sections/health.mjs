export function mount({ renderAdminOperationalHealth, root }) {
  renderAdminOperationalHealth?.();
  const button = root.querySelector("#adminHealthRefreshButton");
  const refresh = () => renderAdminOperationalHealth?.();
  button?.addEventListener("click", refresh);
  return () => button?.removeEventListener("click", refresh);
}
