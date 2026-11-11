import test from "node:test";
import assert from "node:assert/strict";
import { createMediaCache, dataUrlToBlob, sha256 } from "./media-cache.mjs";

test("converts Base64 data URLs into typed Blobs", () => {
  const blob = dataUrlToBlob("data:image/png;base64,aGVsbG8=");
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 5);
});

test("stores and retrieves media when IndexedDB is unavailable", async () => {
  const cache = createMediaCache({ indexedDBImpl: null });
  const source = new Blob(["photo-bytes"], { type: "image/jpeg" });
  await cache.put("public:logo", source, { version: "v1", category: "logo" });
  const saved = await cache.get("public:logo");
  assert.equal(await saved.blob.text(), "photo-bytes");
  assert.equal(saved.version, "v1");
  assert.deepEqual(await cache.stats(), { entries: 1, bytes: 11, maxBytes: 40 * 1024 * 1024 });
});

test("returns and reuses a local object URL for a cached image", async () => {
  const cache = createMediaCache({ indexedDBImpl: null });
  await cache.put("public:logo", new Blob(["logo"], { type: "image/png" }));
  const first = await cache.objectUrl("public:logo");
  const second = await cache.objectUrl("public:logo");
  assert.equal(first, second);
  assert.match(first, /^blob:/);
});

test("expires temporary media and removes private data by account", async () => {
  let timestamp = 1000;
  const cache = createMediaCache({ indexedDBImpl: null, now: () => timestamp });
  await cache.put("private:user-1:chat:one", new Blob(["audio"]), { ttlMs: 5000 });
  await cache.put("private:user-1:staff:one", new Blob(["photo"]));
  await cache.put("private:user-2:staff:one", new Blob(["other"]), { ttlMs: 5000 });
  assert.equal(await cache.clearPrivate("user-1"), 2);
  assert.equal(await cache.get("private:user-1:chat:one"), null);
  assert.ok(await cache.get("private:user-2:staff:one"));
  timestamp += 6000;
  assert.equal(await cache.get("private:user-2:staff:one"), null);
});

test("evicts least-recently-written entries when the byte budget is exceeded", async () => {
  const cache = createMediaCache({ indexedDBImpl: null, maxBytes: 6 });
  await cache.put("one", new Blob(["1234"]));
  await cache.put("two", new Blob(["5678"]));
  assert.equal(await cache.get("one"), null);
  assert.ok(await cache.get("two"));
  assert.equal((await cache.stats()).bytes, 4);
});

test("creates stable SHA-256 versions for image data", async () => {
  assert.equal(await sha256("dante"), "16814e8cd706b29de1ba77f011fd96f1b245ca6641b3af63b0f787af54284f90");
});
test("falls back to in-memory storage when IndexedDB cannot open", async () => {
  const unavailableIndexedDB = {
    open() {
      const request = { error: Object.assign(new Error("Storage unavailable"), { name: "SecurityError" }) };
      queueMicrotask(() => request.onerror?.());
      return request;
    }
  };
  const cache = createMediaCache({ indexedDBImpl: unavailableIndexedDB });
  await cache.put("public:fallback", new Blob(["works"]));
  const saved = await cache.get("public:fallback");
  assert.equal(await saved.blob.text(), "works");
});
test("replaces the object URL when a cached image version changes", async () => {
  let nextId = 0;
  const revoked = [];
  const urlApi = {
    createObjectURL() { return `blob:test-${++nextId}`; },
    revokeObjectURL(url) { revoked.push(url); }
  };
  const cache = createMediaCache({ indexedDBImpl: null, urlApi });
  await cache.put("staff:photo", new Blob(["old"]), { version: "v1" });
  const oldUrl = await cache.objectUrl("staff:photo");
  await cache.put("staff:photo", new Blob(["new"]), { version: "v2" });
  const newUrl = await cache.objectUrl("staff:photo");
  assert.notEqual(oldUrl, newUrl);
  assert.deepEqual(revoked, [oldUrl]);
});
