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
  return expanded ? Number(deltaY) <= threshold : Number(deltaY) < -threshold;
}
export function nextDriverHomeMessage(current) {
  return current === "Estás conectado" ? "Buscando solicitud de viaje" : "Estás conectado";
}

function cleanPlacePart(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function formatDriverTripPlace(point = {}) {
  const name = cleanPlacePart(point.placeName || point.name);
  const street = cleanPlacePart(point.street);
  const houseNumber = cleanPlacePart(point.houseNumber || point.housenumber);
  const street2 = cleanPlacePart(point.street2);
  const road = street2
    ? [street, street2].filter(Boolean).join(" y ")
    : [street, houseNumber].filter(Boolean).join(" ");
  const addressLine1 = cleanPlacePart(point.addressLine1 || point.address_line1);
  const addressParts = addressLine1
    ? addressLine1.split(",").map(cleanPlacePart).filter(Boolean).filter(part => !/^\d{4,5}\b/.test(part) && !/(argentina|c[oó]rdoba|santa rosa de calamuchita|calamuchita)/i.test(part))
    : [];
  if (name && road && name.toLocaleLowerCase() !== road.toLocaleLowerCase()) {
    return name + " · " + road;
  }
  if (name) {
    const supplementalRoad = addressParts.find(part => part.toLocaleLowerCase() !== name.toLocaleLowerCase() && /\d|\b(calle|avenida|av\.?|ruta|rp|rn|boulevard|bv\.?|pasaje|camino|autopista)\b/i.test(part));
    return supplementalRoad ? name + " · " + supplementalRoad : name;
  }
  if (road) return road;
  if (addressParts.length) return addressParts.slice(0, 2).join(" · ") || "Ubicación sin referencia";

  const label = cleanPlacePart(point.label);
  if (!label) return "Ubicación sin referencia";
  const parts = label.split(",").map(cleanPlacePart).filter(Boolean).filter(part => !/^\d{4,5}\b/.test(part) && !/(argentina|c[oó]rdoba|santa rosa de calamuchita|calamuchita)/i.test(part));
  if (!parts.length) return "Ubicación sin referencia";
  if (parts.length < 2) return parts[0] || "Ubicación sin referencia";
  const first = parts[0];
  const second = parts[1];
  const looksLikeStreet = /\d|\b(calle|avenida|av\.?|ruta|rp|rn|boulevard|bv\.?|pasaje|camino|autopista)\b/i.test(second);
  return looksLikeStreet ? first + " · " + second : first;
}

export function getDriverRequestRouteDistances(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const pickupRaw = legs[0]?.distance;
  const destinationRaw = legs[1]?.distance;
  const pickupMeters = pickupRaw === null || pickupRaw === undefined || pickupRaw === "" ? NaN : Number(pickupRaw);
  const destinationMeters = destinationRaw === null || destinationRaw === undefined || destinationRaw === "" ? NaN : Number(destinationRaw);
  return {
    pickupMeters: Number.isFinite(pickupMeters) && pickupMeters >= 0 ? pickupMeters : null,
    destinationMeters: Number.isFinite(destinationMeters) && destinationMeters >= 0 ? destinationMeters : null
  };
}
