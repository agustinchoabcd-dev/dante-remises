import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleChatRequest, scheduledChatCleanup } from './chat-module-candidate-dynamic.js';

const projectId = 'dante-chat-test';
const kid = 'test-key-1';
let signingKeys;
let privatePem;
let db;
let writes;
let etagVersions;
let requestCounter;
let failNextMessagePatch;
let etagConflicts;
const env = {
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'chat-test@dante-chat-test.iam.gserviceaccount.com',
  APP_ORIGIN: 'https://app.example.test',
  ADMIN_UID: 'admin-uid',
  FIREBASE_DATABASE_URL: 'https://dante-chat-test-default-rtdb.firebaseio.com'
};

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
async function tokenFor(uid) {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'RS256', typ: 'JWT', kid });
  const body = encode({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    exp: now + 3600,
    iat: now,
    auth_time: now
  });
  const input = `${head}.${body}`;
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKeys.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
function setPath(path, value) {
  const parts = path.split('/').filter(Boolean);
  let node = db;
  for (const part of parts.slice(0, -1)) node = node[part] ||= {};
  if (value === null) delete node[parts.at(-1)];
  else node[parts.at(-1)] = structuredClone(value);
  for (let i = 1; i <= parts.length; i++) {
    const key = '/' + parts.slice(0, i).join('/');
    etagVersions.set(key, (etagVersions.get(key) || 0) + 1);
  }
}
function etagFor(path) {
  return getPath(path) === null ? 'null_etag' : `"${etagVersions.get(path) || 0}"`;
}
function getPath(path) {
  let node = db;
  for (const part of path.split('/').filter(Boolean)) node = node?.[part];
  return node === undefined ? null : structuredClone(node);
}

before(async () => {
  signingKeys = await webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', signingKeys.publicKey);
  publicJwk.kid = kid;
  publicJwk.kty = 'RSA';
  privatePem = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', signingKeys.privateKey)).toString('base64');
  env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${privatePem}\n-----END PRIVATE KEY-----`;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.googleapis.com' && url.pathname.includes('/jwk/')) {
      return jsonResponse({ keys: [publicJwk] }, 200, { 'Cache-Control': 'public, max-age=3600' });
    }
    if (url.hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'mock-service-token', expires_in: 3600 });
    if (url.hostname === 'dante-chat-test-default-rtdb.firebaseio.com') {
      // Yield to the event loop so concurrent requests can observe the same
      // ETag before either conditional write commits.
      await new Promise(resolve => setImmediate(resolve));
      const path = decodeURIComponent(url.pathname).replace(/\.json$/, '');
      const method = options.method || 'GET';
      if (method === 'GET') return jsonResponse(getPath(path), 200, options.headers?.['X-Firebase-ETag'] ? { ETag: etagFor(path) } : {});
      if (method === 'PUT') {
        const match = options.headers?.['if-match'] || options.headers?.['If-Match'];
        if (match && match !== etagFor(path)) { etagConflicts++; return jsonResponse({ error: 'ETag mismatch' }, 412); }
        setPath(path, JSON.parse(options.body)); writes.push({ method, path }); return jsonResponse(JSON.parse(options.body));
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(options.body);
        const match = options.headers?.['if-match'] || options.headers?.['If-Match'];
        if (match && match !== etagFor(path)) { etagConflicts++; return jsonResponse({ error: 'ETag mismatch' }, 412); }
        if (failNextMessagePatch && path === '/chat' && Object.keys(patch).some(key => key.startsWith('messages/'))) {
          failNextMessagePatch = false;
          return jsonResponse({ error: 'Simulated message persistence failure' }, 500);
        }
        if (Object.keys(patch).some(key => key.includes('/'))) {
          for (const [relativePath, value] of Object.entries(patch)) setPath(`${path}/${relativePath}`, value);
        } else {
          const old = getPath(path) || {};
          setPath(path, { ...old, ...patch });
        }
        writes.push({ method, path, keys: Object.keys(patch) });
        return jsonResponse(getPath(path));
      }
      if (method === 'DELETE') { setPath(path, null); writes.push({ method, path }); return jsonResponse(null); }
    }
    throw new Error(`Unexpected mocked fetch: ${url.href}`);
  };
});

beforeEach(() => {
  db = {};
  writes = [];
  etagVersions = new Map();
  requestCounter = 0;
  failNextMessagePatch = false;
  etagConflicts = 0;
});

async function request(uid, method, path, body, origin = env.APP_ORIGIN, requestEnv = env) {
  if (body?.text && !body.clientMessageId) {
    body = { ...body, clientMessageId: `test-message-${++requestCounter}` };
  }
  const headers = { Authorization: `Bearer ${await tokenFor(uid)}`, Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return handleChatRequest(new Request(`https://worker.example.test${path}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  }), requestEnv);
}

test('CORS preflight succeeds without bearer token only for configured origin', async () => {
  const allowed = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'OPTIONS', headers: { Origin: env.APP_ORIGIN }
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), env.APP_ORIGIN);
  const denied = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'OPTIONS', headers: { Origin: 'https://attacker.example' }
  }), env);
  assert.equal(denied.status, 403);
  const preflightWithoutBackendSecrets = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'OPTIONS', headers: { Origin: env.APP_ORIGIN }
  }), { ...env, FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined });
  assert.equal(preflightWithoutBackendSecrets.status, 204);
});

