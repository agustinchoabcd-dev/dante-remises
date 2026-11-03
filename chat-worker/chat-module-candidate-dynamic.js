/*
 * Dante Remises — chat text module candidate (NOT deployed).
 * Integrates with the existing combined B2 Worker through fetch routing.
 * This module intentionally does not replace /test/* or /v1/profile-photo/*.
 * It handles text messages only; attachments, FCM and B2 chat storage are later phases.
 */

const CHAT_ROOT = "chat";
const CHAT_MESSAGE_MAX = 2000;
const CHAT_PAGE_SIZE = 100;
const CHAT_BLOCK_MS = 24 * 60 * 60 * 1000;
const CHAT_RETENTION_AFTER_CLOSE_MS = 14 * 24 * 60 * 60 * 1000;
const CHAT_CLEANUP_BATCH = 100;
const FIREBASE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Roles and staff assignments are read dynamically from /profiles/{uid} in RTDB.
// The sole administrator identity is supplied as a protected Worker variable.
// No driver/operator UID lists are embedded in this module.

let firebasePublicKeys = null;
let firebasePublicKeysExpireAt = 0;
let serviceTokenCache = { token: null, expiresAt: 0 };
let serviceSigningKeyPromise = null;

export async function handleChatRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/chat/")) return null;

  // Browser CORS preflight requests do not carry the Firebase bearer token.
  // They only need the configured origin; backend credentials are checked for
  // actual data operations after the preflight has been answered.
  const origin = request.headers.get("Origin");
  const allowedOrigin = String(env.APP_ORIGIN || "").trim();
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
    return new Response(null, { status: 403, headers: { "Vary": "Origin", "Cache-Control": "no-store" } });
  }
  if (request.method === "OPTIONS") {
    if (!allowedOrigin) return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
    return new Response(null, { status: 204, headers: chatCorsHeaders(request, env) });
  }
  if (!isChatConfigured(env)) return chatJson({ error: "Chat backend configuration is incomplete" }, 503, request, env);

  try {
    const actor = await requireChatActor(request, env);

    if (request.method === "POST" && url.pathname === "/v1/chat/conversations") {
      await enforceRateLimit(actor, "conversation-create", 5, 60_000, env);
      const body = await readJson(request);
      const conversation = await openConversation(actor, body, env);
      return chatJson({ conversation }, 200, request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/chat/conversations") {
      await enforceRateLimit(actor, "conversation-list", 60, 60_000, env);
      const cursor = url.searchParams.get("cursor") || "";
      if (cursor && !isSafeTimelineCursor(cursor)) return chatJson({ error: "Invalid cursor" }, 400, request, env);
      const page = await listConversations(actor, env, cursor);
      return chatJson(page, 200, request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/chat/messages") {
      await enforceRateLimit(actor, "message-list", 60, 60_000, env);
      const conversationId = url.searchParams.get("conversationId") || "";
      if (!isSafeId(conversationId)) return chatJson({ error: "Invalid conversationId" }, 400, request, env);
      const cursor = url.searchParams.get("cursor") || "";
      if (cursor && !isSafeTimelineCursor(cursor)) return chatJson({ error: "Invalid cursor" }, 400, request, env);
      const page = await listMessages(actor, conversationId, env, cursor);
      return chatJson(page, 200, request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/messages") {
      await enforceRateLimit(actor, "message-send-fast", 8, 10_000, env);
      const body = await readJson(request);
      const message = await sendTextMessage(actor, body, env);
      return chatJson({ message }, message.idempotent ? 200 : 201, request, env);
    }

    return chatJson({ error: "Not found" }, 404, request, env);
  } catch (error) {
    if (error instanceof ChatAuthError) {
      const response = chatJson({ error: error.message }, error.status, request, env);
      if (!error.retryAfter) return response;
      const headers = new Headers(response.headers);
      headers.set('Retry-After', String(error.retryAfter));
      return new Response(response.body, { status: response.status, headers });
    }
    console.error("Chat request failed", error instanceof Error ? error.name : "UnknownError");
    return chatJson({ error: "Chat request failed" }, 502, request, env);
  }
}

export async function scheduledChatCleanup(env) {
  if (!isChatConfigured(env)) {
    console.error("Chat cleanup skipped: backend configuration is incomplete");
    return { deletedBlocks: 0, failed: 1 };
  }

  let deletedBlocks = 0;
  let failed = 0;
  const now = Date.now();
  const endKey = String(now).padStart(13, "0") + "_\uf8ff";

  for (let batch = 0; batch < 10; batch++) {
    const query = new URLSearchParams({ orderBy: '"$key"', endAt: JSON.stringify(endKey), limitToFirst: String(CHAT_CLEANUP_BATCH) });
    const entries = await firebaseDbRequest(env, `/chat/expiryIndex.json?${query}`, { method: "GET" });
    if (!entries || typeof entries !== "object") break;
    const rows = Object.entries(entries);
    if (!rows.length) break;

    const failuresBeforeBatch = failed;
    for (const [indexKey, entry] of rows) {
      if (!entry || !Number.isFinite(entry.deleteAt) || entry.deleteAt > now) continue;
      try {
        const blockPath = `/chat/blocks/${entry.conversationId}/${entry.blockId}`;
        const block = await firebaseDbRequest(env, `${blockPath}.json`, { method: "GET" });
        if (block && Number(block.deleteAt) <= now) {
          const [requestIndex, timelineIndex] = await Promise.all([
            firebaseDbRequest(env, `/chat/messageRequestIndex/${entry.conversationId}/${entry.blockId}.json`, { method: "GET" }),
            firebaseDbRequest(env, `/chat/messageTimelineByBlock/${entry.conversationId}/${entry.blockId}.json`, { method: "GET" })
          ]);
          const cleanup = {
            [`messages/${entry.conversationId}/${entry.blockId}`]: null,
            [`messageRequestIndex/${entry.conversationId}/${entry.blockId}`]: null,
            [`messageTimelineByBlock/${entry.conversationId}/${entry.blockId}`]: null,
            [`blocks/${entry.conversationId}/${entry.blockId}`]: null,
            [`expiryIndex/${indexKey}`]: null
          };
          for (const requestKey of Object.keys(requestIndex || {})) {
            if (isSafeId(requestKey)) cleanup[`messageRequests/${entry.conversationId}/${requestKey}`] = null;
          }
          for (const timelineKey of Object.keys(timelineIndex || {})) {
            if (isSafeTimelineCursor(timelineKey)) cleanup[`messageTimeline/${entry.conversationId}/${timelineKey}`] = null;
          }
          await firebaseDbRequest(env, "/chat.json", { method: "PATCH", token: await getFirebaseAdminToken(env), body: cleanup });
          deletedBlocks++;
        } else {
          await firebaseDbRequest(env, `/chat/expiryIndex/${indexKey}.json`, { method: "DELETE" });
        }
      } catch (error) {
        failed++;
        console.error("Chat block cleanup failed", error instanceof Error ? error.name : "UnknownError");
      }
    }
    if (rows.length < CHAT_CLEANUP_BATCH || failed > failuresBeforeBatch) break;
  }

  return { deletedBlocks, failed };
}

export async function scheduled(event, env, ctx) {
  ctx.waitUntil(scheduledChatCleanup(env));
}

async function requireChatActor(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new ChatAuthError("Firebase sign-in required", 401);
  const idToken = authorization.slice(7).trim();
  if (!idToken || idToken.length > 8192) throw new ChatAuthError("Invalid Firebase ID token", 401);
  const identity = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  const adminToken = await getFirebaseAdminToken(env);
  const profile = await firebaseDbRequest(env, `/profiles/${identity.uid}.json`, { method: "GET", token: adminToken });
  if (!profile || profile.active === false || profile.status === "disabled") {
    throw new ChatAuthError("Account is not enabled for chat", 403);
  }
  const allowedRoles = new Set(["passenger", "driver", "operator", "admin"]);
  if (!allowedRoles.has(profile.role)) throw new ChatAuthError("Account role is invalid", 403);
  // The configured administrator UID is the single root of trust. A profile
  // cannot grant admin rights to another account by changing its role field.
  const isConfiguredAdmin = Boolean(env.ADMIN_UID) && identity.uid === env.ADMIN_UID;
  if (profile.role === "admin" && !isConfiguredAdmin) {
    throw new ChatAuthError("Administrator role is reserved", 403);
  }
  if (isConfiguredAdmin && profile.role !== "admin") {
    throw new ChatAuthError("Administrator profile is misconfigured", 403);
  }
  const carId = profile.role === "driver"
    ? String(profile.carId || "")
    : isConfiguredAdmin
      ? String(profile.carId || "144")
      : "";
  if (profile.role === "driver" && !carId) throw new ChatAuthError("Driver account has no assigned car", 403);
  if (isConfiguredAdmin && carId !== "144") {
    throw new ChatAuthError("Administrator driver assignment is fixed to car 144", 403);
  }
  return {
    uid: identity.uid,
    role: profile.role,
    name: [profile.name, profile.lastName].filter(Boolean).join(" ") || profile.name || profile.email || profile.role,
    carId,
    profile,
    adminToken
  };
}

async function openConversation(actor, body, env) {
  const target = body?.target;
  const targetUid = typeof body?.targetUid === "string" ? body.targetUid : "";
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  if (tripId && !isSafeId(tripId)) throw new ChatAuthError("Invalid tripId", 400);
  let participantUids;
  let kind;
  let scope;

  if (actor.role === "passenger") {
    if (target === "operators") {
      // Operator membership is role-based, not frozen to the operators who
      // happened to exist when this support conversation was first created.
      participantUids = [actor.uid];
      kind = "operator-support";
      scope = `operator-support:${actor.uid}`;
    } else if (target === "driver" && isSafeUid(targetUid)) {
      const targetProfile = await firebaseDbRequest(env, `/profiles/${targetUid}.json`, { method: "GET", token: actor.adminToken });
      if (!isChatDriverProfile(targetUid, targetProfile, env)) {
        throw new ChatAuthError("Selected driver is not active", 403);
      }
      participantUids = [actor.uid, targetUid];
      kind = "passenger-driver";
      scope = `direct:${participantUids.slice().sort().join(":")}`;
    } else {
      throw new ChatAuthError("Passenger can start a chat with Operators or an active driver", 403);
    }
  } else if (actor.role === "operator") {
    if (target !== "driver" || !isSafeUid(targetUid)) throw new ChatAuthError("Operators can initiate conversations with active drivers only", 403);
    const targetProfile = await firebaseDbRequest(env, `/profiles/${targetUid}.json`, { method: "GET", token: actor.adminToken });
    if (!isChatDriverProfile(targetUid, targetProfile, env)) {
        throw new ChatAuthError("Selected driver is not active", 403);
      }
    participantUids = [actor.uid, targetUid];
    kind = "operator-driver";
    scope = `direct:${participantUids.slice().sort().join(":")}`;
  } else if (actor.role === "driver" || (actor.role === "admin" && actor.carId === "144" && Boolean(tripId))) {
    if (!tripId) throw new ChatAuthError("A driver can start a passenger chat only from a valid trip", 403);
    const trip = await firebaseDbRequest(env, `/trips/${tripId}.json`, { method: "GET", token: actor.adminToken });
    if (!trip || trip.driverUid !== actor.uid || String(trip.carId) !== actor.carId || !trip.passengerUid || !["requested", "accepted", "in_progress"].includes(trip.status)) {
      throw new ChatAuthError("Trip does not authorize this conversation", 403);
    }
    const inboxEntry = await firebaseDbRequest(env, `/tripInbox/${trip.carId}/${tripId}.json`, { method: "GET", token: actor.adminToken });
    if (!inboxEntry || inboxEntry.tripId !== tripId || !["requested", "accepted"].includes(inboxEntry.status)) {
      throw new ChatAuthError("Trip request was not successfully delivered to the driver's inbox", 403);
    }
    participantUids = [actor.uid, trip.passengerUid];
    kind = "passenger-driver";
    scope = `direct:${participantUids.slice().sort().join(":")}`;
  } else if (actor.role === "admin") {
    if (!targetUid || !isSafeUid(targetUid) || targetUid === actor.uid) throw new ChatAuthError("A valid recipient is required", 400);
    const targetProfile = await firebaseDbRequest(env, `/profiles/${targetUid}.json`, { method: "GET", token: actor.adminToken });
    if (!targetProfile || targetProfile.active === false || targetProfile.status === "disabled") throw new ChatAuthError("Recipient not found or disabled", 404);
    participantUids = [actor.uid, targetUid];
    kind = "admin-direct";
    scope = `direct:${participantUids.slice().sort().join(":")}`;
  } else {
    throw new ChatAuthError("Role cannot start a conversation", 403);
  }

  if (tripId && actor.role !== "driver") {
    const trip = await firebaseDbRequest(env, `/trips/${tripId}.json`, { method: "GET", token: actor.adminToken });
    if (!trip || !participantUids.includes(trip.passengerUid) || !participantUids.includes(trip.driverUid) || !["requested", "accepted", "in_progress"].includes(trip.status)) {
      throw new ChatAuthError("Trip context does not match participants or is no longer active", 403);
    }
    const inboxEntry = await firebaseDbRequest(env, `/tripInbox/${trip.carId}/${tripId}.json`, { method: "GET", token: actor.adminToken });
    if (!inboxEntry || inboxEntry.tripId !== tripId || !["requested", "accepted"].includes(inboxEntry.status)) {
      throw new ChatAuthError("Trip request was not successfully delivered to the driver's inbox", 403);
    }
  }

  const conversationId = await stableId(scope);
  const existing = await firebaseDbRequest(env, `/chat/conversations/${conversationId}.json`, { method: "GET", token: actor.adminToken });
  const now = Date.now();
  const timelineKey = timelineKeyFor(now, conversationId);
  const conversation = existing || {
    conversationId,
    kind,
    participantUids: Object.fromEntries(participantUids.map(uid => [uid, true])),
    createdAt: now,
    createdBy: actor.uid,
    lastMessageAt: now,
    lastMessagePreview: "",
    timelineKey,
    ...(tripId ? { tripId } : {})
  };

  if (tripId) conversation.tripIds = { ...(conversation.tripIds || {}), [tripId]: true };

  if (!existing) {
    // Firebase RTDB multi-location PATCH keeps the conversation and all inbox
    // indexes consistent: a failed write cannot leave a half-created chat.
    const updates = {
      [`conversations/${conversationId}`]: conversation,
      [`adminInbox/${conversationId}`]: true,
      [`adminTimeline/${timelineKey}`]: true
    };
    for (const uid of participantUids) {
      updates[`userConversations/${uid}/${conversationId}`] = true;
      updates[`userConversationTimeline/${uid}/${timelineKey}`] = true;
    }
    if (kind === "operator-support") {
      updates[`operatorInbox/all/${conversationId}`] = true;
      updates[`operatorTimeline/${timelineKey}`] = true;
    }
    await firebaseDbRequest(env, "/chat.json", { method: "PATCH", token: actor.adminToken, body: updates });
  } else if (tripId) {
    await firebaseDbRequest(env, `/chat/conversations/${conversationId}/tripIds.json`, {
      method: "PATCH", token: actor.adminToken, body: { [tripId]: true }
    });
  }
  return conversation;
}

async function listConversations(actor, env, cursor = "") {
  const feeds = [`/chat/userConversationTimeline/${actor.uid}`];
  if (actor.role === "operator") feeds.push("/chat/operatorTimeline");
  if (actor.role === "admin") feeds.push("/chat/adminTimeline");
  const feedRows = await Promise.all(feeds.map(path => queryTimeline(env, path, cursor, CHAT_PAGE_SIZE + 1)));
  const keys = [...new Set(feedRows.flatMap(rows => rows.map(row => row.key)))].sort().reverse();
  const selected = keys.slice(0, CHAT_PAGE_SIZE + 1);
  const hasMore = selected.length > CHAT_PAGE_SIZE;
  const pageKeys = selected.slice(0, CHAT_PAGE_SIZE);
  const conversations = [];
  for (let offset = 0; offset < pageKeys.length; offset += 20) {
    const batch = await Promise.all(pageKeys.slice(offset, offset + 20).map(async key => {
      const conversationId = key.slice(14);
      const item = await firebaseDbRequest(env, `/chat/conversations/${conversationId}.json`, { method: "GET", token: actor.adminToken });
      return item && (!item.timelineKey || item.timelineKey === key) && canAccessConversation(actor, item) ? item : null;
    }));
    conversations.push(...batch.filter(Boolean));
  }
  return { conversations, nextCursor: hasMore && pageKeys.length ? pageKeys.at(-1) : null, hasMore };
}

async function listMessages(actor, conversationId, env, cursor = "") {
  await getConversation(actor, conversationId, env);
  const rows = await queryTimeline(env, `/chat/messageTimeline/${conversationId}`, cursor, CHAT_PAGE_SIZE + 1);
  const selected = rows.slice(-CHAT_PAGE_SIZE);
  const blockIds = [...new Set(selected.map(row => row.value?.blockId).filter(Boolean))];
  const blockMap = new Map();
  for (let offset = 0; offset < blockIds.length; offset += 20) {
    const batch = await Promise.all(blockIds.slice(offset, offset + 20).map(async blockId => {
      const block = await firebaseDbRequest(env, `/chat/blocks/${conversationId}/${blockId}.json`, { method: "GET", token: actor.adminToken });
      return [blockId, block];
    }));
    for (const [blockId, block] of batch) blockMap.set(blockId, block);
  }
  const now = Date.now();
  const messages = selected.map(row => {
    const entry = row.value;
    const block = blockMap.get(entry?.blockId);
    if (!entry?.message || !block || block.status === "pending" || Number(block.deleteAt) <= now) return null;
    return { ...entry.message, messageId: entry.messageId, blockId: entry.blockId, blockClosesAt: block.closesAt };
  }).filter(Boolean);
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  return { messages, nextCursor: hasMore && selected.length ? selected[0].key : null, hasMore };
}

async function queryTimeline(env, path, cursor, limit) {
  const upperBound = cursor || "9999999999999_\uf8ff";
  const query = new URLSearchParams({ orderBy: '"$key"', endAt: JSON.stringify(upperBound), limitToLast: String(limit + (cursor ? 1 : 0)) });
  const entries = await firebaseDbRequest(env, `${path}.json?${query}`, { method: "GET" }) || {};
  return Object.entries(entries).filter(([key]) => !cursor || key < cursor).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value }));
}

