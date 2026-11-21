export function getPendingDriverInboxEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, item]) => item && typeof item === "object" &&
      item.status === "requested" && typeof item.tripId === "string" && item.tripId.trim())
    .map(([inboxKey, item]) => ({ inboxKey, tripId: item.tripId.trim() }));
}

export async function loadPendingDriverTrips(value, loadTrip) {
  if (typeof loadTrip !== "function") throw new TypeError("loadTrip must be a function");
  const pending = getPendingDriverInboxEntries(value);
  const trips = await Promise.all(pending.map(async ({ tripId }) => {
    const trip = await loadTrip(tripId);
    if (!trip || trip.status !== "requested") return null;
    return { ...trip, tripId };
  }));
  return trips.filter(Boolean);
}
