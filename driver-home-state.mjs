export function getDriverHomeStatus({ online = false, status = "desconectado" } = {}) {
  if (!online) return Object.freeze({ label: "Desconectado", tone: "red", badge: "" });
  if (status === "ocupado") return Object.freeze({ label: "Conectado", tone: "orange", badge: "Ocupado" });
  if (status === "fuera") return Object.freeze({ label: "Conectado", tone: "red", badge: "Fuera de servicio" });
  return Object.freeze({ label: "Conectado", tone: "green", badge: "" });
}
export function shouldRegisterDriverPresence(role, wantsOnline, hasActiveTrip = false) {
  return role === "admin" || (role === "driver" && (wantsOnline === true || hasActiveTrip === true));
}
export function shouldExpandDriverCurtain({ expanded, deltaY, viewportHeight }) {
  const threshold = Math.max(0, Number(viewportHeight) || 0) * 0.45;
  return expanded ? Number(deltaY) < threshold : Number(deltaY) <= -threshold;
}
export function nextDriverHomeMessage(current) {
  return current === "Estás conectado" ? "Buscando solicitud de viaje" : "Estás conectado";
}