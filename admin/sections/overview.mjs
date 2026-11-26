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
  const onAttentionClick = event => {
    const button = event.target.closest?.("[data-admin-attention-open]");
    if (button && attentionList?.contains(button)) void openSection?.("trips");
  };
  attentionList?.addEventListener("click", onAttentionClick);

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
      button.dataset.adminAttentionOpen = "true";
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
      setValue(root, "#adminOverviewFleetMeta", "Conectados: " + (model.fleet.total - model.fleet.disconnected) + " de " + model.fleet.total + " · desconectados: " + model.fleet.disconnected + ". Los coches desconectados no cuentan como libres.");
      const available = data.tripsAvailable !== false;
      const pendingAvailable = data.pendingRequestsAvailable !== false;
      const pendingCount = Array.isArray(data.pendingRequests) ? data.pendingRequests.length : model.pendingRequests;
      const values = available ? model.stats : { todayTrips: "—", activeTrips: "—", completedToday: "—", rejectedToday: "—" };
      setValue(root, "#adminOverviewTodayTrips", values.todayTrips);
      setValue(root, "#adminOverviewActiveTrips", values.activeTrips);
      setValue(root, "#adminOverviewCompletedTrips", values.completedToday);
      setValue(root, "#adminOverviewRejectedTrips", values.rejectedToday);
      setValue(root, "#adminOverviewStatsMeta", available ? "Solicitudes por fecha de creación; viajes activos por estado; finalizados y rechazados por fecha de cambio de estado." : "El historial y las estadísticas completas requieren un índice de viajes compatible con las reglas actuales. Las solicitudes pendientes se consultan por la bandeja del coche 144.");
      renderAttention(pendingCount, pendingAvailable);
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
    attentionList?.removeEventListener("click", onAttentionClick);
    for (const [button, handler] of handlers) button.removeEventListener("click", handler);
  };
}