async function sendTextMessage(actor, body, env) {
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const clientMessageId = typeof body?.clientMessageId === "string" ? body.clientMessageId : "";
  if (!isSafeId(conversationId)) throw new ChatAuthError("Invalid conversationId", 400);
  if (!text || text.length > CHAT_MESSAGE_MAX) throw new ChatAuthError(`Message must contain 1-${CHAT_MESSAGE_MAX} characters`, 400);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientMessageId)) {
    throw new ChatAuthError("A stable clientMessageId (8-128 safe characters) is required", 400);
  }

  const conversation = await getConversation(actor, conversationId, env);
  const contentHash = await stableId(text);
  const requestKey = await stableId(`${actor.uid}:${clientMessageId}`);
  const messageId = `m_${requestKey.slice(2)}`;
  const requestPath = `/chat/messageRequests/${conversationId}/${requestKey}.json`;
  let requestSnapshot = await firebaseDbRequest(env, requestPath, {
    method: "GET", token: actor.adminToken, wantEtag: true
  });
  let requestRecord = requestSnapshot.data;
  let block;

  if (requestRecord) {
    if (requestRecord.senderUid !== actor.uid || requestRecord.contentHash !== contentHash) {
      throw new ChatAuthError("clientMessageId was already used for a different message", 409);
    }
    block = await firebaseDbRequest(env, `/chat/blocks/${conversationId}/${requestRecord.blockId}.json`, {
      method: "GET", token: actor.adminToken
    });
    if (!block || (Number.isFinite(block.deleteAt) && block.deleteAt <= Date.now())) {
      throw new ChatAuthError("The original message block has expired", 410);
    }
    const existingMessage = await firebaseDbRequest(env,
      `/chat/messages/${conversationId}/${requestRecord.blockId}/${messageId}.json`,
      { method: "GET", token: actor.adminToken }
    );
    if (existingMessage) {
      if (block.status === "pending") {
        await activateBlock(actor, conversationId, block, existingMessage, env);
      }
      return { ...existingMessage, messageId, blockId: requestRecord.blockId, idempotent: true };
    }
  } else {
    block = await getOrCreateActiveBlock(actor, conversationId, env);
    const candidate = {
      senderUid: actor.uid,
      contentHash,
      messageId,
      blockId: block.blockId,
      createdAt: Date.now(),
      status: "pending"
    };
    const reservation = await firebaseDbRequest(env, requestPath, {
      method: "PUT",
      token: actor.adminToken,
      body: candidate,
      ifMatch: requestSnapshot.etag || "null_etag",
      allowPreconditionFailure: true
    });
    if (reservation.preconditionFailed) {
      requestSnapshot = await firebaseDbRequest(env, requestPath, {
        method: "GET", token: actor.adminToken, wantEtag: true
      });
      requestRecord = requestSnapshot.data;
      if (!requestRecord || requestRecord.senderUid !== actor.uid || requestRecord.contentHash !== contentHash) {
        throw new ChatAuthError("clientMessageId conflicts with another request", 409);
      }
      block = await firebaseDbRequest(env, `/chat/blocks/${conversationId}/${requestRecord.blockId}.json`, {
        method: "GET", token: actor.adminToken
      });
    } else {
      requestRecord = candidate;
    }
  }

  if (!block || (Number.isFinite(block.deleteAt) && block.deleteAt <= Date.now())) {
    throw new ChatAuthError("Conversation block has expired", 410);
  }
  const now = Number(requestRecord.createdAt) || Date.now();
  const message = {
    senderUid: actor.uid,
    senderRole: actor.role,
    senderName: actor.name,
    clientMessageId,
    type: "text",
    text,
    createdAt: now
  };
  const messageTimelineKey = timelineKeyFor(now, messageId);
  const newConversationTimelineKey = timelineKeyFor(now, conversationId);
  const previousConversationTimelineKey = conversation.timelineKey || timelineKeyFor(Number(conversation.lastMessageAt) || Number(conversation.createdAt) || now, conversationId);
  const storedRequest = { ...requestRecord, status: "stored" };

  // The message and its idempotency receipt are persisted in the same
  // multi-location PATCH. A retry can safely finish block activation if the
  // Worker loses its connection after this write succeeds.
  const updates = {
    [`messages/${conversationId}/${block.blockId}/${messageId}`]: message,
    [`messageRequests/${conversationId}/${requestKey}`]: storedRequest,
    [`messageRequestIndex/${conversationId}/${block.blockId}/${requestKey}`]: true,
    [`messageTimeline/${conversationId}/${messageTimelineKey}`]: { messageId, blockId: block.blockId, message },
    [`messageTimelineByBlock/${conversationId}/${block.blockId}/${messageTimelineKey}`]: true,
    [`conversations/${conversationId}/lastMessageAt`]: now,
    [`conversations/${conversationId}/lastMessagePreview`]: text.slice(0, 120),
    [`conversations/${conversationId}/lastSenderUid`]: actor.uid,
    [`conversations/${conversationId}/timelineKey`]: newConversationTimelineKey,
    [`adminTimeline/${newConversationTimelineKey}`]: true
  };
  if (previousConversationTimelineKey !== newConversationTimelineKey) updates[`adminTimeline/${previousConversationTimelineKey}`] = null;
  for (const uid of Object.keys(conversation.participantUids || {})) {
    updates[`userConversationTimeline/${uid}/${newConversationTimelineKey}`] = true;
    if (previousConversationTimelineKey !== newConversationTimelineKey) updates[`userConversationTimeline/${uid}/${previousConversationTimelineKey}`] = null;
  }
  if (conversation.kind === "operator-support") {
    updates[`operatorTimeline/${newConversationTimelineKey}`] = true;
    if (previousConversationTimelineKey !== newConversationTimelineKey) updates[`operatorTimeline/${previousConversationTimelineKey}`] = null;
  }
  await firebaseDbRequest(env, "/chat.json", { method: "PATCH", token: actor.adminToken, body: updates });

  await activateBlock(actor, conversationId, block, message, env);
  return { ...message, messageId, blockId: block.blockId, idempotent: false };
}

