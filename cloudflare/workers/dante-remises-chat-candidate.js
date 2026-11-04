import { handleChatRequest, scheduled as chatScheduled } from "../../chat-worker/chat-module-candidate-dynamic.js";

/*
 * Dante Remises — combined B2 test Worker draft.
 *
 * /test/* remains restricted by TEST_ACCESS_TOKEN to worker-test/.
 * /v1/profile-photo/* separately verifies Firebase ID tokens and uses a B2
 * key restricted to passengers/. Keep both paths on the private test bucket.
 */

const TEST_PREFIX = "worker-test/";
const PASSENGER_PREFIX = "passengers/";
const URL_TTL_SECONDS = 300;
const MAX_PRESIGNED_TTL_SECONDS = 300;
const MAX_PROFILE_PHOTO_BYTES = 1_000_000;
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedFirebaseKeys = null;
let firebaseKeysExpireAt = 0;

export default {
  async fetch(request, env) {
    const chatResponse = await handleChatRequest(request, env);
    if (chatResponse) return chatResponse;

    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method === "GET" && url.pathname === "/test") return htmlResponse(testPage(), request, env);
    if (request.method === "GET" && url.pathname === "/test/profile") return htmlResponse(profileTestPage(), request, env);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        testConfigured: isConfigured(env),
        passengerPhotoConfigured: isPassengerConfigured(env),
      }, 200, request, env);
    }

    if (url.pathname.startsWith("/v1/profile-photo")) {
      if (!isPassengerConfigured(env)) return json({ error: "Profile photo configuration is incomplete" }, 503, request, env);
      try {
        if (request.method === "PUT" && url.pathname === "/v1/profile-photo/upload") {
          const ticket = await verifyUploadTicket(url.searchParams.get("ticket") || "", env);
          return await receiveProfilePhotoUpload(request, env, ticket.key);
        }

        const user = await requireFirebasePassenger(request, env);
        if (request.method === "POST" && url.pathname === "/v1/profile-photo/upload-url") {
          const body = await request.json();
          if (body?.contentType !== "image/jpeg") return json({ error: "Only JPEG profile photos are accepted" }, 415, request, env);
          const key = newProfilePhotoKey(user.uid);
          const ticket = await createUploadTicket(env, user.uid, key);
          const uploadUrl = new URL("/v1/profile-photo/upload", request.url);
          uploadUrl.searchParams.set("ticket", ticket);
          return json({ key, uploadUrl: uploadUrl.toString(), expiresIn: URL_TTL_SECONDS, contentType: "image/jpeg" }, 200, request, env);
        }

        if (request.method === "GET" && url.pathname === "/v1/profile-photo/read-url") {
          const key = url.searchParams.get("key") || "";
          if (!isOwnedProfilePhotoKey(key, user.uid)) return json({ error: "Profile photo not found" }, 404, request, env);
          const readUrl = await presign(env, "GET", key, URL_TTL_SECONDS);
          return json({ readUrl, expiresIn: URL_TTL_SECONDS }, 200, request, env);
        }

        if (request.method === "POST" && url.pathname === "/v1/profile-photo/delete") {
          const body = await request.json();
          const key = body?.key || "";
          if (!isOwnedProfilePhotoKey(key, user.uid)) return json({ error: "Profile photo not found" }, 404, request, env);
          const result = await signedDelete(env, key);
          if (!result.ok) {
            const detail = await readB2Error(result);
            console.error("B2 profile delete rejected", result.status, detail.code || "unknown");
            return json({ error: "Storage rejected the profile photo deletion", status: result.status, code: detail.code }, 502, request, env);
          }
          return json({ deleted: true }, 200, request, env);
        }
        return json({ error: "Not found" }, 404, request, env);
      } catch (error) {
        if (error instanceof AuthError) return json({ error: error.message }, error.status, request, env);
        console.error("Profile storage request failed", error instanceof Error ? error.name : "UnknownError");
        return json({ error: "Request failed" }, 502, request, env);
      }
    }

    if (!url.pathname.startsWith("/test/")) return json({ error: "Not found" }, 404, request, env);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401, request, env);
    if (!isConfigured(env)) return json({ error: "Worker configuration is incomplete" }, 503, request, env);

    try {
      if (request.method === "POST" && url.pathname === "/test/upload-url") {
        const body = await request.json();
        const contentType = body?.contentType;
        const extension = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : null;
        if (!extension) return json({ error: "Only PNG or JPEG test images are accepted" }, 415, request, env);
        const key = `${TEST_PREFIX}${crypto.randomUUID()}.${extension}`;
        const uploadUrl = await presign(env, "PUT", key, URL_TTL_SECONDS);
        return json({ key, uploadUrl, expiresIn: URL_TTL_SECONDS, contentType }, 200, request, env);
      }

      if (request.method === "POST" && url.pathname === "/test/upload") {
        const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
        const extension = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : null;
        if (!extension) return json({ error: "Only PNG or JPEG test images are accepted" }, 415, request, env);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > 100_000) return json({ error: "Test image is too large" }, 413, request, env);
        const key = `${TEST_PREFIX}${crypto.randomUUID()}.${extension}`;
        const uploadUrl = await presign(env, "PUT", key, URL_TTL_SECONDS);
        const result = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
        if (!result.ok) {
          const detail = await readB2Error(result);
          console.error("B2 test upload rejected", result.status, detail.code || "unknown");
          return json({ error: "Backblaze rechazó la subida", status: result.status, b2Code: detail.code, b2Message: detail.message }, 502, request, env);
        }
        return json({ key }, 200, request, env);
      }

      if (request.method === "GET" && url.pathname === "/test/read-url") {
        const key = url.searchParams.get("key") || "";
        if (!isTestKey(key)) return json({ error: "Invalid test object key" }, 400, request, env);
        const readUrl = await presign(env, "GET", key, URL_TTL_SECONDS);
        return json({ readUrl, expiresIn: URL_TTL_SECONDS }, 200, request, env);
      }

      if (request.method === "GET" && url.pathname === "/test/read") {
        const key = url.searchParams.get("key") || "";
        if (!isTestKey(key)) return json({ error: "Invalid test object key" }, 400, request, env);
        const readUrl = await presign(env, "GET", key, URL_TTL_SECONDS);
        const result = await fetch(readUrl);
        if (!result.ok) return json({ error: "Backblaze rechazó la lectura", status: result.status }, 502, request, env);
        return new Response(result.body, { status: 200, headers: { "Content-Type": result.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }

      if (request.method === "POST" && url.pathname === "/test/delete") {
        const body = await request.json();
        const key = body?.key || "";
        if (!isTestKey(key)) return json({ error: "Invalid test object key" }, 400, request, env);
        const result = await signedDelete(env, key);
        if (!result.ok) {
          const detail = await readB2Error(result);
          console.error("B2 test delete rejected", result.status, detail.code || "unknown");
          return json({ error: "Backblaze rechazó el borrado", status: result.status, b2Code: detail.code, b2Message: detail.message }, 502, request, env);
        }
        return json({ deleted: true }, 200, request, env);
      }

      return json({ error: "Not found" }, 404, request, env);
    } catch (error) {
      // Do not log headers, credentials, signed URLs, or raw upstream responses.
      console.error("B2 test request failed", error instanceof Error ? error.name : "UnknownError");
      return json({ error: "Request failed; check Worker configuration and B2 settings" }, 502, request, env);
    }
  },
  async scheduled(event, env, ctx) {
    return chatScheduled(event, env, ctx);
  },
};

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function b2KeyId(env) { return env.B2_PASSENGERS_KEY_ID || env.B2_KEY_ID; }
function b2ApplicationKey(env) { return env.B2_PASSENGERS_APPLICATION_KEY || env.B2_APPLICATION_KEY; }

