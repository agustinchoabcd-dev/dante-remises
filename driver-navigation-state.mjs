const EARTH_RADIUS_METERS = 6371008.8;

export function getDriverNavigationStage(trip) {
  if (trip?.status === "accepted") return "pickup";
  if (trip?.status === "in_progress") return "destination";
  return null;
}

export function getDriverNavigationTarget(trip) {
  const stage = getDriverNavigationStage(trip);
  if (!stage) return null;
  const point = stage === "pickup" ? trip.origin : trip.destination;
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { stage, point: { lat, lon }, label: point?.label || (stage === "pickup" ? "Punto de recogida" : "Destino del viaje") };
}

export function distanceBetweenPointsMeters(a, b) {
  const lat1 = Number(a?.lat), lon1 = Number(a?.lon);
  const lat2 = Number(b?.lat), lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function getDriverNavigationProgress(route, location) {
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !location) return null;
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < coordinates.length; index++) {
    const coordinate = coordinates[index];
    const distance = distanceBetweenPointsMeters(location, { lon: coordinate[0], lat: coordinate[1] });
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  const steps = (route.legs || []).flatMap(leg => leg.steps || []);
  let nearestStepIndex = 0;
  let nearestStepDistance = Infinity;
  steps.forEach((step, index) => {
    for (const coordinate of step.geometry?.coordinates || []) {
      const distance = distanceBetweenPointsMeters(location, { lon: coordinate[0], lat: coordinate[1] });
      if (distance < nearestStepDistance) {
        nearestStepDistance = distance;
        nearestStepIndex = index;
      }
    }
  });
  const nextStepIndex = Math.min(nearestStepIndex + 1, Math.max(0, steps.length - 1));
  const nextStep = steps[nextStepIndex];
  const maneuver = nextStep?.maneuver?.location;
  const distanceToManeuver = Array.isArray(maneuver)
    ? distanceBetweenPointsMeters(location, { lon: maneuver[0], lat: maneuver[1] })
    : null;
  const progress = nearestIndex / Math.max(1, coordinates.length - 1);
  return {
    offRouteMeters: nearestDistance,
    progress,
    remainingDistanceMeters: Math.max(0, Number(route.distance || 0) * (1 - progress)),
    remainingDurationSeconds: Math.max(0, Number(route.duration || 0) * (1 - progress)),
    stepIndex: nextStepIndex,
    instruction: nextStep?.maneuver?.instruction || nextStep?.name || "Continuá por la ruta",
    distanceToManeuver
  };
}

export function shouldRerouteDriver({ offRouteMeters, lastRerouteAt = 0, now = Date.now(), thresholdMeters = 65, cooldownMs = 20000 } = {}) {
  return Number(offRouteMeters) > thresholdMeters && Number(now) - Number(lastRerouteAt) >= cooldownMs;
}