test('inactive passenger cannot open a support conversation', async () => {
  setPath('/profiles/passenger-1', { role: 'passenger', active: false });
  const response = await request('passenger-1', 'POST', '/v1/chat/conversations', { target: 'operators' });
  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
});

test('active passenger can open operator support and creates global operator index', async () => {
  setPath('/profiles/passenger-1', { role: 'passenger', active: true, name: 'Pasajero' });
  const response = await request('passenger-1', 'POST', '/v1/chat/conversations', { target: 'operators' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.conversation.kind, 'operator-support');
  assert.equal(Object.keys(db.chat.operatorInbox.all).length, 1);
});

test('new active operator can list an existing support conversation through global index', async () => {
  setPath('/profiles/operator-new', { role: 'operator', active: true, name: 'Operador nuevo' });
  const timelineKey = '0000000000001_c_existing';
  setPath('/chat/operatorInbox/all/c_existing', true);
  setPath('/chat/operatorTimeline/' + timelineKey, true);
  setPath('/chat/conversations/c_existing', {
    conversationId: 'c_existing', kind: 'operator-support', participantUids: { 'passenger-1': true }, createdAt: 1, timelineKey
  });
  const response = await request('operator-new', 'GET', '/v1/chat/conversations');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].conversationId, 'c_existing');
});

