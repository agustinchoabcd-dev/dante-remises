import test from "node:test";
import assert from "node:assert/strict";
import { getDriverNavigationStage, getDriverNavigationTarget, distanceBetweenPointsMeters, getDriverNavigationProgress, shouldRerouteDriver } from "./driver-navigation-state.mjs";

test("navigation changes from pickup to destination only when the trip starts", () => {
  const trip = { status: "accepted", origin: { lat: -32, lon: -64 }, destination: { lat: -32.1, lon: -64.1 } };
  assert.equal(getDriverNavigationStage(trip), "pickup");
  assert.deepEqual(getDriverNavigationTarget(trip), { stage: "pickup", point: { lat: -32, lon: -64 }, label: "Punto de recogida" });
  assert.equal(getDriverNavigationStage({ ...trip, status: "in_progress" }), "destination");
  assert.deepEqual(getDriverNavigationTarget({ ...trip, status: "in_progress" }).point, { lat: -32.1, lon: -64.1 });
  assert.equal(getDriverNavigationStage({ ...trip, status: "completed" }), null);
});

test("invalid or missing target coordinates do not produce a route target", () => {
  assert.equal(getDriverNavigationTarget({ status: "accepted", origin: { label: "Centro" } }), null);
});

test("distance calculation is symmetric and returns zero for identical points", () => {
  const a = { lat: -32.07, lon: -64.53 }, b = { lat: -32.08, lon: -64.54 };
  assert.equal(distanceBetweenPointsMeters(a, a), 0);
  assert.ok(distanceBetweenPointsMeters(a, b) > 0);
  assert.ok(Math.abs(distanceBetweenPointsMeters(a, b) - distanceBetweenPointsMeters(b, a)) < 0.001);
});

test("route progress returns nearest route point and next localized maneuver", () => {
  const route = {
    distance: 1000, duration: 600,
    geometry: { coordinates: [[-64, -32], [-64.005, -32], [-64.01, -32]] },
    legs: [{ steps: [
      { geometry: { coordinates: [[-64, -32], [-64.005, -32]] }, maneuver: { instruction: "Continuá derecho", location: [-64.005, -32] } },
      { geometry: { coordinates: [[-64.005, -32], [-64.01, -32]] }, maneuver: { instruction: "Girás a la derecha", location: [-64.01, -32] } }
    ] }]
  };
  const progress = getDriverNavigationProgress(route, { lat: -32, lon: -64.005 });
  assert.equal(progress.instruction, "Girás a la derecha");
  assert.ok(progress.offRouteMeters < 1);
  assert.ok(progress.remainingDistanceMeters >= 0);
});

test("rerouting is distance-gated and throttled", () => {
  assert.equal(shouldRerouteDriver({ offRouteMeters: 50, lastRerouteAt: 0, now: 30000 }), false);
  assert.equal(shouldRerouteDriver({ offRouteMeters: 80, lastRerouteAt: 20000, now: 30000 }), false);
  assert.equal(shouldRerouteDriver({ offRouteMeters: 80, lastRerouteAt: 0, now: 30000, cooldownMs: 20000 }), true);
  assert.equal(shouldRerouteDriver({ offRouteMeters: 80, lastRerouteAt: 0, now: 30000 }), false);
  assert.equal(shouldRerouteDriver({ offRouteMeters: 80, lastRerouteAt: 0, now: 60000 }), true);
});
