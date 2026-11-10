import test from "node:test";
import assert from "node:assert/strict";
import { installAppTelemetry } from "./app-telemetry.mjs";

function fakeRuntime() {
  const listeners = {};
  const documentListeners = {};
  const consoleCalls = [];
  const runtime = {
    listeners, documentListeners, consoleCalls,
    location: { href: "https://localhost/" },
    navigator: { onLine: true },
    addEventListener(type, callback) { listeners[type] = callback; },
    removeEventListener(type) { delete listeners[type]; },
    document: {
      addEventListener(type, callback) { documentListeners[type] = callback; },
      removeEventListener(type) { delete documentListeners[type]; }
    },
    fetch: async () => ({ ok: true, status: 200 }),
    console: {
      error(...args) { consoleCalls.push(["error", ...args]); },
      warn(...args) { consoleCalls.push(["warn", ...args]); }
    }
  };
  return runtime;
}

test("captures UI events without recording input values or visible text", () => {
  const runtime = fakeRuntime();
  const events = [];
  const stop = installAppTelemetry({ runtime, monitor: { mark: (type, details) => events.push({ type, details }) } });
  runtime.documentListeners.click({ target: { closest: () => ({ id: "loginButton", tagName: "BUTTON", dataset: {} }) } });
  runtime.documentListeners.change({ target: { closest: () => ({ id: "passengerPhone", tagName: "INPUT", value: "private-phone", dataset: {} }) } });
  assert.deepEqual(events.map(x => x.type), ["ui.click", "ui.change"]);
  assert.equal(JSON.stringify(events).includes("private-phone"), false);
  stop();
});

test("captures fetch service, method, status and duration without URL or body", async () => {
  const runtime = fakeRuntime();
  const events = [];
  const stop = installAppTelemetry({ runtime, monitor: { mark: (type, details) => events.push({ type, details }) } });
  await runtime.fetch("https://example.firebaseio.com/profiles/private-uid.json?auth=secret-token", { method: "GET" });
  assert.deepEqual(events.map(x => x.type), ["network.fetch.start", "network.fetch.end"]);
  assert.equal(events[0].details.service, "firebase.rtdb");
  assert.equal(events[1].details.statusCode, 200);
  assert.equal(JSON.stringify(events).includes("private-uid"), false);
  assert.equal(JSON.stringify(events).includes("secret-token"), false);
  stop();
});

test("captures network failures by error type, not message", async () => {
  const runtime = fakeRuntime();
  runtime.fetch = async () => { throw new TypeError("private request URL and token"); };
  const events = [];
  const stop = installAppTelemetry({ runtime, monitor: { mark: (type, details) => events.push({ type, details }) } });
  await assert.rejects(runtime.fetch("https://example.com/private"), /private request/);
  assert.equal(events.at(-1).type, "network.fetch.error");
  assert.equal(events.at(-1).details.errorType, "TypeError");
  assert.equal(JSON.stringify(events).includes("private request"), false);
  stop();
});

test("captures console errors without serializing their messages", () => {
  const runtime = fakeRuntime();
  const events = [];
  const stop = installAppTelemetry({ runtime, monitor: { mark: (type, details) => events.push({ type, details }) } });
  runtime.console.error(new Error("private passenger details"));
  assert.equal(events[0].type, "console.error");
  assert.equal(events[0].details.errorType, "Error");
  assert.equal(JSON.stringify(events).includes("private passenger"), false);
  stop();
});


test("does not instrument its own diagnostics upload endpoint", async () => {
  const runtime = fakeRuntime();
  let fetches = 0;
  runtime.fetch = async () => { fetches++; return { ok: true, status: 202 }; };
  const events = [];
  const stop = installAppTelemetry({ runtime, monitor: { mark: (type, details) => events.push({ type, details }) } });
  await runtime.fetch("https://worker.example.test/v1/chat/diagnostics", { method: "POST" });
  assert.equal(fetches, 1);
  assert.equal(events.length, 0);
  stop();
});