test('driver can open trip chat only for its own active trip and assigned car', async () => {
  setPath('/profiles/driver-1', { role: 'driver', active: true, carId: '144', name: 'Chofer' });
  setPath('/trips/trip-1', {
    tripId: 'trip-1', passengerUid: 'passenger-1', driverUid: 'driver-1', carId: '144', status: 'accepted'
  });
  setPath('/tripInbox/144/trip-1', { tripId: 'trip-1', status: 'accepted' });
  const response = await request('driver-1', 'POST', '/v1/chat/conversations', { tripId: 'trip-1' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.conversation.kind, 'passenger-driver');
  assert.equal(result.conversation.tripIds['trip-1'], true);
});

test('driver cannot open another driver trip chat', async () => {
  setPath('/profiles/driver-1', { role: 'driver', active: true, carId: '144' });
  setPath('/trips/trip-2', {
    tripId: 'trip-2', passengerUid: 'passenger-2', driverUid: 'driver-2', carId: '137', status: 'accepted'
  });
  setPath('/tripInbox/137/trip-2', { tripId: 'trip-2', status: 'accepted' });
  const response = await request('driver-1', 'POST', '/v1/chat/conversations', { tripId: 'trip-2' });
  assert.equal(response.status, 403);
  assert.equal(writes.filter(write => !write.path.startsWith('/chat/rateLimits/')).length, 0);
});


test('role changes are read from the current profile on each request', async () => {
  setPath('/profiles/staff-uid', { role: 'passenger', active: true });
  const timelineKey = '0000000000001_c_support';
  setPath('/chat/operatorInbox/all/c_support', true);
  setPath('/chat/operatorTimeline/' + timelineKey, true);
  setPath('/chat/conversations/c_support', {
    conversationId: 'c_support', kind: 'operator-support', participantUids: { 'passenger-1': true }, createdAt: 1, timelineKey
  });
  const beforePromotion = await request('staff-uid', 'GET', '/v1/chat/conversations');
  assert.equal((await beforePromotion.json()).conversations.length, 0);
  setPath('/profiles/staff-uid', { role: 'operator', active: true });
  const afterPromotion = await request('staff-uid', 'GET', '/v1/chat/conversations');
  assert.equal((await afterPromotion.json()).conversations.length, 1);
  setPath('/profiles/staff-uid', { role: 'passenger', active: true });
  const afterDemotion = await request('staff-uid', 'GET', '/v1/chat/conversations');
  assert.equal((await afterDemotion.json()).conversations.length, 0);
});

test('non-root user cannot obtain admin role from profile data', async () => {
  setPath('/profiles/not-admin', { role: 'admin', active: true });
  const response = await request('not-admin', 'GET', '/v1/chat/conversations');
  assert.equal(response.status, 403);
});


test('conversation creation writes conversation and indexes atomically', async () => {
  setPath('/profiles/passenger-atomic', { role: 'passenger', active: true });
  const response = await request('passenger-atomic', 'POST', '/v1/chat/conversations', { target: 'operators' });
  assert.equal(response.status, 200);
  const rootPatches = writes.filter(write => write.method === 'PATCH' && write.path === '/chat');
  assert.equal(rootPatches.length, 1);
  const conversationId = (await response.json()).conversation.conversationId;
  assert.ok(getPath(`/chat/conversations/${conversationId}`));
  assert.equal(getPath(`/chat/userConversations/passenger-atomic/${conversationId}`), true);
  assert.equal(getPath(`/chat/operatorInbox/all/${conversationId}`), true);
  assert.equal(getPath(`/chat/adminInbox/${conversationId}`), true);
  const timelineKey = getPath(`/chat/conversations/${conversationId}/timelineKey`);
  assert.equal(getPath(`/chat/userConversationTimeline/passenger-atomic/${timelineKey}`), true);
  assert.equal(getPath(`/chat/operatorTimeline/${timelineKey}`), true);
  assert.equal(getPath(`/chat/adminTimeline/${timelineKey}`), true);
});

test('message and conversation preview are persisted in one atomic update', async () => {
  setPath('/profiles/passenger-message', { role: 'passenger', active: true, name: 'Pasajero' });
  const opened = await request('passenger-message', 'POST', '/v1/chat/conversations', { target: 'operators' });
  const { conversation } = await opened.json();
  const response = await request('passenger-message', 'POST', '/v1/chat/messages', {
    conversationId: conversation.conversationId, text: 'Hola, necesito un remis.'
  });
  assert.equal(response.status, 201);
  const message = (await response.json()).message;
  assert.equal(getPath(`/chat/messages/${conversation.conversationId}/${message.blockId}/${message.messageId}`).text, 'Hola, necesito un remis.');
  assert.equal(getPath(`/chat/conversations/${conversation.conversationId}/lastMessagePreview`), 'Hola, necesito un remis.');
  const atomicPatch = writes.find(write => write.method === 'PATCH' && write.path === '/chat' && write.keys?.some(key => key.startsWith('messages/')));
  assert.ok(atomicPatch, 'expected one root PATCH containing message and conversation metadata');
  assert.ok(atomicPatch.keys.some(key => key.startsWith(`conversations/${conversation.conversationId}/lastMessageAt`)));
  const history = await request('passenger-message', 'GET', `/v1/chat/messages?conversationId=${conversation.conversationId}`);
  assert.equal(history.status, 200);
  const historyPage = await history.json();
  assert.equal(historyPage.messages.length, 1);
  assert.equal(historyPage.messages[0].text, 'Hola, necesito un remis.');
  assert.ok(atomicPatch.keys.some(key => key.startsWith(`messageTimeline/${conversation.conversationId}/`)));
});

test('conversation listing returns newest chats, not the last hash keys', async () => {
  setPath('/profiles/operator-list', { role: 'operator', active: true });
  for (let i = 0; i < 235; i++) {
    const id = `c_${String(i).padStart(3, '0')}`;
    const timelineKey = `${String(1000 + i).padStart(13, '0')}_${id}`;
    setPath(`/chat/conversations/${id}`, {
      conversationId: id, kind: 'operator-support', participantUids: { 'passenger-x': true },
      createdAt: 1000 + i, lastMessageAt: 1000 + i, timelineKey
    });
    setPath(`/chat/operatorTimeline/${timelineKey}`, true);
  }
  const response = await request('operator-list', 'GET', '/v1/chat/conversations');
  assert.equal(response.status, 200);
  const firstPage = await response.json();
  assert.equal(firstPage.conversations.length, 100);
  assert.equal(firstPage.conversations[0].conversationId, 'c_234');
  assert.equal(firstPage.conversations.at(-1).conversationId, 'c_135');
  assert.equal(firstPage.hasMore, true);
  const second = await request('operator-list', 'GET', `/v1/chat/conversations?cursor=${encodeURIComponent(firstPage.nextCursor)}`);
  const secondPage = await second.json();
  assert.equal(secondPage.conversations.length, 100);
  assert.equal(secondPage.conversations[0].conversationId, 'c_134');
  assert.equal(secondPage.conversations.at(-1).conversationId, 'c_035');
  const third = await request('operator-list', 'GET', `/v1/chat/conversations?cursor=${encodeURIComponent(secondPage.nextCursor)}`);
  const thirdPage = await third.json();
  assert.equal(thirdPage.conversations.length, 35);
  assert.equal(thirdPage.conversations[0].conversationId, 'c_034');
  assert.equal(thirdPage.conversations.at(-1).conversationId, 'c_000');
  assert.equal(thirdPage.hasMore, false);
});


test('authenticated request from a foreign browser origin is rejected before writes', async () => {
  setPath('/profiles/passenger-origin', { role: 'passenger', active: true });
  const token = await tokenFor('passenger-origin');
  const response = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'operators' })
  }), env);
  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
});

