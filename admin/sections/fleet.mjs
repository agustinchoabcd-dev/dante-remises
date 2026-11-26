export function mount({ render, root }) {
  const button = root.querySelector("#adminFleetRefreshButton");
  const updated = root.querySelector("#adminFleetUpdatedAt");
  const refresh = () => {
    if (button) {
      button.disabled = true;
      button.textContent = "Actualizando…";
    }
    try {
      render?.("admin-fleet-refresh");
      if (updated) updated.textContent = "Actualizado " + new Date().toLocaleTimeString("es-AR");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "↻ Actualizar flota";
      }
    }
  };
  button?.addEventListener("click", refresh);
  refresh();
  return () => button?.removeEventListener("click", refresh);
}
