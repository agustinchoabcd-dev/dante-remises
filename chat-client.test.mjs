import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ChatApiClient, ChatApiError, createClientMessageId, mergeChatMessagePages } from "./chat-client.mjs";

test("the application imports the message page merge helper used by chat detail", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('import { ChatApiClient, createClientMessageId, mergeChatMessagePages } from "./chat-client.mjs";'));
});

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

test("uses the global fetch receiver when no fetch implementation is injected", async () => {
  const originalFetch = globalThis.fetch;
  let receiver = null;
  globalThis.fetch = function () {
    receiver = this;
    return Promise.resolve(jsonResponse({ conversations: [], nextCursor: null, hasMore: false }));
  };
  try {
    const client = new ChatApiClient({
      baseUrl: "https://chat.example.test",
      getIdToken: async () => "firebase-test-token"
    });
    await client.listConversations();
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("opens an authenticated Server-Sent Events stream for one conversation", async () => {
  let request;
  const streamBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("event: put\ndata: {\"path\":\"/\",\"data\":123}\n\n"));
      controller.close();
    }
  });
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return new Response(streamBody, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await client.openMessageStream("conversation/one");
  assert.equal(new URL(request.url).pathname, "/v1/chat/events");
  assert.equal(new URL(request.url).searchParams.get("conversationId"), "conversation/one");
  assert.equal(request.options.headers.Authorization, "Bearer firebase-test-token");
  assert.equal(request.options.headers.Accept, "text/event-stream");
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
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
  await assert.rejects(client.sendMessage({
    conversationId: "conversation-1", text: "   ", clientMessageId: "message-id-123456"
  }), /1-2000/);
  await assert.rejects(client.sendMessage({
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


test("retries an uncertain 502 send once with the exact same idempotency key", async () => {
  let calls = 0;
  const requestBodies = [];
  const client = makeClient(async (_url, options) => {
    calls++;
    requestBodies.push(JSON.parse(options.body));
    return calls === 1
      ? jsonResponse({ error: "Temporary persistence/index failure" }, 502)
      : jsonResponse({ message: { messageId: "m_saved", idempotent: true } }, 200);
  });
  const result = await client.sendMessage({
    conversationId: "conversation-1",
    text: "Hola",
    clientMessageId: "stable-message-id-123"
  });
  assert.equal(calls, 2);
  assert.deepEqual(requestBodies[0], requestBodies[1]);
  assert.equal(requestBodies[1].clientMessageId, "stable-message-id-123");
  assert.equal(result.message.idempotent, true);
});

test("does not automatically retry rate-limited message sends", async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls++;
    return jsonResponse({ error: "Rate limited" }, 429, { "Retry-After": "5" });
  });
  await assert.rejects(
    client.sendMessage({
      conversationId: "conversation-1",
      text: "Hola",
      clientMessageId: "stable-message-id-456"
    }),
    error => error instanceof ChatApiError && error.status === 429 && error.retryAfter === "5"
  );
  assert.equal(calls, 1);
});


test("retains the idempotency key when both immediate attempts have uncertain outcomes", async () => {
  let calls = 0;
  const requestBodies = [];
  const client = makeClient(async (_url, options) => {
    calls++;
    requestBodies.push(JSON.parse(options.body));
    return calls <= 2
      ? jsonResponse({ error: "Uncertain persistence result" }, 502)
      : jsonResponse({ message: { messageId: "m_recovered", idempotent: true } }, 200);
  });

  await assert.rejects(client.sendMessage({
    conversationId: "conversation-1",
    text: "Mensaje pendiente",
    clientMessageId: "first-generated-id-123"
  }), error => error instanceof ChatApiError && error.status === 502);

  const recovered = await client.sendMessage({
    conversationId: "conversation-1",
    text: "Mensaje pendiente",
    clientMessageId: "new-id-from-next-ui-click"
  });

  assert.equal(calls, 3);
  assert.equal(recovered.message.idempotent, true);
  assert.equal(requestBodies[0].clientMessageId, "first-generated-id-123");
  assert.equal(requestBodies[1].clientMessageId, "first-generated-id-123");
  assert.equal(requestBodies[2].clientMessageId, "first-generated-id-123");
});
