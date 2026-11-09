import test from "node:test";
import assert from "node:assert/strict";
import { createAvailabilityRefreshScheduler } from "./availability-refresh.mjs";

function fakeClock(start = 12_345) {
  let current = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => current,
    timers,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      current += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.delay <= ms) {
          timers.delete(id);
          timer.callback();
        }
      }
    }
  };
}

test("does not schedule any render when no timed availability exists", () => {
  const clock = fakeClock();
  let renders = 0;
  const scheduler = createAvailabilityRefreshScheduler({
    getDeadlines: () => [null, 0, Number.NaN],
    onRefresh: () => renders++,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout
  });

  assert.equal(scheduler.schedule(), null);
  assert.equal(scheduler.scheduled, false);
  assert.equal(clock.timers.size, 0);
  assert.equal(renders, 0);
});

test("schedules at the next minute boundary rather than polling every ten seconds", () => {
  const clock = fakeClock(12_345);
  const scheduler = createAvailabilityRefreshScheduler({
    getDeadlines: () => [200_000],
    onRefresh: () => {},
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout
  });

  assert.equal(scheduler.schedule(), 47_680);
  assert.equal([...clock.timers.values()][0].delay, 47_680);
});

test("uses the expiry time when it comes before the next minute boundary", () => {
  const clock = fakeClock(12_345);
  let renders = 0;
  const scheduler = createAvailabilityRefreshScheduler({
    getDeadlines: () => [20_000, 80_000],
    onRefresh: () => renders++,
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout
  });

  assert.equal(scheduler.schedule(), 7_680);
  clock.advance(7_680);
  assert.equal(renders, 1);
  assert.equal(scheduler.scheduled, false);
});

test("rescheduling replaces the previous timer and stop cancels it", () => {
  const clock = fakeClock();
  let deadlines = [200_000];
  const scheduler = createAvailabilityRefreshScheduler({
    getDeadlines: () => deadlines,
    onRefresh: () => {},
    now: clock.now,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout
  });

  scheduler.schedule();
  assert.equal(clock.timers.size, 1);
  deadlines = [];
  assert.equal(scheduler.schedule(), null);
  assert.equal(clock.timers.size, 0);

  deadlines = [200_000];
  scheduler.schedule();
  scheduler.stop();
  assert.equal(scheduler.scheduled, false);
  assert.equal(clock.timers.size, 0);
});
