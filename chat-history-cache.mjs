const DB_NAME = "dante-remises-chat-history";
const DB_VERSION = 1;
const STORE_NAME = "records";
const BLOCK_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Chat history cache request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Chat history cache transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("Chat history cache transaction failed"));
  });
}

export function filterRetainedChatMessages(messages, now = Date.now()) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(message => {
    if (!message || typeof message !== "object") return false;
    const closesAt = Number(message.blockClosesAt);
    return !(Number.isFinite(closesAt) && closesAt > 0 && closesAt + BLOCK_RETENTION_MS <= now);
  }).map(message => {
    const expiresAt = Number(message.attachment?.expiresAt);
    if (message.attachment && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now) {
      return { ...message, attachment: null, attachmentExpired: true };
    }
    return message;
  });
}

export function createChatHistoryCache({
  indexedDBImpl = globalThis.indexedDB,
  now = () => Date.now(),
  onMetric = () => {}
} = {}) {
  const memory = new Map();
  let databasePromise = null;
  let databaseUnavailable = false;

  function emit(name, details = {}) {
    try { onMetric(name, details); } catch {}
  }

  function messagesKey(uid, conversationId) {
    if (typeof uid !== "string" || !uid || typeof conversationId !== "string" || !conversationId) {
      throw new TypeError("A user UID and conversation ID are required");
    }
    return `messages:${JSON.stringify([uid, conversationId])}`;
  }

  function conversationsKey(uid) {
    if (typeof uid !== "string" || !uid) throw new TypeError("A user UID is required");
    return `conversations:${uid}`;
  }

  async function database() {
    if (!indexedDBImpl || databaseUnavailable) return null;
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDBImpl.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open chat history cache"));
        request.onblocked = () => reject(new Error("Chat history cache upgrade is blocked"));
      }).catch(error => {
        databasePromise = null;
        databaseUnavailable = true;
        emit("open-error", { name: error?.name || "Error" });
        return null;
      });
    }
    return databasePromise;
  }

  async function read(key) {
    const db = await database();
    if (!db) return memory.get(key) || null;
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const result = await requestResult(transaction.objectStore(STORE_NAME).get(key));
      await done;
      return result || memory.get(key) || null;
    } catch (error) {
      emit("read-error", { name: error?.name || "Error" });
      return memory.get(key) || null;
    }
  }

  async function write(record) {
    const db = await database();
    if (!db) {
      memory.set(record.key, record);
      emit("memory-fallback-write", { recordType: record.recordType || "unknown" });
      return record;
    }
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).put(record);
      await done;
      memory.delete(record.key);
      emit("write", { recordType: record.recordType || "unknown" });
    } catch (error) {
      memory.set(record.key, record);
      emit("write-error", { name: error?.name || "Error" });
    }
    return record;
  }

  async function getMessages(uid, conversationId) {
    const key = messagesKey(uid, conversationId);
    const record = await read(key);
    if (!record || record.recordType !== "messages") return null;
    const messages = filterRetainedChatMessages(record.messages, now());
    const changed = messages.length !== (Array.isArray(record.messages) ? record.messages.length : 0) ||
      messages.some((message, index) => message !== record.messages[index]);
    if (changed) {
      const updated = { ...record, messages, updatedAt: now() };
      await write(updated);
      emit("retention-prune", { count: (record.messages?.length || 0) - messages.length });
      return updated;
    }
    return { ...record, messages };
  }

  async function putMessages(uid, conversationId, messages, { complete = false, lastSyncedAt = now() } = {}) {
    const key = messagesKey(uid, conversationId);
    const retained = filterRetainedChatMessages(messages, now());
    return write({
      key,
      recordType: "messages",
      uid,
      conversationId,
      messages: retained,
      complete: complete === true,
      lastSyncedAt: Number(lastSyncedAt) || now(),
      updatedAt: now()
    });
  }

  async function getConversations(uid) {
    const record = await read(conversationsKey(uid));
    if (!record || record.recordType !== "conversation-list") return null;
    return { conversations: Array.isArray(record.conversations) ? record.conversations : [], lastSyncedAt: record.lastSyncedAt || 0 };
  }

  async function putConversations(uid, conversations) {
    if (!Array.isArray(conversations)) throw new TypeError("Conversation list must be an array");
    return write({
      key: conversationsKey(uid),
      recordType: "conversation-list",
      uid,
      conversations,
      lastSyncedAt: now(),
      updatedAt: now()
    });
  }

  async function clearUser(uid) {
    if (typeof uid !== "string" || !uid) return 0;
    const db = await database();
    const prefix = `messages:${JSON.stringify([uid]).slice(0, -1)},`;
    const keys = new Set([...memory.keys()].filter(key => key.startsWith(prefix) || key === `conversations:${uid}`));
    if (db) {
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const records = await requestResult(store.getAll());
        for (const record of records) {
          if (record.uid === uid) {
            store.delete(record.key);
            keys.add(record.key);
          }
        }
        await done;
      } catch (error) {
        emit("clear-error", { name: error?.name || "Error" });
      }
    }
    for (const key of keys) memory.delete(key);
    return keys.size;
  }

  return { getMessages, putMessages, getConversations, putConversations, clearUser };
}

export const chatHistoryCache = createChatHistoryCache({
  onMetric: (name, details) => {
    const monitor = globalThis.window?.__DANTE_PERF__;
    if (monitor?.mark) monitor.mark(`chat-history-cache.${name}`, details);
  }
});
