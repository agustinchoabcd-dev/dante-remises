const DEFAULT_TIMEOUT_MS = 12000;

export async function registerDriverPushDevice({
  apiBaseUrl,
  idToken,
  token,
  appVersion = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  return postJson(apiBaseUrl, "/v1/trips/register-device", {
    token,
    appVersion
  }, idToken, fetchImpl, timeoutMs);
}

export async function unregisterDriverPushDevice({
  apiBaseUrl,
  idToken,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  return postJson(apiBaseUrl, "/v1/trips/unregister-device", { token }, idToken, fetchImpl, timeoutMs);
}

export async function notifyDriverForTrip({
  apiBaseUrl,
  idToken,
  tripId,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (typeof tripId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) {
    throw new TypeError("tripId inválido");
  }
  return postJson(apiBaseUrl, "/v1/trips/notify-driver", { tripId }, idToken, fetchImpl, timeoutMs);
}

async function postJson(baseUrl, path, body, idToken, fetchImpl, timeoutMs) {
  if (typeof baseUrl !== "string" || !/^https:\/\//.test(baseUrl)) {
    throw new TypeError("apiBaseUrl debe ser HTTPS");
  }
  if (typeof idToken !== "string" || idToken.length < 20) {
    throw new TypeError("Se requiere un Firebase ID token");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl no está disponible");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result?.error || `El servidor rechazó la operación (HTTP ${response.status})`);
      error.status = response.status;
      error.code = result?.code || "TRIP_PUSH_REQUEST_FAILED";
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