async function getConversation(actor, conversationId, env) {
  const conversation = await firebaseDbRequest(env, `/chat/conversations/${conversationId}.json`, { method: "GET", token: actor.adminToken });
  if (!conversation || !canAccessConversation(actor, conversation)) throw new ChatAuthError("Conversation not found or access denied", 404);
  return conversation;
}

function canAccessConversation(actor, conversation) {
  if (actor.role === "admin") return true;
  if (actor.role === "operator" && conversation?.kind === "operator-support") return true;
  return conversation?.participantUids?.[actor.uid] === true;
}

function isChatDriverProfile(uid, profile, env) {
  if (!profile || profile.active === false || profile.status === "disabled") return false;
  if (profile.role === "driver") return Boolean(profile.carId);
  return uid === env.ADMIN_UID &&
    profile.role === "admin" &&
    String(profile.carId || "144") === "144";
}

async function getOrCreateActiveBlock(actor, conversationId, env) {
  const path = `/chat/conversations/${conversationId}/currentBlock.json`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await firebaseDbRequest(env, path, {
      method: "GET", token: actor.adminToken, wantEtag: true
    });
    const now = Date.now();

    // A pending block has no retention clock. Concurrent first messages reuse
    // this reservation; the clock is activated only after a message is stored.
    if (current.data?.blockId && current.data.status === "pending") {
      await ensureBlockMetadata(env, actor.adminToken, conversationId, current.data);
      return current.data;
    }
    if (current.data?.blockId && current.data.status === "open" &&
        Number(current.data.closesAt) > now && Number(current.data.deleteAt) > now) {
      await ensureBlockMetadata(env, actor.adminToken, conversationId, current.data);
      return current.data;
    }

    if (current.data?.blockId && current.data.status === "open") {
      const closedBlock = {
        ...current.data,
        status: "closed",
        closedAt: Number(current.data.closesAt) || now
      };
      await ensureBlockMetadata(env, actor.adminToken, conversationId, closedBlock);
    }

    const block = {
      blockId: `b_${String(now).padStart(13, "0")}_${crypto.randomUUID().replace(/-/g, "")}`,
      createdAt: now,
      createdBy: actor.uid,
      status: "pending"
    };
    const write = await firebaseDbRequest(env, path, {
      method: "PUT", token: actor.adminToken, body: block,
      ifMatch: current.etag || "null_etag", allowPreconditionFailure: true
    });
    if (write.preconditionFailed) continue;
    await ensureBlockMetadata(env, actor.adminToken, conversationId, block);
    return block;
  }
  throw new Error("Could not allocate a conversation block after concurrent updates");
}

