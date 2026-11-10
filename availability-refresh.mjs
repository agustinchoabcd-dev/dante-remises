/**
 * Schedules UI refreshes only while timed availability states exist.
 * The display needs a refresh at the next minute boundary and at the exact
 * expiry, not an unconditional full render every few seconds.
 */
export function createAvailabilityRefreshScheduler({
  getDeadlines,
  onRefresh,
  now = () => Date.now(),
  setTimeoutImpl = (callback, delay) => setTimeout(callback, delay),
  clearTimeoutImpl = timer => clearTimeout(timer),
  minuteMs = 60_000,
  safetyMs = 25
} = {}) {
  if (typeof getDeadlines !== "function") throw new TypeError("getDeadlines must be a function");
  if (typeof onRefresh !== "function") throw new TypeError("onRefresh must be a function");

  let timer = null;

  function stop() {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  }

  function schedule() {
    stop();

    const current = Number(now());
    if (!Number.isFinite(current)) return null;

    const deadlines = getDeadlines()
      .map(Number)
      .filter(value => Number.isFinite(value) && value > current);

    if (!deadlines.length) return null;

    const nearestExpiry = Math.min(...deadlines);
    const nextMinute = current + (minuteMs - (current % minuteMs));
    const nextRefreshAt = Math.min(nearestExpiry, nextMinute);
    const delay = Math.max(0, nextRefreshAt - current + safetyMs);

    timer = setTimeoutImpl(() => {
      timer = null;
      onRefresh();
    }, delay);

    return delay;
  }

  return {
    schedule,
    stop,
    get scheduled() {
      return timer !== null;
    }
  };
}
