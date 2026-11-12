import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ChatApiClient, ChatApiError, createClientMessageId, mergeChatMessagePages } from "./chat-client.mjs";

test("the application imports the message page merge helper used by chat detail", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('import { ChatApiClient, createClientMessageId, mergeChatMessagePages } from "./chat-client.mjs";'));
});

test("passenger chat exposes the connected-operator selector in the green chat header", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="chatPeerSelect"'));
  assert.ok(html.includes('id="chatPeerMenu"'));
  assert.ok(html.includes('class="chat-peer-caret" aria-hidden="true">▼</span>'));
  assert.ok(html.includes("api.listOperators()"));
  assert.ok(html.includes("setInterval(sendOperatorPresence,10_000)"));
  assert.ok(html.includes("getProfilePhoto(otherUid)"));
});

test("chat composer exposes photo attachments and on-demand voice recording", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="chatImageInput"'));
  assert.ok(html.includes('id="chatAttachButton"'));
  assert.ok(html.includes('id="chatRecordButton"'));
  assert.ok(html.includes('id="chatSendRecordingButton"'));
  assert.ok(html.includes("navigator.mediaDevices.getUserMedia"));
  assert.ok(html.includes("api.sendAttachment"));
  assert.ok(html.includes("getAttachmentReadUrl"));
  assert.ok(html.includes("attachment?.expiresAt"));
  assert.ok(html.includes("Adjunto eliminado automáticamente después de 7 días."));
});

test("clears every private media cache entry when the authenticated account signs out", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("if(previousMediaUid&&!user){"));
  assert.ok(html.includes("void mediaCache.clearPrivate(previousMediaUid)"));
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

test("lists only server-authorized connected operators", async () => {
  let request;
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ operators: [{ uid: "operator-1", firstName: "Patricia", role: "operator" }] });
  });
  const result = await client.listOperators();
  assert.equal(request.url, "https://chat.example.test/v1/chat/operators");
  assert.equal(request.options.method, "GET");
  assert.deepEqual(result.operators[0], { uid: "operator-1", firstName: "Patricia", role: "operator" });
});

test("operator presence uses authenticated POST and DELETE requests", async () => {
  const requests = [];
  const client = makeClient(async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ online: options.method === "POST" });
  });
  await client.setOperatorPresence();
  await client.clearOperatorPresence();
  assert.deepEqual(requests.map(item => item.options.method), ["POST", "DELETE"]);
  assert.ok(requests.every(item => item.url === "https://chat.example.test/v1/chat/presence"));
  assert.ok(requests.every(item => item.options.headers.Authorization === "Bearer firebase-test-token"));
});

test("requests any active profile photo through an authenticated endpoint without a conversation id", async () => {
  let request;
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ readUrl: "https://storage.example.test/photo.jpg", expiresIn: 300 });
  });
  const result = await client.getProfilePhoto("passenger-uid");
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/chat/profile-photo");
  assert.equal(url.searchParams.get("uid"), "passenger-uid");
  assert.equal(url.searchParams.has("conversationId"), false);
  assert.equal(request.options.headers.Authorization, "Bearer firebase-test-token");
  assert.equal(result.expiresIn, 300);
});

test("requests a participant photo through a conversation-scoped authenticated endpoint", async () => {
  let request;
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ readUrl: "https://storage.example.test/photo.jpg", expiresIn: 300 });
  });
  const result = await client.getParticipantPhoto("conversation/one", "passenger-uid");
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/chat/participant-photo");
  assert.equal(url.searchParams.get("conversationId"), "conversation/one");
  assert.equal(url.searchParams.get("uid"), "passenger-uid");
  assert.equal(request.options.headers.Authorization, "Bearer firebase-test-token");
  assert.equal(result.expiresIn, 300);
});

test("uploads image and audio attachments as authenticated multipart requests", async () => {
  let request;
  const client = makeClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ message: { type: "image" } }, 201);
  });
  const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  const result = await client.sendAttachment({
    conversationId: "conversation-1",
    file,
    type: "image",
    clientMessageId: "image-message-1234",
    caption: "Foto",
    fileName: "photo.jpg"
  });
  assert.equal(request.url, "https://chat.example.test/v1/chat/attachments");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer firebase-test-token");
  assert.equal(request.options.headers["Content-Type"], undefined, "the browser must set the multipart boundary");
  assert.ok(request.options.body instanceof FormData);
  assert.equal(request.options.body.get("conversationId"), "conversation-1");
  assert.equal(request.options.body.get("type"), "image");
  assert.equal(request.options.body.get("clientMessageId"), "image-message-1234");
  assert.equal(result.message.type, "image");
});

