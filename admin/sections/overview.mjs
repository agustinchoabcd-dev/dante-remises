import { buildAdminOverviewModel, formatAdminOverviewTime } from "../overview-state.mjs";

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function setValue(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value);
}

export async function mount({ root, openSection, loadAdminOverviewData }) {
  const document = root.ownerDocument;
  const handlers = [];
  let disposed = false;
  let requestVersion = 0;
  const refreshButton = root.querySelector("#adminOverviewRefreshButton");
  const attention = root.querySelector("#adminOverviewAttention");
  const attentionList = root.querySelector("#adminOverviewAttentionList");
  const activityList = root.querySelector("#adminOverviewActivityList");

  root.querySelectorAll("[data-admin-go]").forEach(button => {
    const handler = () => void openSection?.(button.dataset.adminGo);
    button.addEventListener("click", handler);
    handlers.push([button, handler]);
  });

  function renderActivity(items, available) {
    if (!activityList) return;
    activityList.replaceChildren();
    if (!available) {
      activityList.append(node(document, "div", "admin-empty", "La actividad no está disponible porque no se pudieron consultar los viajes."));
      return;
    }
    if (!items.length) {
      activityList.append(node(document, "div", "admin-empty", "Todavía no hay viajes registrados."));
      return;
    }
    for (const item of items) {
      const row = node(document, "div", "admin-activity-item");
      const main = node(document, "div", "admin-activity-main");
      main.append(node(document, "strong", "", item.passengerName + (item.carId ? " · coche " + item.carId : "")));
      const details = [item.statusLabel, item.driverName].filter(Boolean).join(" · ");
      main.append(node(document, "span", "", details));
      row.append(main, node(document, "time", "admin-activity-time", formatAdminOverviewTime(item.at)));
      activityList.append(row);
    }
  }

  function renderAttention(count, available) {
    if (!attention || !attentionList) return;
    attentionList.replaceChildren();
    if (!available) {
      attention.hidden = false;
      const row = node(document, "div", "admin-attention-item");
      row.append(node(document, "p", "", "No se pudieron consultar las solicitudes pendientes. Actualizá el resumen para volver a intentarlo."));
      attentionList.append(row);
      return;
    }
    attention.hidden = count === 0;
    if (count > 0) {
      const row = node(document, "div", "admin-attention-item");
      row.append(node(document, "p", "", count + (count === 1 ? " solicitud de viaje espera atención." : " solicitudes de viaje esperan atención.")));
      const button = node(document, "button", "secondary", "Revisar");
      button.type = "button";
      const onOpenTrips = () => void openSection?.("trips");
      button.addEventListener("click", onOpenTrips);
      handlers.push([button, onOpenTrips]);
      row.append(button);
      attentionList.append(row);
    }
  }

  async function refresh() {
    const version = ++requestVersion;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Actualizando…";
    }
    setValue(root, "#adminOverviewUpdatedAt", "Actualizando datos…");
    try {
      if (typeof loadAdminOverviewData !== "function") throw new Error("No está disponible la consulta de datos del resumen.");
      const data = await loadAdminOverviewData();
      if (disposed || version !== requestVersion || data?.stale) return;
      const model = buildAdminOverviewModel({ cars: data.cars, trips: data.trips, now: data.loadedAt || Date.now() });
      setValue(root, "#adminOverviewFree", model.fleet.free);
      setValue(root, "#adminOverviewBusy", model.fleet.busy);
      setValue(root, "#adminOverviewOut", model.fleet.outOfService);
      setValue(root, "#adminOverviewFleetMeta", "Conectados: " + (model.fleet.total - model.fleet.disconnected) + " de " + model.fleet.total + " · desconectados: " + model.fleet.disconnected + ". La conexión se informa por separado del estado manual.");
      const available = data.tripsAvailable !== false;
      const values = available ? model.stats : { todayTrips: "—", activeTrips: "—", completedToday: "—", cancelledToday: "—" };
      setValue(root, "#adminOverviewTodayTrips", values.todayTrips);
      setValue(root, "#adminOverviewActiveTrips", values.activeTrips);
      setValue(root, "#adminOverviewCompletedTrips", values.completedToday);
      setValue(root, "#adminOverviewCancelledTrips", values.cancelledToday);
      setValue(root, "#adminOverviewStatsMeta", available ? "Solicitudes por fecha de creación; estados actuales para viajes activos; finalizados y cancelados por última actualización." : "Estadísticas no disponibles: falló la lectura de viajes.");
      renderAttention(model.pendingRequests, available);
      renderActivity(model.activity, available);
      setValue(root, "#adminOverviewUpdatedAt", "Última actualización: " + formatAdminOverviewTime(data.loadedAt));
    } catch (error) {
      if (!disposed && version === requestVersion) {
        renderAttention(0, false);
        renderActivity([], false);
        setValue(root, "#adminOverviewStatsMeta", "No se pudieron cargar las estadísticas.");
        setValue(root, "#adminOverviewUpdatedAt", "No se pudo actualizar el resumen. " + (error?.message || "Error de consulta."));
        console.error("No se pudo actualizar el resumen administrativo:", error);
      }
    } finally {
      if (refreshButton && !disposed && version === requestVersion) {
        refreshButton.disabled = false;
        refreshButton.textContent = "↻ Actualizar";
      }
    }
  }

  const onRefresh = () => void refresh();
  refreshButton?.addEventListener("click", onRefresh);
  await refresh();
  return () => {
    disposed = true;
    requestVersion++;
    refreshButton?.removeEventListener("click", onRefresh);
    for (const [button, handler] of handlers) button.removeEventListener("click", handler);
  };
}
