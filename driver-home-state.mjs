export function getDriverHomeStatus({ online = false, status = "desconectado" } = {}) {
  if (!online) return Object.freeze({ label: "Desconectado", tone: "red", badge: "" });
  if (status === "ocupado") return Object.freeze({ label: "Conectado", tone: "orange", badge: "Ocupado" });
  if (status === "fuera") return Object.freeze({ label: "Conectado", tone: "red", badge: "Fuera de servicio" });
  return Object.freeze({ label: "Conectado", tone: "green", badge: "" });
}
export function shouldRegisterDriverPresence(role, wantsOnline, hasActiveTrip = false) {
  return (role === "admin" || role === "driver") && (wantsOnline === true || hasActiveTrip === true);
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

function isCoordinatePart(value) {
  const part=cleanPlacePart(value);
  return /\b(latitude|longitude|lat|lon)\b\s*[:=]/i.test(part) ||
    /^[-+]?\d{1,3}\.\d{3,}$/.test(part) ||
    /^[-+]?\d{1,3}(?:\.\d+)?\s*[,;]\s*[-+]?\d{1,3}(?:\.\d+)?$/.test(part) ||
    /^[-+]?\d{1,3}\.\d+\s+[-+]?\d{1,3}\.\d+$/.test(part);
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
    ? addressLine1.split(",").map(cleanPlacePart).filter(Boolean).filter(part => !/^\d{4,5}\b/.test(part) && !isCoordinatePart(part) && !/(argentina|c[oó]rdoba|santa rosa de calamuchita|calamuchita)/i.test(part))
    : [];
  if (name && road && name.toLocaleLowerCase() !== road.toLocaleLowerCase()) {
    return name + ", " + road;
  }
  if (name) {
    const supplementalRoad = addressParts.find(part => part.toLocaleLowerCase() !== name.toLocaleLowerCase() && /\d|\b(calle|avenida|av\.?|ruta|rp|rn|boulevard|bv\.?|pasaje|camino|autopista)\b/i.test(part));
    return supplementalRoad ? name + ", " + supplementalRoad : name;
  }
  if (road) return road;
  if (addressParts.length) return addressParts.slice(0, 2).join(", ") || "Ubicación sin referencia";

  const label = cleanPlacePart(point.label);
  if (!label) return "Ubicación sin referencia";
  const parts = label.split(",").map(cleanPlacePart).filter(Boolean).filter(part => !/^\d{4,5}\b/.test(part) && !isCoordinatePart(part) && !/(argentina|c[oó]rdoba|santa rosa de calamuchita|calamuchita)/i.test(part));
  if (!parts.length) return "Ubicación sin referencia";
  if (parts.length < 2) return parts[0] || "Ubicación sin referencia";
  const first = parts[0];
  const second = parts[1];
  const looksLikeStreet = /\d|\b(calle|avenida|av\.?|ruta|rp|rn|boulevard|bv\.?|pasaje|camino|autopista)\b/i.test(second);
  return looksLikeStreet ? first + ", " + second : first;
}

export function formatDriverCardDistance(meters) {
  const value=Number(meters);
  if(!Number.isFinite(value)||value<0)return "Distancia no disponible";
  return (value/1000).toFixed(1)+" km";
}

export function getDriverRequestRouteDistances(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const legDistances = legs.map(leg => {
    const raw = leg?.distance;
    const value = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  });
  const sum = values => values.length && values.every(Number.isFinite)
    ? values.reduce((total,value) => total + value,0)
    : null;
  return {
    pickupMeters: legDistances[0] ?? null,
    destinationMeters: sum(legDistances.slice(1)),
    totalRouteMeters: sum(legDistances),
    legDistances
  };
}

const DRIVER_EARTH_RADIUS_METERS = 6_371_000;
function driverLocationDistanceMeters(a, b) {
  const radians = value => Number(value) * Math.PI / 180;
  const lat1 = radians(a.lat), lat2 = radians(b.lat);
  const dLat = lat2 - lat1, dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * DRIVER_EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function validateDriverLocationFix(position, {
  previous = null,
  now = Date.now(),
  maxAccuracyMeters = 100,
  maxAgeMs = 30_000,
  maxSpeedMetersPerSecond = 70
} = {}) {
  const coords = position?.coords || position || {};
  const lat = Number(coords.latitude ?? coords.lat);
  const lon = Number(coords.longitude ?? coords.lon);
  const accuracy = Number(coords.accuracy);
  const timestampValue = Number(position?.timestamp ?? coords.timestamp);
  const updatedAt = Number.isFinite(timestampValue) && timestampValue > 0 ? timestampValue : Number(now);
  const ageMs = Number(now) - updatedAt;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { accepted: false, reason: "invalid_coordinates", accuracyMeters: Number.isFinite(accuracy) ? accuracy : null, ageMs };
  }
  if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > maxAgeMs) {
    return { accepted: false, reason: "stale_fix", accuracyMeters: Number.isFinite(accuracy) ? accuracy : null, ageMs };
  }
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maxAccuracyMeters) {
    return { accepted: false, reason: "poor_accuracy", accuracyMeters: Number.isFinite(accuracy) ? accuracy : null, ageMs };
  }

  if (previous && Number.isFinite(Number(previous.lat)) && Number.isFinite(Number(previous.lon))) {
    const previousAt = Number(previous.updatedAt);
    const elapsedSeconds = Math.max(0.5, (updatedAt - (Number.isFinite(previousAt) ? previousAt : updatedAt)) / 1000);
    const previousAccuracy = Math.max(0, Number(previous.accuracy) || 0);
    const maximumPlausibleDistance = maxSpeedMetersPerSecond * elapsedSeconds + previousAccuracy + accuracy + 30;
    const distance = driverLocationDistanceMeters(previous, { lat, lon });
    if (distance > maximumPlausibleDistance) {
      return { accepted: false, reason: "implausible_jump", accuracyMeters: accuracy, ageMs, distanceMeters: Math.round(distance) };
    }
  }

  return {
    accepted: true,
    location: {
      lat,
      lon,
      accuracy: Math.round(accuracy),
      heading: Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
      speed: Number.isFinite(Number(coords.speed)) ? Number(coords.speed) : null,
      updatedAt
    },
    ageMs
  };
}
