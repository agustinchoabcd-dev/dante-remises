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

function pointToSegmentDistance(point, a, b) {
  const latitude = Number(point.lat);
  const longitude = Number(point.lon);
  const aLat = Number(a[1]), aLon = Number(a[0]);
  const bLat = Number(b[1]), bLon = Number(b[0]);
  const scaleY = EARTH_RADIUS_METERS * Math.PI / 180;
  const scaleX = scaleY * Math.cos(latitude * Math.PI / 180);
  const ax = (aLon - longitude) * scaleX;
  const ay = (aLat - latitude) * scaleY;
  const bx = (bLon - longitude) * scaleX;
  const by = (bLat - latitude) * scaleY;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
  const projectedX = ax + fraction * dx;
  const projectedY = ay + fraction * dy;
  return { distance: Math.hypot(projectedX, projectedY), fraction };
}

function nearestOnLine(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  let nearestDistance = Infinity, alongDistance = 0, totalDistance = 0;
  for (let index = 0; index < coordinates.length - 1; index++) {
    const a = coordinates[index], b = coordinates[index + 1];
    const segmentLength = distanceBetweenPointsMeters(
      { lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] }
    );
    const projection = pointToSegmentDistance(point, a, b);
    if (projection.distance < nearestDistance) {
      nearestDistance = projection.distance;
      alongDistance = totalDistance + segmentLength * projection.fraction;
    }
    totalDistance += segmentLength;
  }
  return { distance: nearestDistance, alongDistance, totalDistance };
}

export function getDriverNavigationProgress(route, location) {
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !location) return null;
  const nearestRoute = nearestOnLine(location, coordinates);
  if (!nearestRoute) return null;
  const steps = (route.legs || []).flatMap(leg => leg.steps || []);
  let nearestStepIndex = 0;
  let nearestStepDistance = Infinity;
  steps.forEach((step, index) => {
    const nearest = nearestOnLine(location, step.geometry?.coordinates);
    if (nearest && nearest.distance < nearestStepDistance) {
      nearestStepDistance = nearest.distance;
      nearestStepIndex = index;
    }
  });
  const nextStepIndex = Math.min(nearestStepIndex + 1, Math.max(0, steps.length - 1));
  const nextStep = steps[nextStepIndex];
  const maneuver = nextStep?.maneuver?.location;
  const distanceToManeuver = Array.isArray(maneuver)
    ? distanceBetweenPointsMeters(location, { lon: maneuver[0], lat: maneuver[1] })
    : null;
  const progress = nearestRoute.alongDistance / Math.max(1, nearestRoute.totalDistance);
  const routeDistance = Number(route.distance || nearestRoute.totalDistance);
  return {
    offRouteMeters: nearestRoute.distance,
    progress: Math.max(0, Math.min(1, progress)),
    remainingDistanceMeters: Math.max(0, routeDistance * (1 - progress)),
    remainingDurationSeconds: Math.max(0, Number(route.duration || 0) * (1 - progress)),
    stepIndex: nextStepIndex,
    instruction: nextStep?.maneuver?.instruction || nextStep?.name || "Continuá por la ruta",
    distanceToManeuver
  };
}
export function shouldRerouteDriver({ offRouteMeters, lastRerouteAt = 0, now = Date.now(), thresholdMeters = 65, cooldownMs = 90000 } = {}) {
  return Number(offRouteMeters) > thresholdMeters && Number(now) - Number(lastRerouteAt) >= cooldownMs;
}