async function requireFirebaseUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new AuthError("Firebase sign-in required");
  const token = authorization.slice(7).trim();
  if (!token || token.length > 8192) throw new AuthError("Invalid Firebase ID token");
  return verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
}

async function requireFirebasePassenger(request, env) {
  const user = await requireFirebaseUser(request, env);
  const databaseUrl = String(env.FIREBASE_DATABASE_URL || `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`).replace(/\/$/, "");
  const roleUrl = new URL(`${databaseUrl}/profiles/${encodeURIComponent(user.uid)}/role.json`);
  roleUrl.searchParams.set("auth", user.idToken);
  const response = await fetch(roleUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AuthError("Firebase no permitió leer el perfil del usuario", 403);
    throw new Error(`Firebase role lookup failed (HTTP ${response.status})`);
  }
  const role = await response.json();
  if (role !== "passenger") throw new AuthError("This storage route is only for passenger accounts", 403);
  return user;
}

async function createUploadTicket(env, uid, key) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    purpose: "profile-photo-upload",
    uid,
    key,
    exp: Math.floor(Date.now() / 1000) + URL_TTL_SECONDS,
  })));
  const signature = await hmac(new TextEncoder().encode(b2ApplicationKey(env)), payload);
  return `${payload}.${base64UrlEncode(signature)}`;
}

