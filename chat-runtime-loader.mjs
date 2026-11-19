/**
 * Loads chat networking and local history only when chat is opened or an
 * operator presence session requires it. Concurrent callers share one load.
 */
export function createChatRuntimeLoader({
  loadClient = () => import("./chat-client.mjs"),
  loadHistory = () => import("./chat-history-cache.mjs")
} = {}) {
  let modules = null;
  let loading = null;

  return function ensureChatRuntime() {
    if (modules) return Promise.resolve(modules);
    if (loading) return loading;

    loading = Promise.all([loadClient(), loadHistory()])
      .then(([client, history]) => {
        if (typeof client.ChatApiClient !== "function" ||
            typeof client.createClientMessageId !== "function" ||
            typeof client.mergeChatMessagePages !== "function" ||
            !history.chatHistoryCache) {
          throw new TypeError("Chat runtime exports are incomplete");
        }
        modules = Object.freeze({
          ChatApiClient: client.ChatApiClient,
          createClientMessageId: client.createClientMessageId,
          mergeChatMessagePages: client.mergeChatMessagePages,
          chatHistoryCache: history.chatHistoryCache
        });
        return modules;
      })
      .catch(error => {
        loading = null;
        throw error;
      });

    return loading;
  };
}
