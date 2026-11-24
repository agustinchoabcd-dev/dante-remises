export function mount({ root, openSection }) {
  const handlers = [];
  root.querySelectorAll("[data-admin-go]").forEach(button => {
    const handler = () => void openSection?.(button.dataset.adminGo);
    button.addEventListener("click", handler);
    handlers.push([button, handler]);
  });
  return () => handlers.forEach(([button, handler]) => button.removeEventListener("click", handler));
}