async function verifyUploadTicket(ticket, env) {
  const parts = ticket.split(".");
  if (
    parts.length !== 2 || ticket.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) {
    throw new AuthError("Invalid or expired upload link", 401);
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
  } catch {
    throw new AuthError("Invalid or expired upload link", 401);
  }

  const expected = await hmac(new TextEncoder().encode(b2ApplicationKey(env)), parts[0]);
  if (!constantTimeEqualBytes(expected, base64UrlToBytes(parts[1]))) {
    throw new AuthError("Invalid or expired upload link", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    payload?.purpose !== "profile-photo-upload" ||
    typeof payload.uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.uid) ||
    !Number.isInteger(payload.exp) || payload.exp <= now || payload.exp > now + URL_TTL_SECONDS + 5 ||
    !isOwnedProfilePhotoKey(payload.key, payload.uid)
  ) {
    throw new AuthError("Invalid or expired upload link", 401);
  }

  return { uid: payload.uid, key: payload.key };
}

async function receiveProfilePhotoUpload(request, env, key) {
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "image/jpeg") {
    return json({ error: "Only JPEG profile photos are accepted" }, 415, request, env);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_PROFILE_PHOTO_BYTES) {
    return json({ error: "Profile photo is too large" }, 413, request, env);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROFILE_PHOTO_BYTES) {
    return json({ error: "Profile photo must be between 1 byte and 1 MB" }, 413, request, env);
  }
  if (!isJpeg(bytes)) {
    return json({ error: "The uploaded file is not a JPEG image" }, 415, request, env);
  }

  const uploadUrl = await presign(env, "PUT", key, URL_TTL_SECONDS);
  const result = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: bytes,
  });
  if (!result.ok) {
    const detail = await readB2Error(result);
    console.error("B2 profile upload rejected", result.status, detail.code || "unknown");
    return json({ error: "Storage rejected the profile photo", status: result.status, code: detail.code }, 502, request, env);
  }

  return json({ key, uploadedAt: Date.now() }, 201, request, env);
}

async function verifyFirebaseIdToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Invalid Firebase ID token");

  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    throw new AuthError("Invalid Firebase ID token");
  }

  if (header?.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AuthError("Invalid Firebase ID token");
  }

  const now = Math.floor(Date.now() / 1000);
  const tolerance = 60;
  const uid = claims?.sub;
  if (
    claims?.aud !== projectId ||
    claims?.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
    !Number.isInteger(claims.exp) || claims.exp <= now - tolerance ||
    !Number.isInteger(claims.iat) || claims.iat > now + tolerance ||
    !Number.isInteger(claims.auth_time) || claims.auth_time > now + tolerance
  ) {
    throw new AuthError("Expired or invalid Firebase ID token");
  }

  const keys = await getFirebasePublicKeys();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new AuthError("Firebase signing key not found");

  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new AuthError("Invalid Firebase ID token signature");

  return { uid, idToken: token };
}

