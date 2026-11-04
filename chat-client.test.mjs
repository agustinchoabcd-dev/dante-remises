import test from "node:test";
import assert from "node:assert/strict";
import { ChatApiClient, ChatApiError, createClientMessageId, mergeChatMessagePages } from "./chat-client.mjs";

function makeClient(fetchImpl, token = "firebase-test-token") {
  return new ChatApiClient({
    baseUrl: "https://chat.example.test/",
    getIdToken: async () => token,
    fetchImpl
  });
}
function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("requires HTTPS outside localhost", () => {
  assert.throws(() => new ChatApiClient({
    baseUrl: "http://chat.example.test",
    getIdToken: async () => "token"
  }), /HTTPS/);
  assert.doesNotThrow(() => new ChatApiClient({
    baseUrl: "http://localhost:8787",
    getIdToken: async () => "token"
  }));
});

test("lists conversations with Firebase bearer token and opaque cursor", async () => {
  let request;
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ conversations: [], nextCursor: null, hasMore: false });
  });
  const result = await client.listConversations("cursor/with spaces");
  assert.equal(request.url, "https://chat.example.test/v1/chat/conversations?cursor=cursor%2Fwith%20spaces");
  assert.equal(request.options.headers.Authorization, "Bearer firebase-test-token");
  assert.equal(request.options.method, "GET");
  assert.deepEqual(result.conversations, []);
});

test("opens an operator support conversation with the expected contract", async () => {
  let request;
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ conversation: { conversationId: "conversation-1" } });
  });
  await client.openConversation({ target: "operators" });
  assert.equal(request.url, "https://chat.example.test/v1/chat/conversations");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { target: "operators" });
});

test("opens a driver conversation with target UID and optional trip context", async () => {
  let request;
  const client = makeClient(async (_url, options) => {
    request = options;
    return jsonResponse({ conversation: { conversationId: "conversation-2" } });
  });
  await client.openConversation({ target: "driver", targetUid: "driver-uid", tripId: "trip-1" });
  assert.deepEqual(JSON.parse(request.body), {
    target: "driver", targetUid: "driver-uid", tripId: "trip-1"
  });
});

test("loads messages using encoded conversation ID and cursor", async () => {
  let urlSeen;
  const client = makeClient(async url => {
    urlSeen = url;
    return jsonResponse({ messages: [], nextCursor: null, hasMore: false });
  });
  await client.listMessages("conv/one", "next key");
  const url = new URL(urlSeen);
  assert.equal(url.pathname, "/v1/chat/messages");
  assert.equal(url.searchParams.get("conversationId"), "conv/one");
  assert.equal(url.searchParams.get("cursor"), "next key");
});

test("sends trimmed text with a stable idempotency key", async () => {
  let request;
  const client = makeClient(async (_url, options) => {
    request = options;
    return jsonResponse({ message: { text: "Hola" } }, 201);
  });
  await client.sendMessage({
    conversationId: "conversation-1",
    text: "  Hola  ",
    clientMessageId: "message-id-123456"
  });
  assert.equal(request.method, "POST");
  assert.deepEqual(JSON.parse(request.body), {
    conversationId: "conversation-1",
    text: "Hola",
    clientMessageId: "message-id-123456"
  });
});

test("preserves HTTP status and Retry-After for rate limiting", async () => {
  const client = makeClient(async () => jsonResponse({ error: "Rate limited" }, 429, { "Retry-After": "10" }));
  await assert.rejects(
    client.listConversations(),
    error => error instanceof ChatApiError && error.status === 429 && error.retryAfter === "10"
  );
});

test("rejects missing authentication without sending a request", async () => {
  let called = false;
  const client = makeClient(async () => { called = true; return jsonResponse({}); }, "");
  await assert.rejects(client.listConversations(), error => error.status === 401);
  assert.equal(called, false);
});

test("generates a safe idempotency key", () => {
  const id = createClientMessageId({ randomUUID: () => "12345678-1234-4234-8234-123456789abc" });
  assert.equal(id, "12345678123442348234123456789abc");
  assert.match(id, /^[A-Za-z0-9_-]{8,128}$/);
});

test("rejects invalid message payloads before making a request", async () => {
  const client = makeClient(async () => jsonResponse({}));
  assert.throws(() => client.sendMessage({
    conversationId: "conversation-1", text: "   ", clientMessageId: "message-id-123456"
  }), /1-2000/);
  assert.throws(() => client.sendMessage({
    conversationId: "conversation-1", text: "Hola", clientMessageId: "short"
  }), /clientMessageId/);
});


test("merges paginated message pages chronologically and deduplicates overlapping IDs", () => {
  const current = [
    { messageId: "m2", createdAt: 200, text: "dos" },
    { messageId: "m3", createdAt: 300, text: "tres" }
  ];
  const older = [
    { messageId: "m1", createdAt: 100, text: "uno" },
    { messageId: "m2", createdAt: 200, text: "duplicado" }
  ];
  assert.deepEqual(mergeChatMessagePages(current, older), [
    { messageId: "m1", createdAt: 100, text: "uno" },
    current[0],
    current[1]
  ]);
});

test("ignores malformed messages without a stable message identifier", () => {
  assert.deepEqual(mergeChatMessagePages(
    [{ messageId: "m1", createdAt: 100, text: "válido" }],
    [null, {}, { createdAt: 200, text: "sin id" }]
  ), [{ messageId: "m1", createdAt: 100, text: "válido" }]);
});


test("uses the same deterministic case-sensitive tie-break as Firebase RTDB", () => {
  const messages = [
    { messageId: "m_a", createdAt: 500, text: "minúscula" },
    { messageId: "m_A", createdAt: 500, text: "mayúscula" }
  ];
  assert.deepEqual(
    mergeChatMessagePages([], messages).map(message => message.messageId),
    ["m_A", "m_a"]
  );
});
