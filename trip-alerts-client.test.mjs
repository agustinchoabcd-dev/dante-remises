import test from "node:test";
import assert from "node:assert/strict";
import { notifyDriverForTrip, registerDriverPushDevice, unregisterDriverPushDevice } from "./trip-alerts-client.mjs";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("registers an Android FCM token using the authenticated Worker route", async () => {
  let request;
  const result = await registerDriverPushDevice({
    apiBaseUrl: "https://worker.example",
    idToken: "firebase-id-token-long-enough",
    token: "fcm-device-registration-token",
    appVersion: "0.6.1",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return response(200, { registered: true, carId: "144" });
    }
  });
  assert.equal(request.url, "https://worker.example/v1/trips/register-device");
  assert.equal(request.init.headers.Authorization, "Bearer firebase-id-token-long-enough");
  assert.deepEqual(JSON.parse(request.init.body), {
    token: "fcm-device-registration-token",
    appVersion: "0.6.1"
  });
  assert.deepEqual(result, { registered: true, carId: "144" });
});

test("notifies the driver only by trip id and authenticated passenger token", async () => {
  let request;
  const result = await notifyDriverForTrip({
    apiBaseUrl: "https://worker.example/",
    idToken: "firebase-id-token-long-enough",
    tripId: "trip-123",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return response(200, { pushAccepted: 1, deviceRegistered: true });
    }
  });
  assert.equal(request.url, "https://worker.example/v1/trips/notify-driver");
  assert.deepEqual(JSON.parse(request.init.body), { tripId: "trip-123" });
  assert.equal(result.pushAccepted, 1);
});

test("rejects invalid trip ids before network access", async () => {
  let called = false;
  await assert.rejects(
    notifyDriverForTrip({
      apiBaseUrl: "https://worker.example",
      idToken: "firebase-id-token-long-enough",
      tripId: "../other",
      fetchImpl: async () => { called = true; return response(200, {}); }
    }),
    /tripId inválido/
  );
  assert.equal(called, false);
});

test("surfaces backend failures without converting them to successful delivery", async () => {
  await assert.rejects(
    registerDriverPushDevice({
      apiBaseUrl: "https://worker.example",
      idToken: "firebase-id-token-long-enough",
      token: "fcm-device-registration-token",
      fetchImpl: async () => response(502, { error: "FCM unavailable" })
    }),
    error => error.status === 502 && error.message === "FCM unavailable"
  );
});

test("unregisters a device using the same authenticated contract", async () => {
  let body;
  const result = await unregisterDriverPushDevice({
    apiBaseUrl: "https://worker.example",
    idToken: "firebase-id-token-long-enough",
    token: "fcm-device-registration-token",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return response(200, { unregistered: true });
    }
  });
  assert.deepEqual(body, { token: "fcm-device-registration-token" });
  assert.equal(result.unregistered, true);
});