async function getFirebasePublicKeys() {
  if (cachedFirebaseKeys && Date.now() < firebaseKeysExpireAt) return cachedFirebaseKeys;

  const response = await fetch(FIREBASE_JWKS_URL, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error("Could not load Firebase signing keys");

  const body = await response.json();
  if (!Array.isArray(body?.keys) || body.keys.length === 0) {
    throw new Error("Firebase signing keys response is invalid");
  }

  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedFirebaseKeys = body.keys;
  firebaseKeysExpireAt = Date.now() + Math.max(60, Math.min(maxAgeSeconds, 86400)) * 1000;
  return cachedFirebaseKeys;
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqualBytes(left, right) {
  if (!(right instanceof Uint8Array)) return false;
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

function newProfilePhotoKey(uid) {
  return `passengers/${uid}/profile/${crypto.randomUUID()}.jpg`;
}

function isOwnedProfilePhotoKey(key, uid) {
  if (typeof key !== "string" || key.length > 220) return false;
  const prefix = `passengers/${uid}/profile/`;
  if (!key.startsWith(prefix)) return false;
  const filename = key.slice(prefix.length);
  return /^[0-9a-f-]{36}\.jpg$/i.test(filename);
}

function isJpeg(buffer) {
  if (buffer.byteLength < 3) return false;
  const bytes = new Uint8Array(buffer, 0, 3);
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isConfigured(env) {
  return Boolean(env.B2_KEY_ID && env.B2_APPLICATION_KEY && env.B2_BUCKET_NAME && env.B2_S3_ENDPOINT && env.TEST_ACCESS_TOKEN);
}

function isPassengerConfigured(env) {
  return Boolean(env.FIREBASE_PROJECT_ID && env.APP_ORIGIN && env.B2_BUCKET_NAME && env.B2_S3_ENDPOINT && env.B2_PASSENGERS_KEY_ID && env.B2_PASSENGERS_APPLICATION_KEY);
}

function authorized(request, env) {
  const expected = env.TEST_ACCESS_TOKEN;
  const authorization = request.headers.get("Authorization") || "";
  if (!expected || !authorization.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), expected);
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i % (left.length || 1)] || 0) ^ (right[i % (right.length || 1)] || 0);
  return diff === 0;
}

function isTestKey(key) {
  return typeof key === "string" && key.startsWith(TEST_PREFIX) &&
    key.length <= 160 && !key.includes("..") && !key.includes("\\") && !key.includes("?") && !key.includes("#");
}

function endpointHost(env) {
  const raw = String(env.B2_S3_ENDPOINT || "").trim();
  const value = raw.includes("://") ? new URL(raw).host : raw.replace(/\/$/, "");
  if (!/^[a-z0-9.-]+\.backblazeb2\.com$/i.test(value)) throw new Error("Invalid B2 S3 endpoint");
  return value.toLowerCase();
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(bucket, key) {
  return `/${awsEncode(bucket)}/${key.split("/").map(awsEncode).join("/")}`;
}

function canonicalQuery(entries) {
  return entries.map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`).join("&");
}

function amzTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function regionFromHost(host) {
  const match = host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
  if (!match) throw new Error("Use the regional B2 S3 endpoint, for example s3.us-west-004.backblazeb2.com");
  return match[1].toLowerCase();
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
}

async function signingKey(secret, date, region) {
  const dateKey = await hmac(new TextEncoder().encode(`AWS4${secret}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

async function presign(env, method, key, expires) {
  if (expires < 1 || expires > MAX_PRESIGNED_TTL_SECONDS) throw new Error("Invalid URL lifetime");
  const credentials = b2Credentials(env, key);
  const host = endpointHost(env);
  const region = regionFromHost(host);
  const now = new Date();
  const amzDate = amzTimestamp(now);
  const shortDate = amzDate.slice(0, 8);
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const path = canonicalPath(env.B2_BUCKET_NAME, key);
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.keyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonical = `${method}\n${path}\n${canonicalQuery(query)}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonical)}`;
  const signature = [...await hmac(await signingKey(credentials.applicationKey, shortDate, region), stringToSign)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `https://${host}${path}?${canonicalQuery([...query, ["X-Amz-Signature", signature]])}`;
}

async function signedDelete(env, key) {
  const credentials = b2Credentials(env, key);
  const host = endpointHost(env);
  const region = regionFromHost(host);
  const path = canonicalPath(env.B2_BUCKET_NAME, key);
  const amzDate = amzTimestamp();
  const shortDate = amzDate.slice(0, 8);
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const payloadHash = await sha256Hex(new Uint8Array());
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = `DELETE\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonical)}`;
  const signature = [...await hmac(await signingKey(credentials.applicationKey, shortDate, region), stringToSign)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`https://${host}${path}`, {
    method: "DELETE",
    headers: { Authorization: authorization, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate },
  });
}

function b2Credentials(env, key) {
  if (typeof key === "string" && key.startsWith(PASSENGER_PREFIX)) {
    if (!env.B2_PASSENGERS_KEY_ID || !env.B2_PASSENGERS_APPLICATION_KEY) throw new Error("Passenger B2 key is not configured");
    return { keyId: env.B2_PASSENGERS_KEY_ID, applicationKey: env.B2_PASSENGERS_APPLICATION_KEY };
  }
  if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY) throw new Error("Test B2 key is not configured");
  return { keyId: env.B2_KEY_ID, applicationKey: env.B2_APPLICATION_KEY };
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.TEST_ALLOWED_ORIGIN || "").trim();
  const configuredOrigins = [env.APP_ORIGIN, allowed].filter(Boolean).map(value => String(value).trim());
  const headers = { "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type", "Vary": "Origin" };
  if (origin && configuredOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request, env) } });
}

