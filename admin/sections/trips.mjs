import { buildAdminTripHistoryModel, formatAdminTripTime, adminTripStatusLabel } from "../trips-state.mjs";

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export async function mount({ root, listenDriverInbox, stopDriverInbox, renderAdminDriverTripSummary, loadAdminOverviewData }) {
  listenDriverInbox?.();
  renderAdminDriverTripSummary?.();
  const search = root.querySelector("#adminTripHistorySearch");
  const status = root.querySelector("#adminTripHistoryStatus");
  const list = root.querySelector("#adminTripHistoryList");
  const count = root.querySelector("#adminTripHistoryCount");
  const refreshButton = root.querySelector("#adminTripHistoryRefreshButton");
  const updated = root.querySelector("#adminTripHistoryUpdatedAt");
  let trips = {}, available = false, disposed = false, requestVersion = 0;

  function renderHistory() {
    if (!list || disposed) return;
    list.replaceChildren();
    if (!available) {
      list.append(element(root.ownerDocument,"div","admin-history-empty","No se pudo consultar el historial. Actualizá para volver a intentarlo."));
      if (count) count.textContent = "Historial no disponible";
      return;
    }
    const model = buildAdminTripHistoryModel({ trips, query: search?.value || "", status: status?.value || "all", limit: 50 });
    if (count) count.textContent = model.total + " de " + model.allCount + " viajes";
    if (!model.rows.length) {
      list.append(element(root.ownerDocument,"div","admin-history-empty",model.allCount ? "No hay viajes que coincidan con esos filtros." : "Todavía no hay viajes registrados."));
      return;
    }
    for (const trip of model.rows) {
      const card = element(root.ownerDocument,"article","admin-history-item");
      const head = element(root.ownerDocument,"div","admin-history-head");
      head.append(element(root.ownerDocument,"strong","",trip.passengerName),element(root.ownerDocument,"span","admin-history-status "+trip.status,adminTripStatusLabel(trip.status)));
      const meta = element(root.ownerDocument,"div","admin-history-meta");
      meta.append(element(root.ownerDocument,"time","",formatAdminTripTime(trip.at)),element(root.ownerDocument,"span","",trip.carId ? "Coche "+trip.carId : "Coche no identificado"));
      if (trip.driverName) meta.append(element(root.ownerDocument,"span","",trip.driverName));
      const route = element(root.ownerDocument,"div","admin-history-route");
      route.append(element(root.ownerDocument,"span","",trip.originLabel),element(root.ownerDocument,"span","admin-route-arrow","→"),element(root.ownerDocument,"span","",trip.destinationLabel));
      card.append(head,meta,route);
      list.append(card);
    }
    if (model.hasMore) list.append(element(root.ownerDocument,"p","hint","Se muestran los últimos 50 resultados. Usá los filtros para acotar la búsqueda."));
  }

  async function refresh() {
    const version = ++requestVersion;
    if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = "Actualizando…"; }
    if (count) count.textContent = "Consultando viajes…";
    try {
      if (typeof loadAdminOverviewData !== "function") throw new Error("No está disponible la consulta de viajes.");
      const data = await loadAdminOverviewData();
      if (disposed || version !== requestVersion || data?.stale) return;
      available = data?.tripsAvailable !== false;
      trips = available ? (data?.trips || {}) : {};
      renderHistory();
      if (updated) updated.textContent = "Última actualización: " + formatAdminTripTime(data?.loadedAt);
    } catch (error) {
      if (!disposed && version === requestVersion) {
        available = false; trips = {}; renderHistory();
        if (updated) updated.textContent = "No se pudo actualizar el historial.";
        console.error("No se pudo cargar el historial administrativo:",error);
      }
    } finally {
      if (refreshButton && !disposed && version === requestVersion) { refreshButton.disabled = false; refreshButton.textContent = "↻ Actualizar"; }
    }
  }

  const onSearch=()=>renderHistory(), onStatus=()=>renderHistory(), onRefresh=()=>void refresh();
  search?.addEventListener("input",onSearch);
  status?.addEventListener("change",onStatus);
  refreshButton?.addEventListener("click",onRefresh);
  await refresh();
  return () => {
    disposed=true; requestVersion++;
    search?.removeEventListener("input",onSearch);
    status?.removeEventListener("change",onStatus);
    refreshButton?.removeEventListener("click",onRefresh);
  };
}

export function unmount({ stopDriverInbox }) { stopDriverInbox?.(); }
