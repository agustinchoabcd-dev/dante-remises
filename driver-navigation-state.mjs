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

function pointToSegmentDistance(point, a, b, minFraction = 0, maxFraction = 1) {
  const latitude = Number(point.lat), longitude = Number(point.lon);
  const aLat = Number(a[1]), aLon = Number(a[0]), bLat = Number(b[1]), bLon = Number(b[0]);
  const scaleY = EARTH_RADIUS_METERS * Math.PI / 180, scaleX = scaleY * Math.cos(latitude * Math.PI / 180);
  const ax = (aLon-longitude)*scaleX, ay=(aLat-latitude)*scaleY, bx=(bLon-longitude)*scaleX, by=(bLat-latitude)*scaleY;
  const dx=bx-ax,dy=by-ay,lengthSquared=dx*dx+dy*dy,projected=lengthSquared?-(ax*dx+ay*dy)/lengthSquared:0;
  const fraction=Math.max(minFraction,Math.min(maxFraction,projected));
  return {distance:Math.hypot(ax+fraction*dx,ay+fraction*dy),fraction};
}

function nearestOnLine(point, coordinates, minAlongDistance = 0, maxAlongDistance = Infinity) {
  if(!Array.isArray(coordinates)||coordinates.length<2)return null;
  let nearestDistance=Infinity,alongDistance=0,totalDistance=0;
  for(let index=0;index<coordinates.length-1;index++){
    const a=coordinates[index],b=coordinates[index+1],segmentLength=distanceBetweenPointsMeters({lat:a[1],lon:a[0]},{lat:b[1],lon:b[0]});
    const segmentStart=totalDistance,segmentEnd=segmentStart+segmentLength;totalDistance=segmentEnd;
    if(segmentEnd<minAlongDistance||segmentStart>maxAlongDistance)continue;
    const minFraction=segmentLength?Math.max(0,Math.min(1,(minAlongDistance-segmentStart)/segmentLength)):0;
    const maxFraction=segmentLength?Math.max(0,Math.min(1,(maxAlongDistance-segmentStart)/segmentLength)):1;
    if(minFraction>maxFraction)continue;
    const projection=pointToSegmentDistance(point,a,b,minFraction,maxFraction);
    if(projection.distance<nearestDistance){nearestDistance=projection.distance;alongDistance=segmentStart+segmentLength*projection.fraction}
  }
  return Number.isFinite(nearestDistance)?{distance:nearestDistance,alongDistance,totalDistance}:null;
}

export function getDriverNavigationProgress(route, location, options = {}) {
  const coordinates=route?.geometry?.type==="MultiLineString"?route.geometry.coordinates.flat():route?.geometry?.coordinates;
  if(!Array.isArray(coordinates)||coordinates.length<2||!location)return null;
  const globalNearest=nearestOnLine(location,coordinates);if(!globalNearest)return null;
  const previous=Number(options.previousProgress),hasPrevious=Number.isFinite(previous)&&previous>=0&&previous<=1;
  const previousAlong=hasPrevious?previous*globalNearest.totalDistance:0,maxForward=Math.max(250,Number(options.maxForwardMeters)||500);
  const localNearest=hasPrevious?nearestOnLine(location,coordinates,Math.max(0,previousAlong-25),Math.min(globalNearest.totalDistance,previousAlong+maxForward)):globalNearest;
  if(!localNearest)return null;
  const along=hasPrevious?Math.max(previousAlong,localNearest.alongDistance):localNearest.alongDistance;
  const progress=Math.max(0,Math.min(1,along/Math.max(1,globalNearest.totalDistance)));
  const steps=(route.legs||[]).flatMap(leg=>leg.steps||[]),previousStep=Number(options.previousStepIndex);
  const hasPreviousStep=Number.isInteger(previousStep)&&previousStep>=0&&previousStep<steps.length;
  const maxStepAdvance=Math.max(2,Math.min(10,Number(options.maxStepAdvance)||3));
  const minStep=hasPreviousStep?Math.max(0,previousStep-1):0,maxStep=hasPreviousStep?Math.min(steps.length-1,previousStep+maxStepAdvance):steps.length-1;
  let nearestStepIndex=hasPreviousStep?previousStep:0,nearestStepDistance=Infinity;
  for(let index=minStep;index<=maxStep;index++){const nearest=nearestOnLine(location,steps[index]?.geometry?.coordinates);if(nearest&&nearest.distance<nearestStepDistance){nearestStepDistance=nearest.distance;nearestStepIndex=index}}
  const nextStepIndex=steps.length?Math.min(Math.max(nearestStepIndex+1,hasPreviousStep?previousStep:0),steps.length-1):0;
  const nextStep=steps[nextStepIndex],maneuver=nextStep?.maneuver?.location;
  const distanceToManeuver=Array.isArray(maneuver)?distanceBetweenPointsMeters(location,{lon:maneuver[0],lat:maneuver[1]}):null;
  const routeDistance=Number(route.distance||globalNearest.totalDistance);
  return {offRouteMeters:globalNearest.distance,progress,remainingDistanceMeters:Math.max(0,routeDistance*(1-progress)),remainingDurationSeconds:Math.max(0,Number(route.duration||0)*(1-progress)),stepIndex:nextStepIndex,instruction:nextStep?.maneuver?.instruction||nextStep?.name||"Continuá por la ruta",distanceToManeuver};
}
export function shouldRerouteDriver({ offRouteMeters, lastRerouteAt = 0, now = Date.now(), thresholdMeters = 40, cooldownMs = 15000 } = {}) {
  return Number(offRouteMeters) > thresholdMeters && Number(now) - Number(lastRerouteAt) >= cooldownMs;
}