async function activateBlock(actor, conversationId, pendingBlock, message, env) {
  const path = `/chat/conversations/${conversationId}/currentBlock.json`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await firebaseDbRequest(env, path, {
      method: "GET", token: actor.adminToken, wantEtag: true
    });
    if (!current.data || current.data.blockId !== pendingBlock.blockId) {
      const persisted = await firebaseDbRequest(env,
        `/chat/blocks/${conversationId}/${pendingBlock.blockId}.json`,
        { method: "GET", token: actor.adminToken }
      );
      if (persisted && ["open", "closed"].includes(persisted.status)) return persisted;
      throw new Error("Conversation block reservation changed before activation");
    }
    if (current.data.status === "closed") return current.data;

    const messageTime = Number(message.createdAt) || Date.now();
    if (current.data.status === "open") {
      const currentStart = Number(current.data.startedAt) || messageTime;
      if (messageTime >= currentStart) {
        await ensureBlockMetadata(env, actor.adminToken, conversationId, current.data);
        return current.data;
      }
      // Two first messages can be persisted concurrently. Keep the earliest
      // accepted server timestamp as the start of the 24-hour block.
      const adjusted = {
        ...current.data,
        startedAt: messageTime,
        closesAt: messageTime + CHAT_BLOCK_MS,
        deleteAt: messageTime + CHAT_BLOCK_MS + CHAT_RETENTION_AFTER_CLOSE_MS
      };
      const write = await firebaseDbRequest(env, path, {
        method: "PUT", token: actor.adminToken, body: adjusted,
        ifMatch: current.etag || "null_etag", allowPreconditionFailure: true
      });
      if (write.preconditionFailed) continue;
      await ensureBlockMetadata(env, actor.adminToken, conversationId, adjusted);
      return adjusted;
    }
    if (current.data.status !== "pending") throw new Error("Conversation block is not activatable");

    const startedAt = messageTime;
    const activeBlock = {
      ...current.data,
      status: "open",
      startedAt,
      closesAt: startedAt + CHAT_BLOCK_MS,
      deleteAt: startedAt + CHAT_BLOCK_MS + CHAT_RETENTION_AFTER_CLOSE_MS
    };
    const write = await firebaseDbRequest(env, path, {
      method: "PUT", token: actor.adminToken, body: activeBlock,
      ifMatch: current.etag || "null_etag", allowPreconditionFailure: true
    });
    if (write.preconditionFailed) continue;
    await ensureBlockMetadata(env, actor.adminToken, conversationId, activeBlock);
    return activeBlock;
  }
  throw new Error("Could not activate conversation block after concurrent updates");
}