test('driver cannot start trip chat when the trip was not delivered to tripInbox', async () => {
  setPath('/profiles/driver-1', { role: 'driver', active: true, carId: '144' });
  setPath('/trips/trip-undelivered', {
    tripId: 'trip-undelivered', passengerUid: 'passenger-1', driverUid: 'driver-1', carId: '144', status: 'requested'
  });
  const response = await request('driver-1', 'POST', '/v1/chat/conversations', { tripId: 'trip-undelivered' });
  assert.equal(response.status, 403);
  assert.equal(writes.filter(write => !write.path.startsWith('/chat/rateLimits/')).length, 0);
});

test('passenger cannot attach chat context to a trip whose inbox notification failed', async () => {
  setPath('/profiles/passenger-1', { role: 'passenger', active: true });
  setPath('/profiles/driver-1', { role: 'driver', active: true, carId: '144' });
  setPath('/trips/trip-undelivered', {
    tripId: 'trip-undelivered', passengerUid: 'passenger-1', driverUid: 'driver-1', carId: '144', status: 'requested'
  });
  const response = await request('passenger-1', 'POST', '/v1/chat/conversations', {
    target: 'driver', targetUid: 'driver-1', tripId: 'trip-undelivered'
  });
  assert.equal(response.status, 403);
  assert.equal(writes.filter(write => !write.path.startsWith('/chat/rateLimits/')).length, 0);
});


