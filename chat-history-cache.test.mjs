import test from "node:test";
import assert from "node:assert/strict";
import { createChatHistoryCache, filterRetainedChatMessages } from "./chat-history-cache.mjs";

const DAY = 24 * 60 * 60 * 1000;

test("chat history is isolated by authenticated UID and conversation", async () => {
  const cache = createChatHistoryCache({ indexedDBImpl: null, now: () => 1000 });
  const messages = [{ messageId: "m1", text: "privado", blockClosesAt: 0 }];
  await cache.putMessages("uid-a", "conversation-1", messages, { complete: true });
  assert.deepEqual((await cache.getMessages("uid-a", "conversation-1")).messages, messages);
  assert.equal(await cache.getMessages("uid-b", "conversation-1"), null);
  assert.equal(await cache.getMessages("uid-a", "conversation-2"), null);
});

test("chat history expires when its 24-hour block has been closed for 14 days", () => {
  const now = 20 * DAY;
  const messages = [
    { messageId: "expired", blockClosesAt: 6 * DAY, text: "old" },
    { messageId: "retained", blockClosesAt: 7 * DAY, text: "recent" },
    { messageId: "no-block-metadata", text: "legacy" }
  ];
  assert.deepEqual(
    filterRetainedChatMessages(messages, now).map(message => message.messageId),
    ["retained", "no-block-metadata"]
  );
});

test("expired attachment binaries are hidden while the retained text message remains", () => {
  const now = 10 * DAY;
  const [message] = filterRetainedChatMessages([{
    messageId: "m-audio",
    text: "🎤 Audio",
    blockClosesAt: 0,
    attachment: { key: "private/object", expiresAt: now - 1 }
  }], now);
  assert.equal(message.messageId, "m-audio");
  assert.equal(message.attachment, null);
  assert.equal(message.attachmentExpired, true);
});

test("conversation list is persisted separately for each user", async () => {
  const cache = createChatHistoryCache({ indexedDBImpl: null, now: () => 1234 });
  await cache.putConversations("uid-a", [{ conversationId: "one" }]);
  await cache.putConversations("uid-b", [{ conversationId: "two" }]);
  assert.deepEqual((await cache.getConversations("uid-a")).conversations, [{ conversationId: "one" }]);
  assert.deepEqual((await cache.getConversations("uid-b")).conversations, [{ conversationId: "two" }]);
});

test("cache preserves whether the local conversation history is complete", async () => {
  const cache = createChatHistoryCache({ indexedDBImpl: null, now: () => 5000 });
  await cache.putMessages("uid-a", "conversation-1", [{ messageId: "m1" }], { complete: true });
  assert.equal((await cache.getMessages("uid-a", "conversation-1")).complete, true);
});