async function readB2Error(response) {
  const text = await response.text();
  const getTag = (tag) => {
    const match = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
    return match ? match[1].slice(0, 240) : "";
  };
  return { code: getTag("Code"), message: getTag("Message") };
}

function htmlResponse(content, request, env) {
  return new Response(content, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com; style-src 'unsafe-inline'; img-src 'self' blob: data: https://*.backblazeb2.com; connect-src 'self' https:", "X-Content-Type-Options": "nosniff", ...corsHeaders(request, env) } });
}

function profileTestPage() {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba de foto de perfil</title>
<style>body{font:16px system-ui;max-width:650px;margin:2rem auto;padding:0 1rem;color:#202938}input,button{font:inherit;padding:.65rem;margin:.3rem 0}button{cursor:pointer}.card{padding:1rem;border:1px solid #ccd3dd;border-radius:10px}#status{white-space:pre-wrap}.hint{color:#536273;font-size:.9rem}img{width:48px;height:48px;image-rendering:pixelated}</style>
<h1>Prueba de foto de perfil</h1><p class="hint">Iniciá sesión con una cuenta de pasajero. La prueba genera un JPEG ficticio, lo sube, lo lee y lo borra. No elijas ni subas fotos personales.</p>
<section class="card"><label for="identity">Correo o DNI de tu cuenta de pasajero</label><br><input id="identity" autocomplete="off" style="width:min(100%,480px)"><br><label for="password">Contraseña de Dante</label><br><input id="password" type="password" autocomplete="off" style="width:min(100%,480px)"><br><button id="run">Probar foto ficticia</button><div id="status" role="status"></div><img id="preview" alt="JPEG ficticio leído desde B2" hidden></section>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
const app=initializeApp({apiKey:'AIzaSyAkODSNiFyWVaPTG7t0qx-Dru4IBqOb9nE',authDomain:'dante-remiseria-src.firebaseapp.com',databaseURL:'https://dante-remiseria-src-default-rtdb.firebaseio.com',projectId:'dante-remiseria-src',storageBucket:'dante-remiseria-src.firebasestorage.app',messagingSenderId:'453868406002',appId:'1:453868406002:web:e517e0e5dd67ca0f0a7c6b',measurementId:'G-XJLEQ1S719'});
const auth=getAuth(app),identity=document.querySelector('#identity'),password=document.querySelector('#password'),status=document.querySelector('#status'),button=document.querySelector('#run'),preview=document.querySelector('#preview');
const api=async(path,token,options={})=>{const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||('HTTP '+response.status));return data};
const fakeJpeg=async()=>new Promise((resolve,reject)=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#16834a';ctx.fillRect(0,0,2,2);canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo generar la imagen ficticia.')),'image/jpeg',0.8)});
button.addEventListener('click',async()=>{button.disabled=true;preview.hidden=true;let key=null;let signedIn=false;try{const login=identity.value.trim();const email=login.includes('@')?login:'dni'+login.replace(/\\D/g,'')+'@login.dante-remises.invalid';if(!login||!password.value)throw new Error('Completá correo o DNI y contraseña.');status.textContent='1/4 — Iniciando sesión…';const credential=await signInWithEmailAndPassword(auth,email,password.value);signedIn=true;const token=await credential.user.getIdToken();status.textContent='2/4 — Subiendo JPEG ficticio…';const upload=await api('/v1/profile-photo/upload-url',token,{method:'POST',body:JSON.stringify({contentType:'image/jpeg'})});key=upload.key;const image=await fakeJpeg();const saved=await fetch(upload.uploadUrl,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:image});const savedBody=await saved.json().catch(()=>({}));if(!saved.ok)throw new Error(savedBody.error||('Falló la subida (HTTP '+saved.status+')'));status.textContent='3/4 — Leyendo desde B2…';const read=await api('/v1/profile-photo/read-url?key='+encodeURIComponent(key),token);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('La lectura temporal tardó demasiado.')),12000);preview.onload=()=>{clearTimeout(timer);resolve()};preview.onerror=()=>{clearTimeout(timer);reject(new Error('No se pudo leer el JPEG desde B2.'))};preview.src=read.readUrl});preview.hidden=false;status.textContent='4/4 — Borrando el JPEG ficticio…';await api('/v1/profile-photo/delete',token,{method:'POST',body:JSON.stringify({key})});key=null;status.textContent='Prueba completa: Firebase autenticó la cuenta de pasajero; B2 subió, leyó y borró el JPEG ficticio.';}catch(error){status.textContent='Prueba detenida: '+error.message+(key?'\\nClave del archivo ficticio: '+key:'')}finally{password.value='';if(signedIn)await signOut(auth).catch(()=>{});button.disabled=false}});
</script></html>`;
}

function testPage() {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba aislada B2</title>
<style>body{font:16px system-ui;max-width:650px;margin:2rem auto;padding:0 1rem;color:#202938}button,input{font:inherit;padding:.65rem;margin:.3rem 0}button{cursor:pointer}.card{padding:1rem;border:1px solid #ccd3dd;border-radius:10px}#status{white-space:pre-wrap}img{max-width:160px;display:block;margin-top:1rem}.hint{color:#536273;font-size:.9rem}</style>
<h1>Prueba aislada de B2</h1><p class="hint">Esta pantalla genera una imagen de prueba ficticia. El token se conserva solo en memoria en esta pestaña.</p>
<section class="card"><label for="token">Token de prueba configurado como secreto TEST_ACCESS_TOKEN</label><br><input id="token" type="password" autocomplete="off" style="width:min(100%,480px)"><br><button id="run">Subir, leer y borrar imagen ficticia</button><div id="status" role="status"></div><img id="preview" alt="Vista de imagen ficticia"></section>
<script>
const token=document.querySelector('#token'),status=document.querySelector('#status'),button=document.querySelector('#run'),preview=document.querySelector('#preview');
const fakePng=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
async function api(path,options={}){const headers={Authorization:'Bearer '+token.value,...(typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...(options.headers||{})};const response=await fetch(path,{...options,headers});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error((data.error||'Error')+(data.status?' (HTTP '+data.status+')':'')+(data.b2Code?' — '+data.b2Code:'')+(data.b2Message?' — '+data.b2Message:''));return data}
button.addEventListener('click',async()=>{button.disabled=true;preview.removeAttribute('src');let key=null;try{if(!token.value)throw new Error('Ingresá el token de prueba.');status.textContent='1/3 — Subiendo imagen ficticia…';const upload=await api('/test/upload',{method:'POST',headers:{'Content-Type':'image/png'},body:fakePng});key=upload.key;status.textContent='2/3 — Comprobando lectura temporal…';const image=await fetch('/test/read?key='+encodeURIComponent(key),{headers:{Authorization:'Bearer '+token.value}});if(!image.ok){const detail=await image.json().catch(()=>({}));throw new Error(detail.error||('HTTP '+image.status))}const blob=await image.blob();if(blob.size!==fakePng.length)throw new Error('La imagen leída no coincide en tamaño.');preview.src=URL.createObjectURL(blob);status.textContent='3/3 — Borrando el archivo de prueba…';await api('/test/delete',{method:'POST',body:JSON.stringify({key})});key=null;status.textContent='Prueba completa: subida, lectura temporal y borrado correctos. La imagen era ficticia y ya fue eliminada.';}catch(error){status.textContent='Prueba detenida: '+error.message+(key?String.fromCharCode(10)+'Clave del objeto de prueba: '+key:'');}finally{button.disabled=false;}});
</script></html>`;
}