test('expired blocks are not returned to participants', async () => {
  setPath('/profiles/passenger-expired', { role: 'passenger', active: true });
  const conversationId = 'c_expired';
  setPath(`/chat/conversations/${conversationId}`, {
    conversationId, kind: 'operator-support', participantUids: { 'passenger-expired': true }, createdAt: 1
  });
  setPath(`/chat/userConversations/passenger-expired/${conversationId}`, true);
  setPath(`/chat/blocks/${conversationId}/b_old`, { blockId: 'b_old', closesAt: 1, deleteAt: 2 });
  setPath(`/chat/messages/${conversationId}/b_old/m1`, { text: 'contenido vencido', createdAt: 1 });
  const response = await request('passenger-expired', 'GET', `/v1/chat/messages?conversationId=${conversationId}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages, []);
});

test('scheduled cleanup deletes expired text blocks and their expiry index', async () => {
  const now = Date.now();
  const conversationId = 'c_cleanup';
  const blockId = 'b_cleanup';
  const indexKey = `${String(now - 1000).padStart(13, '0')}_${conversationId}_${blockId}`;
  setPath(`/chat/blocks/${conversationId}/${blockId}`, { blockId, deleteAt: now - 1000 });
  setPath(`/chat/messages/${conversationId}/${blockId}/m1`, { text: 'old message', createdAt: now - 100000 });
  setPath(`/chat/expiryIndex/${indexKey}`, { conversationId, blockId, deleteAt: now - 1000 });
  setPath(`/chat/messageRequests/${conversationId}/c_request1`, {
    senderUid: "passenger-old", contentHash: "hash", messageId: "m_old", blockId, createdAt: now - 200000
  });
  setPath(`/chat/messageRequestIndex/${conversationId}/${blockId}/c_request1`, true);
  const timelineKey = `${String(now - 100000).padStart(13, '0')}_m1`;
  setPath(`/chat/messageTimeline/${conversationId}/${timelineKey}`, { messageId: 'm1', blockId, message: { text: 'old message' } });
  setPath(`/chat/messageTimelineByBlock/${conversationId}/${blockId}/${timelineKey}`, true);
  const result = await scheduledChatCleanup(env);
  assert.equal(result.deletedBlocks, 1);
  assert.equal(result.failed, 0);
  assert.equal(getPath(`/chat/blocks/${conversationId}/${blockId}`), null);
  assert.equal(getPath(`/chat/messages/${conversationId}/${blockId}`), null);
  assert.equal(getPath(`/chat/expiryIndex/${indexKey}`), null);
  assert.equal(getPath(`/chat/messageRequests/${conversationId}/c_request1`), null);
  assert.equal(getPath(`/chat/messageRequestIndex/${conversationId}/${blockId}`), null);
  assert.equal(getPath(`/chat/messageTimeline/${conversationId}/${timelineKey}`), null);
  assert.equal(getPath(`/chat/messageTimelineByBlock/${conversationId}/${blockId}`), null);
});

test('failed first message persistence leaves a pending block without starting retention', async () => {
  setPath('/profiles/passenger-pending', { role: 'passenger', active: true });
  const opened = await request('passenger-pending', 'POST', '/v1/chat/conversations', { target: 'operators' });
  const { conversation } = await opened.json();
  failNextMessagePatch = true;
  const response = await request('passenger-pending', 'POST', '/v1/chat/messages', {
    conversationId: conversation.conversationId, text: 'Primer intento que falla'
  });
  assert.equal(response.status, 502);
  const block = getPath(`/chat/conversations/${conversation.conversationId}/currentBlock`);
  assert.equal(block.status, 'pending');
  assert.equal(block.startedAt, undefined);
  assert.equal(block.closesAt, undefined);
  assert.equal(block.deleteAt, undefined);
  assert.deepEqual(getPath(`/chat/messages/${conversation.conversationId}/${block.blockId}`), null);
  assert.equal(getPath('/chat/expiryIndex'), null, 'pending blocks must not enter the expiry index');
});

test('the 24-hour clock starts at the first message successfully persisted', async () => {
  setPath('/profiles/passenger-first-message', { role: 'passenger', active: true, name: 'Pasajero' });
  const opened = await request('passenger-first-message', 'POST', '/v1/chat/conversations', { target: 'operators' });
  const { conversation } = await opened.json();
  const response = await request('passenger-first-message', 'POST', '/v1/chat/messages', {
    conversationId: conversation.conversationId, text: 'Primer mensaje aceptado'
  });
  assert.equal(response.status, 201);
  const { message } = await response.json();
  const current = getPath(`/chat/conversations/${conversation.conversationId}/currentBlock`);
  assert.equal(current.status, 'open');
  assert.equal(current.startedAt, message.createdAt);
  assert.equal(current.closesAt, message.createdAt + 24 * 60 * 60 * 1000);
  assert.equal(current.deleteAt, current.closesAt + 14 * 24 * 60 * 60 * 1000);
  assert.equal(getPath(`/chat/blocks/${conversation.conversationId}/${current.blockId}/status`), 'open');
});

test('retrying the same clientMessageId returns the original message without duplicating it', async () => {
  setPath('/profiles/passenger-idempotent', { role: 'passenger', active: true });
  const opened = await request('passenger-idempotent', 'POST', '/v1/chat/conversations', { target: 'operators' });
  const { conversation } = await opened.json();
  const body = { conversationId: conversation.conversationId, text: 'Mensaje con reintento', clientMessageId: 'retry-message-0001' };
  const first = await request('passenger-idempotent', 'POST', '/v1/chat/messages', body);
  const second = await request('passenger-idempotent', 'POST', '/v1/chat/messages', body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const firstMessage = (await first.json()).message;
  const secondMessage = (await second.json()).message;
  assert.equal(firstMessage.messageId, secondMessage.messageId);
  assert.equal(secondMessage.idempotent, true);
  const stored = getPath(`/chat/messages/${conversation.conversationId}/${firstMessage.blockId}`);
  assert.equal(Object.keys(stored).length, 1);
});

test('reusing a clientMessageId with different content is rejected', async () => {
  setPath('/profiles/passenger-id-conflict', { role: 'passenger', active: true });
  const opened = await request('passenger-id-conflict', 'POST', '/v1/chat/conversations', { target: 'operators' });
  const { conversation } = await opened.json();
  const clientMessageId = 'same-message-id-0001';
  const first = await request('passenger-id-conflict', 'POST', '/v1/chat/messages', {
    conversationId: conversation.conversationId, text: 'Contenido original', clientMessageId
  });
  const second = await request('passenger-id-conflict', 'POST', '/v1/chat/messages', {
    conversationId: conversation.conversationId, text: 'Contenido modificado', clientMessageId
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
});

test('configured administrator can use trip chat as the driver assigned to car 144', async () => {
  setPath('/profiles/admin-uid', { role: 'admin', active: true, carId: '144', name: 'Agustín' });
  setPath('/trips/admin-trip-144', {
    tripId: 'admin-trip-144', passengerUid: 'passenger-144', driverUid: 'admin-uid', carId: '144', status: 'accepted'
  });
  setPath('/tripInbox/144/admin-trip-144', { tripId: 'admin-trip-144', status: 'accepted' });
  const response = await request('admin-uid', 'POST', '/v1/chat/conversations', { tripId: 'admin-trip-144' });
  assert.equal(response.status, 200);
  const { conversation } = await response.json();
  assert.equal(conversation.kind, 'passenger-driver');
  assert.equal(conversation.participantUids['admin-uid'], true);
  assert.equal(conversation.participantUids['passenger-144'], true);
  assert.equal(conversation.tripIds['admin-trip-144'], true);
});

test('configured administrator cannot use driver chat for a car other than 144', async () => {
  setPath('/profiles/admin-uid', { role: 'admin', active: true, carId: '144', name: 'Agustín' });
  setPath('/trips/admin-trip-137', {
    tripId: 'admin-trip-137', passengerUid: 'passenger-137', driverUid: 'admin-uid', carId: '137', status: 'accepted'
  });
  setPath('/tripInbox/137/admin-trip-137', { tripId: 'admin-trip-137', status: 'accepted' });
  const response = await request('admin-uid', 'POST', '/v1/chat/conversations', { tripId: 'admin-trip-137' });
  assert.equal(response.status, 403);
});

test('concurrent first messages share one pending block and preserve both messages', async () => {
  setPath('/profiles/passenger-concurrent', { role: 'passenger', active: true });
  const opened = await request('passenger-concurrent', 'POST', '/v1/chat/conversations', { target: 'operators' });
  const { conversation } = await opened.json();
  const [one, two] = await Promise.all([
    request('passenger-concurrent', 'POST', '/v1/chat/messages', {
      conversationId: conversation.conversationId, text: 'Mensaje concurrente uno', clientMessageId: 'concurrent-message-0001'
    }),
    request('passenger-concurrent', 'POST', '/v1/chat/messages', {
      conversationId: conversation.conversationId, text: 'Mensaje concurrente dos', clientMessageId: 'concurrent-message-0002'
    })
  ]);
  assert.equal(one.status, 201);
  assert.equal(two.status, 201);
  const first = (await one.json()).message;
  const second = (await two.json()).message;
  assert.equal(first.blockId, second.blockId);
  const stored = getPath(`/chat/messages/${conversation.conversationId}/${first.blockId}`);
  assert.equal(Object.keys(stored).length, 2);
  const current = getPath(`/chat/conversations/${conversation.conversationId}/currentBlock`);
  assert.equal(current.status, 'open');
  assert.equal(current.startedAt, Math.min(first.createdAt, second.createdAt));
  assert.equal(Object.keys(stored).length, 2, 'both independent messages must survive concurrent writes');
  const timeline = getPath(`/chat/messageTimeline/${conversation.conversationId}`);
  assert.equal(Object.keys(timeline).length, 2);
  const listed = await request('passenger-concurrent', 'GET', '/v1/chat/conversations');
  const listedPage = await listed.json();
  assert.equal(listedPage.conversations.length, 1, 'concurrent timeline writes must not duplicate a conversation');
  const userTimeline = getPath('/chat/userConversationTimeline/passenger-concurrent') || {};
  assert.equal(Object.keys(userTimeline).length, 1, 'stale user conversation timeline keys are pruned');
});


test('the Firebase mock rejects a stale If-Match ETag with HTTP 412', async () => {
  const path = '/chat/etag-probe';
  setPath(path, { value: 1 });
  const url = `https://dante-chat-test-default-rtdb.firebaseio.com${path}.json`;
  const snapshot = await globalThis.fetch(url, { method: 'GET', headers: { 'X-Firebase-ETag': 'true' } });
  const etag = snapshot.headers.get('ETag');
  assert.ok(etag);
  const first = await globalThis.fetch(url, {
    method: 'PUT', headers: { 'if-match': etag, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 2 })
  });
  assert.equal(first.status, 200);
  const stale = await globalThis.fetch(url, {
    method: 'PUT', headers: { 'if-match': etag, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 3 })
  });
  assert.equal(stale.status, 412);
  assert.equal(etagConflicts, 1);
  assert.deepEqual(getPath(path), { value: 2 });
});


