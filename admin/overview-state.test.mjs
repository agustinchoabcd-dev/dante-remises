import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminOverviewModel, formatAdminOverviewTime } from "./overview-state.mjs";

const today = new Date(2026, 10, 24, 12, 0, 0).getTime();
const at = (hour, day = 24) => new Date(2026, 10, day, hour, 0, 0).getTime();

test("fleet counts manual availability separately from connection", () => {
  const model = buildAdminOverviewModel({
    now: today,
    cars: [
      { id: "144", status: "libre", online: true },
      { id: "137", status: "ocupado", online: true },
      { id: "104", status: "fuera", online: false },
      { id: "109", status: "libre", online: false }
    ]
  });
  assert.deepEqual(model.fleet, { free: 2, busy: 1, outOfService: 1, disconnected: 2, total: 4 });
});

test("expired temporary status is treated as free", () => {
  const model = buildAdminOverviewModel({
    now: today,
    cars: [{ status: "ocupado", until: today - 1000, online: true }]
  });
  assert.equal(model.fleet.free, 1);
  assert.equal(model.fleet.busy, 0);
});

test("trip metrics use known lifecycle states and local calendar day", () => {
  const model = buildAdminOverviewModel({
    now: today,
    trips: {
      a: { status: "requested", createdAt: at(9) },
      b: { status: "accepted", createdAt: at(10) },
      c: { status: "in_progress", createdAt: at(11) },
      d: { status: "completed", createdAt: at(8), updatedAt: at(12) },
      e: { status: "cancelled", createdAt: at(8), updatedAt: at(13) },
      f: { status: "completed", createdAt: at(8, 23), updatedAt: at(13, 23) },
      g: { status: "rejected", createdAt: at(11) }
    }
  });
  assert.deepEqual(model.stats, { todayTrips: 6, activeTrips: 2, completedToday: 1, cancelledToday: 1 });
  assert.equal(model.pendingRequests, 1);
});

test("activity returns at most four most recently updated trips", () => {
  const model = buildAdminOverviewModel({
    now: today,
    trips: Object.fromEntries([1, 2, 3, 4, 5].map(hour => [String(hour), {
      status: "completed", passengerName: "Pasajero " + hour, createdAt: at(hour), updatedAt: at(hour)
    }]))
  });
  assert.equal(model.activity.length, 4);
  assert.equal(model.activity[0].passengerName, "Pasajero 5");
});

test("invalid timestamps are rendered safely", () => {
  assert.equal(formatAdminOverviewTime(null), "Fecha no disponible");
});
