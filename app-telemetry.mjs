const SAFE_TARGET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function targetMetadata(target) {
  const element = target?.closest?.("button,input,select,textarea,a,[role='button'],[data-action]");
  if (!element) return null;
  const id = typeof element.id === "string" && SAFE_TARGET_ID.test(element.id) ? element.id : "";
  const tag = String(element.tagName || "").toLowerCase();
  const action = typeof element.dataset?.action === "string" && SAFE_TARGET_ID.test(element.dataset.action)
    ? element.dataset.action : "";
  return { target: id || tag || "unknown", tag, action };
}

function serviceForUrl(value, base) {
  try {
    const url = new URL(typeof value === "string" ? value : value?.url || "", base);
    const host = url.hostname.toLowerCase();
    if (host.endsWith("firebaseio.com") || host.endsWith("firebasedatabase.app")) return "firebase.rtdb";
    if (host.endsWith("workers.dev")) return "cloudflare.worker";
    if (host.includes("locationiq.com")) return "locationiq";
    if (host.includes("openstreetmap.org")) return "openstreetmap";
    if (host.endsWith("googleapis.com") || host.endsWith("gstatic.com")) return "google";
    if (host === new URL(base).hostname) return "app.same-origin";
    return "external";
  } catch {
    return "unknown";
  }
}

export function installAppTelemetry({ runtime = globalThis, monitor } = {}) {
  if (!monitor || typeof monitor.mark !== "function") throw new TypeError("A diagnostics monitor is required");
  const doc = runtime.document;
  const removers = [];
  const listen = (target, type, handler, options) => {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  };

  listen(doc, "click", event => {
    const meta = targetMetadata(event.target);
    if (meta) monitor.mark("ui.click", meta);
  }, true);
  listen(doc, "change", event => {
    const meta = targetMetadata(event.target);
    if (meta) monitor.mark("ui.change", meta);
  }, true);
  listen(doc, "submit", event => {
    const meta = targetMetadata(event.target);
    if (meta) monitor.mark("ui.submit", meta);
  }, true);
  listen(runtime, "online", () => monitor.mark("network.online", { networkOnline: true }));
  listen(runtime, "offline", () => monitor.mark("network.offline", { networkOnline: false }));
  listen(runtime, "pageshow", () => monitor.mark("app.lifecycle", { phase: "pageshow" }));
  listen(runtime, "pagehide", () => monitor.mark("app.lifecycle", { phase: "pagehide" }));

  if (typeof runtime.fetch === "function") {
    const originalFetch = runtime.fetch;
    runtime.fetch = async function(...args) {
      const startedAt = Date.now();
      const service = serviceForUrl(args[0], runtime.location?.href || "https://localhost/");
      const request = args[1] || {};
      const method = String(request.method || args[0]?.method || "GET").toUpperCase();
      const safeMethod = /^[A-Z]{3,8}$/.test(method) ? method : "OTHER";
      monitor.mark("network.fetch.start", { service, method: safeMethod });
      try {
        const response = await originalFetch.apply(this, args);
        monitor.mark("network.fetch.end", {
          service, method: safeMethod, statusCode: response.status,
          ok: response.ok, durationMs: Math.max(0, Date.now() - startedAt)
        });
        return response;
      } catch (error) {
        monitor.mark("network.fetch.error", {
          service, method: safeMethod, errorType: error?.name || "NetworkError",
          durationMs: Math.max(0, Date.now() - startedAt)
        });
        throw error;
      }
    };
    removers.push(() => { runtime.fetch = originalFetch; });
  }

  const originalError = runtime.console?.error?.bind(runtime.console);
  const originalWarn = runtime.console?.warn?.bind(runtime.console);
  if (originalError) runtime.console.error = (...args) => {
    originalError(...args);
    const error = args.find(value => value instanceof Error);
    monitor.mark("console.error", { errorType: error?.name || "LoggedError" });
  };
  if (originalWarn) runtime.console.warn = (...args) => {
    originalWarn(...args);
    const error = args.find(value => value instanceof Error);
    monitor.mark("console.warn", { errorType: error?.name || "LoggedWarning" });
  };
  if (originalError) removers.push(() => { runtime.console.error = originalError; });
  if (originalWarn) removers.push(() => { runtime.console.warn = originalWarn; });

  let observer = null;
  try {
    if (typeof runtime.PerformanceObserver === "function") {
      observer = new runtime.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          monitor.mark("performance.longtask", {
            durationMs: Math.max(0, Math.round(entry.duration)),
            elapsedMs: Math.max(0, Math.round(entry.startTime))
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      removers.push(() => observer.disconnect());
    }
  } catch {
    monitor.mark("performance.longtask", { errorType: "ObserverUnavailable" });
  }

  return () => {
    for (const remove of removers.splice(0)) {
      try { remove(); } catch {}
    }
  };
}
