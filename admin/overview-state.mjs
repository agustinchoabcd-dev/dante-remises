const ACTIVE_STATUSES = new Set(["accepted", "in_progress"]);
const STATUS_LABELS = Object.freeze({
  requested: "Solicitud pendiente",
  accepted: "Viaje aceptado",
  in_progress: "Viaje en curso",
  completed: "Viaje finalizado",
  cancelled: "Viaje cancelado",
  rejected: "Solicitud rechazada"
});

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

function sameLocalDay(value, now) {
  const time = timestamp(value);
  if (time === null) return false;
  const date = new Date(time);
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function buildAdminOverviewModel({ cars = [], trips = {}, now = Date.now() } = {}) {
  const current = new Date(now);
  const carRows = Array.isArray(cars) ? cars : Object.values(cars || {});
  const fleet = { free: 0, busy: 0, outOfService: 0, disconnected: 0, total: carRows.length };
  for (const car of carRows) {
    if (car?.online !== true) fleet.disconnected++;
    let status = String(car?.status || "").toLowerCase();
    const until = timestamp(car?.until);
    if (until !== null && until > 0 && until <= current.getTime()) status = "libre";
    if (status === "libre") fleet.free++;
    else if (status === "ocupado") fleet.busy++;
    else if (status === "fuera" || status === "fuera_de_servicio") fleet.outOfService++;
  }

  const tripRows = Object.entries(trips && typeof trips === "object" ? trips : {})
    .filter(([, trip]) => trip && typeof trip === "object")
    .map(([id, trip]) => ({ ...trip, id: String(trip.tripId || id) }));

  const todayTrips = tripRows.filter(trip => sameLocalDay(trip.createdAt, current));
  const activeTrips = tripRows.filter(trip => ACTIVE_STATUSES.has(String(trip.status || "")));
  const completedToday = tripRows.filter(trip => trip.status === "completed" && sameLocalDay(trip.updatedAt ?? trip.createdAt, current));
  const cancelledToday = tripRows.filter(trip => trip.status === "cancelled" && sameLocalDay(trip.updatedAt ?? trip.createdAt, current));
  const pendingRequests = tripRows.filter(trip => trip.status === "requested");
  const activity = [...tripRows]
    .sort((a, b) => (timestamp(b.updatedAt) ?? timestamp(b.createdAt) ?? 0) - (timestamp(a.updatedAt) ?? timestamp(a.createdAt) ?? 0))
    .slice(0, 4)
    .map(trip => ({
      id: trip.id,
      passengerName: String(trip.passengerName || "Pasajero"),
      driverName: String(trip.driverName || ""),
      carId: String(trip.carId || ""),
      status: String(trip.status || "unknown"),
      statusLabel: STATUS_LABELS[trip.status] || "Estado no identificado",
      at: timestamp(trip.updatedAt) ?? timestamp(trip.createdAt)
    }));

  return {
    fleet,
    stats: {
      todayTrips: todayTrips.length,
      activeTrips: activeTrips.length,
      completedToday: completedToday.length,
      cancelledToday: cancelledToday.length
    },
    pendingRequests: pendingRequests.length,
    activity
  };
}

export function formatAdminOverviewTime(value, locale = "es-AR") {
  const time = timestamp(value);
  if (time === null) return "Fecha no disponible";
  return new Date(time).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