test('passenger and operator can select the configured administrator as car 144 driver', async () => {
  setPath('/profiles/admin-uid', { role: 'admin', active: true, carId: '144', name: 'Agustín' });
  setPath('/profiles/passenger-select-admin', { role: 'passenger', active: true });
  setPath('/profiles/operator-select-admin', { role: 'operator', active: true });

  const passengerResponse = await request('passenger-select-admin', 'POST', '/v1/chat/conversations', {
    target: 'driver', targetUid: 'admin-uid'
  });
  assert.equal(passengerResponse.status, 200);
  const passengerConversation = (await passengerResponse.json()).conversation;
  assert.equal(passengerConversation.kind, 'passenger-driver');
  assert.equal(passengerConversation.participantUids['admin-uid'], true);

  const operatorResponse = await request('operator-select-admin', 'POST', '/v1/chat/conversations', {
    target: 'driver', targetUid: 'admin-uid'
  });
  assert.equal(operatorResponse.status, 200);
  const operatorConversation = (await operatorResponse.json()).conversation;
  assert.equal(operatorConversation.kind, 'operator-driver');
  assert.equal(operatorConversation.participantUids['admin-uid'], true);
});

test('a non-root profile with role admin is not selectable as a driver', async () => {
  setPath('/profiles/not-admin', { role: 'admin', active: true, carId: '144' });
  setPath('/profiles/passenger-select-fake-admin', { role: 'passenger', active: true });
  const response = await request('passenger-select-fake-admin', 'POST', '/v1/chat/conversations', {
    target: 'driver', targetUid: 'not-admin'
  });
  assert.equal(response.status, 403);
});

