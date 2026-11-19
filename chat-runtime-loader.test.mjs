import test from "node:test";
import assert from "node:assert/strict";
import { createChatRuntimeLoader } from "./chat-runtime-loader.mjs";

function modules() {
  return {
    client: {
      ChatApiClient: class ChatApiClient {},
      createClientMessageId: () => "message-id",
      mergeChatMessagePages: () => []
    },
    history: { chatHistoryCache: { getMessages: async () => [] } }
  };
}

test("chat modules are not requested until the loader is called", () => {
  let calls = 0;
  createChatRuntimeLoader({
    loadClient: async () => { calls++; return modules().client; },
    loadHistory: async () => { calls++; return modules().history; }
  });
  assert.equal(calls, 0);
});

test("concurrent callers share one chat module load", async () => {
  let clientLoads = 0;
  let historyLoads = 0;
  const data = modules();
  const ensure = createChatRuntimeLoader({
    loadClient: async () => { clientLoads++; return data.client; },
    loadHistory: async () => { historyLoads++; return data.history; }
  });

  const [first, second] = await Promise.all([ensure(), ensure()]);

  assert.equal(first, second);
  assert.equal(clientLoads, 1);
  assert.equal(historyLoads, 1);
  assert.equal(first.ChatApiClient, data.client.ChatApiClient);
  assert.equal(first.chatHistoryCache, data.history.chatHistoryCache);
});

test("a failed chat module load can be retried", async () => {
  let attempts = 0;
  const data = modules();
  const ensure = createChatRuntimeLoader({
    loadClient: async () => {
      attempts++;
      if (attempts === 1) throw new Error("temporary module failure");
      return data.client;
    },
    loadHistory: async () => data.history
  });

  await assert.rejects(ensure(), /temporary module failure/);
  const result = await ensure();

  assert.equal(result.ChatApiClient, data.client.ChatApiClient);
  assert.equal(attempts, 2);
});
