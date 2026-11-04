import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/workers/dante-remises-chat-candidate.js";

test("chat preflight is handled by the chat router before the legacy global OPTIONS handler", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/v1/chat/conversations", {
    method: "OPTIONS",
    headers: { Origin: "https://app.example.test" }
  }), { APP_ORIGIN: "https://app.example.test" });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.test");
  assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Authorization/i);
});

test("chat routes reject unapproved browser origins", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/v1/chat/conversations", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" }
  }), { APP_ORIGIN: "https://app.example.test" });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("chat API requests retain chat CORS headers and require Firebase authentication", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/v1/chat/conversations", {
    method: "GET",
    headers: { Origin: "https://app.example.test" }
  }), {
    APP_ORIGIN: "https://app.example.test",
    FIREBASE_PROJECT_ID: "dante-chat-test",
    FIREBASE_SERVICE_ACCOUNT_EMAIL: "test@dante-chat-test.iam.gserviceaccount.com",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-only-placeholder-not-used-without-a-bearer-token",
    ADMIN_UID: "test-admin"
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.test");
});

test("legacy health route remains available through the B2 Worker", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/health"), {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.testConfigured, false);
  assert.equal(body.passengerPhotoConfigured, false);
});

test("legacy profile-photo route remains isolated and reports missing test configuration", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/v1/profile-photo/read-url"), {});
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "Profile photo configuration is incomplete");
});

test("scheduled entry point delegates cleanup to the chat module without running it inline", async () => {
  let scheduledPromise = null;
  const ctx = { waitUntil(promise) { scheduledPromise = promise; } };

  await worker.scheduled({}, {}, ctx);

  assert.ok(scheduledPromise instanceof Promise);
  const result = await scheduledPromise;
  assert.deepEqual(result, { deletedBlocks: 0, failed: 1 });
});