test('message send rate limit returns 429 and Retry-After after eight sends in a fixed ten-second window', async () => {
  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    setPath('/profiles/passenger-rate', { role: 'passenger', active: true });
    const opened = await request('passenger-rate', 'POST', '/v1/chat/conversations', { target: 'operators' });
    const { conversation } = await opened.json();
    for (let i = 0; i < 8; i++) {
      const response = await request('passenger-rate', 'POST', '/v1/chat/messages', { conversationId: conversation.conversationId, text: 'Mensaje limitado ' + i });
      assert.equal(response.status, 201);
    }
    const blocked = await request('passenger-rate', 'POST', '/v1/chat/messages', { conversationId: conversation.conversationId, text: 'Mensaje excedido' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
    assert.equal(blocked.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
    assert.match((await blocked.json()).error, /Too many chat requests/);
  } finally { Date.now = originalNow; }
});

test('message history supports a second chronological page', async () => {
  setPath('/profiles/passenger-history', { role: 'passenger', active: true });
  const conversationId = 'c_history';
  setPath('/chat/conversations/' + conversationId, { conversationId, kind: 'operator-support', participantUids: { 'passenger-history': true }, createdAt: 1 });
  for (let i = 0; i < 105; i++) {
    const blockId = 'b_' + Math.floor(i / 50);
    const messageId = 'm_' + String(i).padStart(3, '0');
    const key = String(2000 + i).padStart(13, '0') + '_' + messageId;
    const message = { senderUid: 'passenger-history', text: 'Mensaje ' + i, createdAt: 2000 + i };
    setPath('/chat/blocks/' + conversationId + '/' + blockId, { blockId, status: 'open', deleteAt: Date.now() + 100000, closesAt: Date.now() + 50000 });
    setPath('/chat/messageTimeline/' + conversationId + '/' + key, { messageId, blockId, message });
  }
  const first = await request('passenger-history', 'GET', '/v1/chat/messages?conversationId=' + conversationId);
  const firstPage = await first.json();
  assert.equal(firstPage.messages.length, 100);
  assert.equal(firstPage.messages[0].text, 'Mensaje 5');
  assert.equal(firstPage.messages.at(-1).text, 'Mensaje 104');
  assert.equal(firstPage.hasMore, true);
  const second = await request('passenger-history', 'GET', '/v1/chat/messages?conversationId=' + conversationId + '&cursor=' + encodeURIComponent(firstPage.nextCursor));
  const secondPage = await second.json();
  assert.equal(secondPage.messages.length, 5);
  assert.equal(secondPage.messages[0].text, 'Mensaje 0');
  assert.equal(secondPage.hasMore, false);
});

test('conversation creation limit returns 429 after five starts per minute', async () => {
  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    setPath('/profiles/passenger-create-rate', { role: 'passenger', active: true });
    for (let i = 0; i < 5; i++) {
      const response = await request('passenger-create-rate', 'POST', '/v1/chat/conversations', { target: 'operators' });
      assert.equal(response.status, 200);
    }
    const blocked = await request('passenger-create-rate', 'POST', '/v1/chat/conversations', { target: 'operators' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
  } finally { Date.now = originalNow; }
});

test('invalid message history cursor is rejected', async () => {
  setPath('/profiles/passenger-invalid-cursor', { role: 'passenger', active: true });
  const response = await request('passenger-invalid-cursor', 'GET', '/v1/chat/messages?conversationId=c_any&cursor=bad');
  assert.equal(response.status, 400);
});

test('a new block starts exactly when the previous 24-hour window closes', async () => {
  const originalNow = Date.now;
  const start = 1_800_000_000_000;
  Date.now = () => start;
  try {
    setPath('/profiles/passenger-boundary', { role: 'passenger', active: true });
    const opened = await request('passenger-boundary', 'POST', '/v1/chat/conversations', { target: 'operators' });
    const { conversation } = await opened.json();
    const firstResponse = await request('passenger-boundary', 'POST', '/v1/chat/messages', { conversationId: conversation.conversationId, text: 'Primer bloque' });
    assert.equal(firstResponse.status, 201);
    const firstMessage = (await firstResponse.json()).message;
    const firstBlockId = firstMessage.blockId;
    const firstDeleteAt = start + 24 * 60 * 60 * 1000 + 14 * 24 * 60 * 60 * 1000;
    Date.now = () => start + 24 * 60 * 60 * 1000;
    const secondResponse = await request('passenger-boundary', 'POST', '/v1/chat/messages', { conversationId: conversation.conversationId, text: 'Segundo bloque' });
    assert.equal(secondResponse.status, 201);
    const secondMessage = (await secondResponse.json()).message;
    assert.notEqual(secondMessage.blockId, firstBlockId);
    const closed = getPath('/chat/blocks/' + conversation.conversationId + '/' + firstBlockId);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.deleteAt, firstDeleteAt);
    const current = getPath('/chat/conversations/' + conversation.conversationId + '/currentBlock');
    assert.equal(current.status, 'open');
    assert.equal(current.startedAt, start + 24 * 60 * 60 * 1000);
  } finally { Date.now = originalNow; }
});

test('scheduled cleanup deletes a block at the exact deleteAt timestamp', async () => {
  const originalNow = Date.now;
  const now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const conversationId = 'c_exact_expiry';
    const blockId = 'b_exact_expiry';
    const indexKey = String(now).padStart(13, '0') + '_' + conversationId + '_' + blockId;
    setPath('/chat/blocks/' + conversationId + '/' + blockId, { blockId, status: 'closed', deleteAt: now });
    setPath('/chat/messages/' + conversationId + '/' + blockId + '/m_exact', { text: 'Vence ahora', createdAt: now - 1 });
    setPath('/chat/expiryIndex/' + indexKey, { conversationId, blockId, deleteAt: now });
    const result = await scheduledChatCleanup(env);
    assert.equal(result.deletedBlocks, 1);
    assert.equal(result.failed, 0);
    assert.equal(getPath('/chat/blocks/' + conversationId + '/' + blockId), null);
    assert.equal(getPath('/chat/expiryIndex/' + indexKey), null);
  } finally { Date.now = originalNow; }
});

test('scheduled cleanup removes malformed expiry indexes so they cannot starve valid expired blocks', async () => {
  const originalNow = Date.now;
  const now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const badKey = '0000000000001_malformed';
    const conversationId = 'c_after_malformed';
    const blockId = 'b_after_malformed';
    const validKey = String(now).padStart(13, '0') + '_' + conversationId + '_' + blockId;
    setPath('/chat/expiryIndex/' + badKey, { conversationId, deleteAt: 1 });
    setPath('/chat/blocks/' + conversationId + '/' + blockId, { blockId, status: 'closed', deleteAt: now });
    setPath('/chat/expiryIndex/' + validKey, { conversationId, blockId, deleteAt: now });
    const result = await scheduledChatCleanup(env);
    assert.equal(result.deletedBlocks, 1);
    assert.equal(result.failed, 0);
    assert.equal(getPath('/chat/expiryIndex/' + badKey), null);
    assert.equal(getPath('/chat/blocks/' + conversationId + '/' + blockId), null);
    assert.equal(getPath('/chat/expiryIndex/' + validKey), null);
  } finally { Date.now = originalNow; }
});

test('CORS supports the default Capacitor Android origin through APP_ORIGINS without wildcard access', async () => {
  const mobileEnv = { ...env, APP_ORIGINS: 'https://localhost' };
  const android = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'OPTIONS', headers: { Origin: 'https://localhost' }
  }), mobileEnv);
  assert.equal(android.status, 204);
  assert.equal(android.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
  setPath('/profiles/passenger-capacitor-live', { role: 'passenger', active: true });
  const actual = await request('passenger-capacitor-live', 'GET', '/v1/chat/conversations', undefined, 'https://localhost', mobileEnv);
  assert.equal(actual.status, 200);
  assert.equal(actual.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
  const attacker = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'OPTIONS', headers: { Origin: 'https://attacker.example' }
  }), mobileEnv);
  assert.equal(attacker.status, 403);
});

test('CORS allowlist-only configuration is sufficient when legacy APP_ORIGIN is empty', async () => {
  const mobileEnv = { ...env, APP_ORIGIN: '', APP_ORIGINS: 'https://localhost' };
  const response = await handleChatRequest(new Request('https://worker.example.test/v1/chat/conversations', {
    method: 'OPTIONS', headers: { Origin: 'https://localhost' }
  }), mobileEnv);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
});
