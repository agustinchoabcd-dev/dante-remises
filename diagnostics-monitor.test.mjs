import test from "node:test";
import assert from "node:assert/strict";
import { createDiagnosticsMonitor } from "./diagnostics-monitor.mjs";

function fakeRuntime() {
  const listeners = {};
  const documentListeners = {};
  return {
    listeners,
    documentListeners,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    document: {
      visibilityState: "visible",
      addEventListener: (name, callback) => { documentListeners[name] = callback; }
    },
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0 Mobile", onLine: true },
    crypto: { randomUUID: () => "123e4567-e89b-12d3-a456-426614174000" },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
}

test("diagnostics monitor captures only allowlisted events and scalar details", () => {
  const runtime = fakeRuntime();
  const monitor = createDiagnosticsMonitor({ runtime, now: () => 1_800_000_000_000 });
  monitor.mark("firebase.cars.error", {
    code: "PERMISSION_DENIED",
    message: "private content",
    uid: "private-uid",
    token: "private-token",
    summary: "144:libre|137:desconectado"
  });
  monitor.mark("chat.message", { message: "must not be captured" });

  const events = monitor.snapshot();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].details, {
    code: "PERMISSION_DENIED",
    summary: "144:libre|137:desconectado"
  });
  assert.equal(JSON.stringify(events).includes("private-uid"), false);
  assert.equal(JSON.stringify(events).includes("private-token"), false);
  assert.equal(JSON.stringify(events).includes("private content"), false);
});

test("diagnostics monitor bounds its in-memory event buffer", () => {
  const runtime = fakeRuntime();
  const monitor = createDiagnosticsMonitor({ runtime, now: () => 1_800_000_000_000 });
  for (let i = 0; i < 90; i++) monitor.mark("app.start", { count: i });
  assert.equal(monitor.snapshot().length, 80);
  assert.equal(monitor.snapshot()[0].details.count, 10);
});

test("diagnostics upload uses Firebase bearer token and excludes identity fields", async () => {
  const runtime = fakeRuntime();
  let sent = null;
  const monitor = createDiagnosticsMonitor({
    runtime,
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 202 };
    }
  });
  monitor.mark("auth.state", { authenticated: true, role: "passenger", uid: "private-uid" });
  monitor.configure({
    endpoint: "https://worker.example.test/v1/chat/diagnostics",
    getToken: async () => "firebase-id-token",
    getContext: () => ({ role: "passenger", uid: "private-uid" })
  });
  assert.equal(await monitor.flush(), true);
  assert.equal(sent.url, "https://worker.example.test/v1/chat/diagnostics");
  assert.equal(sent.options.headers.Authorization, "Bearer firebase-id-token");
  assert.equal(sent.body.client.platform, "android");
  assert.equal("uid" in sent.body.context, false);
  assert.equal(JSON.stringify(sent.body).includes("private-uid"), false);
  assert.equal(monitor.pendingCount, 0);
});

test("diagnostics upload remains pending when no authenticated user is available", async () => {
  const runtime = fakeRuntime();
  const monitor = createDiagnosticsMonitor({ runtime, fetchImpl: async () => { throw new Error("must not fetch"); } });
  monitor.mark("app.start");
  monitor.configure({ endpoint: "https://worker.example.test/v1/chat/diagnostics", getToken: async () => null });
  assert.equal(await monitor.flush(), false);
  assert.equal(monitor.pendingCount, 1);
});