test("gets short-lived attachment URLs through an authenticated endpoint", async () => {
  let urlSeen;
  const client = makeClient(async url => {
    urlSeen = url;
    return jsonResponse({ readUrl: "https://storage.example.test/chat/photo.jpg", expiresIn: 300 });
  });
  const result = await client.getAttachmentReadUrl("conversation-1", "chat/conversation-1/user-1/m_abc.jpg");
  const url = new URL(urlSeen);
  assert.equal(url.pathname, "/v1/chat/attachments/read-url");
  assert.equal(url.searchParams.get("conversationId"), "conversation-1");
  assert.equal(url.searchParams.get("key"), "chat/conversation-1/user-1/m_abc.jpg");
  assert.equal(result.expiresIn, 300);
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

test("chat recipient menu groups drivers and only exposes connected operators", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="chatPeerSelect"'));
  assert.ok(html.includes("appendChatRecipientGroup(menu,'Choferes'"));
  assert.ok(html.includes("appendChatRecipientGroup(menu,'Operadores'") || html.includes("appendChatMenuHeading(menu,'Operadores')"));
  assert.ok(html.includes("chatOperators.forEach(operator=>"));
  assert.ok(html.includes("findChatConversationForUid(operator.uid)"));
  assert.ok(html.includes("button.dataset.targetType=targetType"));
  assert.ok(html.includes("selectChatConversation(conversation)"));
});

test("chat opens as a separate WhatsApp-like screen and returns to the app shell", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="chatFullscreenButton"'));
  assert.ok(html.includes("body.chat-screen-open #chat"));
  assert.ok(html.includes("setChatScreenOpen(open)"));
  assert.ok(html.includes("Volver a Dante Remises"));
  assert.ok(html.includes("closeChatScreen()"));
  assert.ok(!html.includes("classList.toggle('chatbox-fullscreen')"));
});

test("audio attachments use a styled player with live elapsed and total duration", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("chat-audio-player"));
  assert.ok(html.includes("loadedmetadata"));
  assert.ok(html.includes("durationchange"));
  assert.ok(html.includes("timeupdate"));
  assert.ok(html.includes("chat-audio-progress"));
});

test("message rendering reuses existing DOM nodes instead of rebuilding the full chat on refresh", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("const existing=new Map([...box.children]"));
  assert.ok(html.includes("item.dataset.messageId=id"));
});

test("chat stores complete histories per account and renders older pages from local cache", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes('import { chatHistoryCache } from "./chat-history-cache.mjs"'));
  assert.ok(html.includes("chatHistoryCache.putMessages(uid,conversationId,remoteMessages,{complete:true})"));
  assert.ok(html.includes("chatHistoryCache.getMessages(uid,conversationId)"));
  assert.ok(html.includes("async function prefetchChatConversationHistories()"));
  assert.ok(html.includes("if(chatMessagesCacheComplete)"));
  assert.ok(html.includes("all.slice(start,firstIndex)"));
  assert.ok(html.includes("chatMessages=combined.slice(-visibleCount)"));
});

test("passenger and operator recipient menus include the four registered driver cars", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("function getChatDriverRecipients()"));
  assert.ok(html.includes("const uid=driverUidForCar(car.id)"));
  assert.ok(html.includes("return {uid,carId:car.id,name:known.name||car.driver,role:uid===ADMIN_UID?'admin':'driver'}"));
  assert.ok(html.includes("appendChatRecipientGroup(menu,'Choferes',drivers,'driver')"));
  assert.ok(html.includes("appendChatRecipientGroup(menu,'Choferes',getChatDriverRecipients(),'driver')"));
});

test("conversation and message indexes are paginated before being cached locally", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("async function listAllChatConversations(api)"));
  assert.ok(html.includes("api.listConversations(cursor)"));
  assert.ok(html.includes("while(hasMore&&cursor&&cursor!==lastCursor)"));
  assert.ok(html.includes("void prefetchChatConversationHistories()"));
  assert.ok(html.includes("conversation.lastMessageAt") && html.includes("cached.lastSyncedAt"));
});

test("drivers see only existing passenger/operator conversations grouped by counterpart role", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("chatConversations.filter(conversation=>conversation.kind==='passenger-driver'),'Pasajeros'"));
  assert.ok(html.includes("chatConversations.filter(conversation=>conversation.kind==='operator-driver'),'Operadores'"));
  assert.ok(html.includes("chatConversations.filter(conversation=>['passenger-operator','operator-support'].includes(conversation.kind)),'Pasajeros'"));
});

test("chat in-memory state resets when the authenticated UID changes", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("function ensureChatSessionForCurrentUser()"));
  assert.ok(html.includes("if(chatSessionUid&&chatSessionUid!==uid)"));
  assert.ok(html.includes("chatHistorySyncing=new Set()"));
  assert.ok(html.includes("chatAttachmentUrls.clear()"));
});

test("passenger general chat defaults to the operator channel only when operators are connected", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("function getDefaultChatConversation()"));
  assert.ok(html.includes("if(!chatOperators.length)return null"));
  assert.ok(html.includes("await api.openConversation({target:'operators'})"));
  assert.ok(html.includes("await ensurePassengerDefaultChat()"));
});

test("passengers cannot select offline operator conversations from the conversation list", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes("if(conversation.kind==='operator-support')return chatOperators.length>0"));
  assert.ok(html.includes("return chatOperators.some(operator=>operator.uid===otherUid)"));
  assert.ok(html.includes("chatOperators=[];renderChatOperatorMenu();renderChatConversationList()"));
});
