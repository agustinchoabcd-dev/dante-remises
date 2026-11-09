const MAX_EVENTS = 120;
const ALLOWED_TYPES = new Set([
  "app.start", "app.visibility", "auth.state", "auth.role.error",
  "firebase.cars.listener.attached", "firebase.cars.first_snapshot",
  "firebase.cars.snapshot", "firebase.cars.error", "firebase.cars.ready",
  "firebase.presence.listener.attached", "firebase.presence.snapshot",
  "firebase.presence.error", "firebase.status.write.start",
  "firebase.status.write.success", "firebase.status.write.error",
  "js.error", "js.unhandled_rejection"
]);
const ALLOWED_DETAILS = new Set([
  "phase", "code", "name", "children", "carId", "status", "online",
  "connected", "role", "elapsedMs", "count", "authenticated",
  "summary", "networkOnline", "ready", "durationMs"
]);

function cleanDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!ALLOWED_DETAILS.has(key)) continue;
    if (typeof raw === "boolean") clean[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) clean[key] = Math.max(0, Math.min(raw, 10_000_000));
    else if (typeof raw === "string") {
      const text = raw.slice(0, key === "summary" ? 120 : 64);
      if (/^[A-Za-z0-9_.:,|+ -]*$/.test(text)) clean[key] = text;
    }
  }
  return clean;
}

function makeClientInfo(runtime) {
  const ua = String(runtime.navigator?.userAgent || "");
  const platform = /Android/i.test(ua) ? "android"
    : /iPhone|iPad|iPod/i.test(ua) ? "ios"
      : ua ? "web" : "unknown";
  const browser = ua.match(/(?:Chrome|CriOS|Firefox|Version)\/(\d+)/i);
  return {
    appVersion: "0.6.0",
    build: String(runtime.__DANTE_BUILD__ || "unreported").slice(0, 24),
    platform,
    browserMajor: browser ? Number(browser[1]) : 0,
    networkOnline: typeof runtime.navigator?.onLine === "boolean" ? runtime.navigator.onLine : null
  };
}

export function createDiagnosticsMonitor({
  runtime = globalThis,
  fetchImpl = (...args) => runtime.fetch(...args),
  now = () => Date.now(),
  randomUUID = () => runtime.crypto?.randomUUID?.() || (() => {
    const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
  })()
} = {}) {
  const startedAt = now();
  const sessionId = `s${startedAt.toString(36)}-${randomUUID()}`;
  const events = [];
  let revision = 0;
  let uploadedRevision = 0;
  let endpoint = "";
  let getToken = null;
  let getContext = null;
  let client = makeClientInfo(runtime);
  let timer = null;
  let inFlight = null;

  const setTimer = runtime.setTimeout?.bind(runtime) || setTimeout;
  const clearTimer = runtime.clearTimeout?.bind(runtime) || clearTimeout;

  function schedule(delay = 8000) {
    if (!endpoint || !getToken || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, delay);
  }

  function mark(type, details = {}) {
    if (!ALLOWED_TYPES.has(type)) return false;
    events.push({ at: now(), type, details: cleanDetails(details) });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    revision++;
    schedule(revision - uploadedRevision >= 8 ? 500 : 8000);
    return true;
  }

  function configure(options = {}) {
    if (typeof options.endpoint === "string") endpoint = options.endpoint.replace(/\/$/, "");
    if (typeof options.getToken === "function") getToken = options.getToken;
    if (typeof options.getContext === "function") getContext = options.getContext;
    if (options.client && typeof options.client === "object") {
      client = { ...client, ...options.client };
    }
    schedule(0);
  }

  async function flush() {
    if (!endpoint || !getToken || !events.length || revision <= uploadedRevision) return false;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const token = await getToken();
        if (!token) return false;
        const revisionAtSend = revision;
        const context = typeof getContext === "function" ? getContext() || {} : {};
        const payload = {
          sessionId,
          startedAt,
          client: { ...client, networkOnline: typeof runtime.navigator?.onLine === "boolean" ? runtime.navigator.onLine : client.networkOnline },
          context: {
            role: typeof context.role === "string" ? context.role : "unknown",
            carId: typeof context.carId === "string" ? context.carId : ""
          },
          events: events.slice(-MAX_EVENTS)
        };
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          cache: "no-store",
          credentials: "omit",
          keepalive: true
        });
        if (!response?.ok) return false;
        uploadedRevision = revisionAtSend;
        return true;
      } catch {
        return false;
      } finally {
        inFlight = null;
        if (revision > uploadedRevision) schedule(5000);
      }
    })();
    return inFlight;
  }

  runtime.addEventListener?.("error", event => {
    mark("js.error", { name: event?.error?.name || "Error" });
  });
  runtime.addEventListener?.("unhandledrejection", event => {
    mark("js.unhandled_rejection", { name: event?.reason?.name || "PromiseRejection" });
  });
  runtime.addEventListener?.("pagehide", () => { void flush(); });
  runtime.document?.addEventListener?.("visibilitychange", () => {
    const phase = runtime.document.visibilityState === "hidden" ? "hidden" : "visible";
    mark("app.visibility", { phase });
    if (phase === "hidden") void flush();
  });

  return {
    configure,
    mark,
    flush,
    sessionId,
    startedAt,
    snapshot: () => events.map(event => ({ ...event, details: { ...event.details } })),
    get pendingCount() { return Math.max(0, revision - uploadedRevision); }
  };
}

export const diagnostics = createDiagnosticsMonitor();
