const STATUS_LABELS = Object.freeze({ requested: "Solicitado", accepted: "Aceptado", in_progress: "En curso", completed: "Finalizado", rejected: "Rechazado", cancelled: "Cancelado" });

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatAdminTripTime(value, locale = "es-AR") {
  const time = timestamp(value);
  if (time === null) return "Fecha no disponible";
  return new Date(time).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatAdminTripPlace(point) {
  if (typeof point === "string" && point.trim()) return point.trim();
  if (!point || typeof point !== "object") return "Ubicación no informada";
  return String(point.label || point.address || point.name || "Ubicación registrada");
}

export function buildAdminTripHistoryModel({ trips = {}, query = "", status = "all", limit = 50 } = {}) {
  const entries = Array.isArray(trips) ? trips.map((trip, index) => [String(trip?.tripId || index), trip]) : Object.entries(trips && typeof trips === "object" ? trips : {});
  const allRows = entries.filter(([, trip]) => trip && typeof trip === "object").map(([id, trip]) => ({
    ...trip, id: String(trip.tripId || id), status: String(trip.status || "unknown").toLowerCase(),
    passengerName: String(trip.passengerName || "Pasajero"), driverName: String(trip.driverName || ""),
    carId: String(trip.carId || ""), originLabel: formatAdminTripPlace(trip.origin),
    destinationLabel: formatAdminTripPlace(trip.destination), at: timestamp(trip.updatedAt) ?? timestamp(trip.createdAt)
  }));
  const needle = String(query || "").trim().toLocaleLowerCase("es-AR");
  const filtered = allRows.filter(row => status === "all" || row.status === status)
    .filter(row => !needle || [row.id,row.passengerName,row.driverName,row.carId,row.originLabel,row.destinationLabel,STATUS_LABELS[row.status]||row.status].join(" ").toLocaleLowerCase("es-AR").includes(needle))
    .sort((a,b)=>(b.at??0)-(a.at??0));
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
  return { total: filtered.length, allCount: allRows.length, rows: filtered.slice(0,safeLimit), hasMore: filtered.length > safeLimit };
}

export function adminTripStatusLabel(status) {
  return STATUS_LABELS[String(status || "").toLowerCase()] || "Estado no identificado";
}
