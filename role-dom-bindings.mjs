export function createRoleDomBindings(documentRef = globalThis.document) {
  if (!documentRef?.getElementById) throw new TypeError("A document reference is required");

  const registrations = [];
  const attachedByElement = new WeakMap();

  function attach(registration, element) {
    if (!element?.addEventListener) return false;
    let attached = attachedByElement.get(element);
    if (!attached) {
      attached = new Set();
      attachedByElement.set(element, attached);
    }
    if (attached.has(registration)) return false;
    element.addEventListener(registration.event, registration.handler, registration.options);
    attached.add(registration);
    return true;
  }

  function bind(id, event, handler, options) {
    if (!id || typeof event !== "string" || typeof handler !== "function") {
      throw new TypeError("bind() requires an element ID, event name and handler");
    }
    const registration = { id, event, handler, options };
    registrations.push(registration);
    attach(registration, documentRef.getElementById(id));
    return () => {
      const index = registrations.indexOf(registration);
      if (index >= 0) registrations.splice(index, 1);
      const element = documentRef.getElementById(id);
      const attached = element && attachedByElement.get(element);
      if (attached?.has(registration)) {
        element.removeEventListener?.(event, handler, options);
        attached.delete(registration);
      }
    };
  }

  function flush() {
    let attachedCount = 0;
    for (const registration of registrations) {
      if (attach(registration, documentRef.getElementById(registration.id))) attachedCount += 1;
    }
    return attachedCount;
  }

  return Object.freeze({ bind, flush });
}
