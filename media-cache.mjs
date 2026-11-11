const DB_NAME = "dante-remises-media-cache";
const DB_VERSION = 1;
const STORE_NAME = "media";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

export function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new TypeError("A data URL is required");
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new TypeError("Invalid data URL");
  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const mimeType = header.split(";")[0] || "application/octet-stream";
  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

export async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this environment");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createMediaCache({
  indexedDBImpl = globalThis.indexedDB,
  urlApi = globalThis.URL,
  maxBytes = 40 * 1024 * 1024,
  maxAgeMs = 90 * 24 * 60 * 60 * 1000,
  now = () => Date.now(),
  onMetric = () => {}
} = {}) {
  const memory = new Map();
  const objectUrls = new Map();
  let databasePromise = null;
  let databaseUnavailable = false;

  function emit(name, details = {}) {
    try { onMetric(name, details); } catch {}
  }

  async function database() {
    if (!indexedDBImpl || databaseUnavailable) return null;
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDBImpl.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
            store.createIndex("lastAccessAt", "lastAccessAt", { unique: false });
            store.createIndex("expiresAt", "expiresAt", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open media cache"));
        request.onblocked = () => reject(new Error("Media cache upgrade is blocked"));
      }).catch(error => {
        databasePromise = null;
        databaseUnavailable = true;
        emit("open-error", { name: error?.name || "Error" });
        return null;
      });
    }
    return databasePromise;
  }

  async function allRecords() {
    const db = await database();
    if (!db) return [...memory.values()];
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const result = await requestResult(transaction.objectStore(STORE_NAME).getAll());
      await done;
      const merged = new Map(result.map(record => [record.key, record]));
      for (const [key, record] of memory) merged.set(key, record);
      return [...merged.values()];
    } catch (error) {
      emit("read-error", { name: error?.name || "Error" });
      return [...memory.values()];
    }
  }

  async function get(key) {
    if (typeof key !== "string" || !key) throw new TypeError("Cache key is required");
    const db = await database();
    let record = memory.get(key) || null;
    if (!record && db) {
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE_NAME);
        record = await requestResult(store.get(key));
        if (record) {
          record.lastAccessAt = now();
          store.put(record);
        }
        await done;
      } catch (error) {
        emit("read-error", { name: error?.name || "Error" });
        record = null;
      }
    }
    if (record && !db) record.lastAccessAt = now();
    if (!record) {
      emit("miss", { key });
      return null;
    }
    if (!db) record.lastAccessAt = now();
    if ((record.expiresAt && record.expiresAt <= now()) || now() - record.createdAt > maxAgeMs) {
      await remove(key);
      emit("expired", { key });
      return null;
    }
    emit("hit", { key, bytes: record.size || record.blob?.size || 0 });
    return record;
  }

  async function put(key, blob, metadata = {}) {
    if (typeof key !== "string" || !key) throw new TypeError("Cache key is required");
    if (!(blob instanceof Blob)) throw new TypeError("Cached media must be a Blob");
    const timestamp = now();
    const record = {
      key,
      blob,
      size: blob.size,
      contentType: blob.type || "application/octet-stream",
      version: typeof metadata.version === "string" ? metadata.version : "",
      createdAt: timestamp,
      lastAccessAt: timestamp,
      expiresAt: Number.isFinite(metadata.ttlMs) && metadata.ttlMs > 0 ? timestamp + metadata.ttlMs : 0,
      privateUid: typeof metadata.privateUid === "string" ? metadata.privateUid : "",
      category: typeof metadata.category === "string" ? metadata.category : "media",
      extra: metadata.extra && typeof metadata.extra === "object" ? metadata.extra : {}
    };
    const db = await database();
    if (!db) memory.set(key, record);
    else {
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(transaction);
        transaction.objectStore(STORE_NAME).put(record);
        await done;
        memory.delete(key);
      } catch (error) {
        memory.set(key, record);
        emit("write-error", { name: error?.name || "Error", bytes: record.size });
      }
    }
    emit("write", { key, bytes: record.size, category: record.category });
    await prune();
    return record;
  }

  async function putDataUrl(key, dataUrl, metadata = {}) {
    const blob = dataUrlToBlob(dataUrl);
    const version = metadata.version || await sha256(dataUrl);
    return put(key, blob, { ...metadata, version });
  }

  async function objectUrl(key) {
    const record = await get(key);
    if (!record) return null;
    const current = objectUrls.get(key);
    if (current?.createdAt === record.createdAt) return current.url;
    const nextUrl = urlApi.createObjectURL(record.blob);
    if (current?.url) urlApi.revokeObjectURL(current.url);
    objectUrls.set(key, { url: nextUrl, createdAt: record.createdAt });
    return nextUrl;
  }

  async function remove(key) {
    memory.delete(key);
    const db = await database();
    if (db) {
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(transaction);
        transaction.objectStore(STORE_NAME).delete(key);
        await done;
      } catch (error) {
        emit("delete-error", { name: error?.name || "Error" });
      }
    }
    const current = objectUrls.get(key);
    if (current?.url) urlApi.revokeObjectURL(current.url);
    objectUrls.delete(key);
  }

  async function removePrefix(prefix) {
    const records = await allRecords();
    const keys = records.filter(record => record.key.startsWith(prefix)).map(record => record.key);
    for (const key of keys) await remove(key);
    return keys.length;
  }

  async function clearPrivate(uid) {
    if (typeof uid !== "string" || !uid) return 0;
    return removePrefix(`private:${uid}:`);
  }

  async function prune() {
    const records = await allRecords();
    const timestamp = now();
    const expired = records.filter(record =>
      (record.expiresAt && record.expiresAt <= timestamp) || timestamp - record.createdAt > maxAgeMs
    );
    for (const record of expired) await remove(record.key);
    const remaining = records.filter(record => !expired.includes(record))
      .sort((left, right) => (left.lastAccessAt || left.createdAt) - (right.lastAccessAt || right.createdAt));
    let totalBytes = remaining.reduce((sum, record) => sum + (record.size || record.blob?.size || 0), 0);
    for (const record of remaining) {
      if (totalBytes <= maxBytes) break;
      totalBytes -= record.size || record.blob?.size || 0;
      await remove(record.key);
      emit("evict", { key: record.key });
    }
  }

  async function stats() {
    const records = await allRecords();
    return {
      entries: records.length,
      bytes: records.reduce((sum, record) => sum + (record.size || record.blob?.size || 0), 0),
      maxBytes
    };
  }

  async function clearAll() {
    const records = await allRecords();
    for (const record of records) await remove(record.key);
    return records.length;
  }

  return { get, put, putDataUrl, objectUrl, remove, removePrefix, clearPrivate, prune, stats, clearAll };
}

export const mediaCache = createMediaCache({
  onMetric: (name, details) => {
    const monitor = globalThis.window?.__DANTE_PERF__;
    if (monitor?.mark) monitor.mark(`media-cache.${name}`, { bytes: Number(details.bytes) || 0 });
  }
});