async function ensureBlockMetadata(env, token, conversationId, block) {
  await firebaseDbRequest(env, `/chat/blocks/${conversationId}/${block.blockId}.json`, { method: "PUT", token, body: block });
  if (!Number.isFinite(block.deleteAt) || block.deleteAt <= 0) return;
  const expiryKey = `${String(block.deleteAt).padStart(13, "0")}_${conversationId}_${block.blockId}`;
  await firebaseDbRequest(env, `/chat/expiryIndex/${expiryKey}.json`, {
    method: "PUT", token, body: { conversationId, blockId: block.blockId, deleteAt: block.deleteAt }
  });
}

async function firebaseDbRequest(env, path, options = {}) {
  const databaseUrl = String(env.FIREBASE_DATABASE_URL || `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`).replace(/\/$/, "");
  const url = new URL(`${databaseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  const token = options.token || await getFirebaseAdminToken(env);
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.wantEtag) headers["X-Firebase-ETag"] = "true";
  if (options.ifMatch) headers["if-match"] = options.ifMatch;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  if (response.status === 412 && options.allowPreconditionFailure) return { preconditionFailed: true };
  if (!response.ok) throw new Error(`Firebase RTDB request failed (${response.status})`);
  const data = options.method === "DELETE" ? null : await response.json().catch(() => null);
  if (options.wantEtag) return { data, etag: response.headers.get("ETag") };
  return data;
}

async function enforceRateLimit(actor, action, limit, windowMs, env) {
  const key = (await stableId(actor.uid + ':' + action)).slice(2);
  const path = '/chat/rateLimits/' + key + '.json';
  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const snapshot = await firebaseDbRequest(env, path, { method: 'GET', token: actor.adminToken, wantEtag: true });
    const previous = snapshot.data;
    const count = previous && previous.windowStart === windowStart ? Number(previous.count) || 0 : 0;
    if (count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      throw new ChatAuthError('Too many chat requests; retry later', 429, retryAfter);
    }
    const next = { windowStart, count: count + 1, updatedAt: now };
    const result = await firebaseDbRequest(env, path, { method: 'PUT', token: actor.adminToken, body: next, ifMatch: snapshot.etag || 'null_etag', allowPreconditionFailure: true });
    if (!result.preconditionFailed) return;
  }
  throw new ChatAuthError('Chat is temporarily busy; retry later', 503, 2);
}
async function getFirebaseAdminToken(env) {
  if (serviceTokenCache.token && Date.now() < serviceTokenCache.expiresAt - 60_000) return serviceTokenCache.token;
  const email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) throw new Error("Firebase service account secrets are missing");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    sub: email,
    aud: FIREBASE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email"
  };
  const assertion = await signServiceJwt(env, claims);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  if (!response.ok) throw new Error(`Firebase service account token request failed (${response.status})`);
  const result = await response.json();
  if (!result.access_token) throw new Error("Firebase service account did not return an access token");
  serviceTokenCache = { token: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
  return serviceTokenCache.token;
}

async function signServiceJwt(env, claims) {
  if (!serviceSigningKeyPromise) {
    const pem = String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    serviceSigningKeyPromise = crypto.subtle.importKey("pkcs8", binary, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  }
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await serviceSigningKeyPromise, new TextEncoder().encode(input));
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyFirebaseIdToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ChatAuthError("Invalid Firebase ID token", 401);
  let header, claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    throw new ChatAuthError("Invalid Firebase ID token", 401);
  }
  if (header?.alg !== "RS256" || typeof header.kid !== "string") throw new ChatAuthError("Invalid Firebase ID token", 401);
  const now = Math.floor(Date.now() / 1000);
  const uid = claims?.sub;
  if (claims?.aud !== projectId || claims?.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof uid !== "string" || !isSafeUid(uid) || !Number.isInteger(claims.exp) || claims.exp <= now - 60 ||
      !Number.isInteger(claims.iat) || claims.iat > now + 60 || !Number.isInteger(claims.auth_time) || claims.auth_time > now + 60) {
    throw new ChatAuthError("Expired or invalid Firebase ID token", 401);
  }
  const keys = await getFirebasePublicKeys();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new ChatAuthError("Firebase signing key not found", 401);
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new ChatAuthError("Invalid Firebase ID token signature", 401);
  return { uid };
}

async function getFirebasePublicKeys() {
  if (firebasePublicKeys && Date.now() < firebasePublicKeysExpireAt) return firebasePublicKeys;
  const response = await fetch(FIREBASE_JWKS_URL, { headers: { Accept: "application/json" }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error("Could not load Firebase signing keys");
  const body = await response.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error("Firebase signing keys response is invalid");
  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);
  firebasePublicKeys = body.keys;
  firebasePublicKeysExpireAt = Date.now() + Math.max(60, Math.min(maxAge, 86400)) * 1000;
  return firebasePublicKeys;
}

async function stableId(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `c_${[...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 16_384) throw new ChatAuthError("Request body is too large", 413);
  const raw = await request.text();
  if (raw.length > 16_384) throw new ChatAuthError("Request body is too large", 413);
  try { return JSON.parse(raw); } catch { throw new ChatAuthError("Invalid JSON body", 400); }
}

function isChatConfigured(env) {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_SERVICE_ACCOUNT_EMAIL && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY && env.APP_ORIGIN && env.ADMIN_UID);
}
function isSafeUid(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function isSafeId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value); }
function isSafeUidOrId(value) { return isSafeUid(value) || isSafeId(value); }
function isSafeTimelineCursor(value) { return typeof value === "string" && /^\d{13}_[A-Za-z0-9_-]{1,180}$/.test(value); }
function timelineKeyFor(timestamp, id) { return `${String(Math.max(0, Math.floor(timestamp))).padStart(13, "0")}_${id}`; }
function decodeJson(value) { return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))); }
function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function chatCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.APP_ORIGIN || "").trim();
  const headers = {
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "600",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin && origin === allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function chatJson(data, status, request, env) {
  const headers = {
    ...chatCorsHeaders(request, env),
    "Content-Type": "application/json; charset=utf-8"
  };
  return new Response(JSON.stringify(data), { status, headers });
}

class ChatAuthError extends Error {
  constructor(message, status = 401, retryAfter = null) { super(message); this.status = status; this.retryAfter = retryAfter; }
}