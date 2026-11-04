const MAX_MESSAGE_LENGTH = 2000;

export class ChatApiError extends Error {
  constructor(message, { status = 0, retryAfter = null, payload = null } = {}) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.payload = payload;
  }
}

export class ChatApiClient {
  constructor({ baseUrl, getIdToken, fetchImpl = fetch }) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
      throw new TypeError("Chat API baseUrl is required");
    }
    if (typeof getIdToken !== "function") {
      throw new TypeError("Chat API getIdToken callback is required");
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("Chat API fetch implementation is required");
    }
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new TypeError("Chat API must use HTTPS outside localhost");
    }
    this.baseUrl = parsed.href.replace(/\/$/, "");
    this.getIdToken = getIdToken;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = "GET", body } = {}) {
    const token = await this.getIdToken();
    if (typeof token !== "string" || !token.trim()) {
      throw new ChatApiError("La sesión expiró. Volvé a iniciar sesión.", { status: 401 });
    }
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const options = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, options);
    } catch {
      throw new ChatApiError("No se pudo conectar con el servicio de chat. Revisá tu conexión.");
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const retryAfter = response.headers?.get?.("Retry-After") || null;
      const message = typeof payload?.error === "string"
        ? payload.error
        : `El servicio de chat respondió HTTP ${response.status}.`;
      throw new ChatApiError(message, { status: response.status, retryAfter, payload });
    }
    if (!payload || typeof payload !== "object") {
      throw new ChatApiError("El servicio de chat devolvió una respuesta inválida.", { status: response.status });
    }
    return payload;
  }

  openConversation({ target, targetUid, tripId } = {}) {
    const body = { target };
    if (targetUid) body.targetUid = targetUid;
    if (tripId) body.tripId = tripId;
    return this.request("/v1/chat/conversations", { method: "POST", body });
  }

  listConversations(cursor = null) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request(`/v1/chat/conversations${query}`);
  }

  listMessages(conversationId, cursor = null) {
    if (typeof conversationId !== "string" || !conversationId) {
      throw new TypeError("conversationId is required");
    }
    const params = new URLSearchParams({ conversationId });
    if (cursor) params.set("cursor", cursor);
    return this.request(`/v1/chat/messages?${params.toString()}`);
  }

  sendMessage({ conversationId, text, clientMessageId } = {}) {
    const cleanText = typeof text === "string" ? text.trim() : "";
    if (!cleanText || cleanText.length > MAX_MESSAGE_LENGTH) {
      throw new TypeError(`Message must contain 1-${MAX_MESSAGE_LENGTH} characters`);
    }
    if (typeof conversationId !== "string" || !conversationId) {
      throw new TypeError("conversationId is required");
    }
    if (typeof clientMessageId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(clientMessageId)) {
      throw new TypeError("A stable clientMessageId is required");
    }
    return this.request("/v1/chat/messages", {
      method: "POST",
      body: { conversationId, text: cleanText, clientMessageId }
    });
  }
}

export function createClientMessageId(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || typeof cryptoImpl.randomUUID !== "function") {
    throw new Error("A secure random UUID generator is required");
  }
  return cryptoImpl.randomUUID().replace(/-/g, "");
}
