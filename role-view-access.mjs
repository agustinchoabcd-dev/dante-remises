const ROLE_VIEWS = Object.freeze({
  passenger: Object.freeze(["pasajero", "passengerOnboarding", "chat", "configuracion"]),
  driver: Object.freeze(["chofer", "chat", "configuracion"]),
  operator: Object.freeze(["central", "chat", "configuracion"]),
  admin: Object.freeze(["central", "chofer", "chat", "configuracion"])
});
const ROLE_VIEW_IDS = Object.freeze(["pasajero", "chofer", "central", "chat", "configuracion", "passengerOnboarding"]);

function setHidden(element, hidden) {
  if (!element?.classList) return false;
  element.classList.toggle("hidden", hidden);
  return true;
}
export function canAccessRoleView(role, view) {
  return ROLE_VIEWS[role]?.includes(view) === true;
}
export function hideRoleViews(documentRef) {
  if (!documentRef?.getElementById || !documentRef?.querySelectorAll) throw new TypeError("A document reference is required");
  for (const id of ROLE_VIEW_IDS) setHidden(documentRef.getElementById(id), true);
  for (const tab of documentRef.querySelectorAll(".tab")) {
    setHidden(tab, true);
    tab.classList.remove("active");
  }
}
export function applyRoleView(documentRef, role, view) {
  if (!canAccessRoleView(role, view)) return false;
  if (!documentRef?.getElementById || !documentRef?.querySelectorAll) throw new TypeError("A document reference is required");
  if (!documentRef.getElementById(view)?.classList) return false;
  for (const id of ROLE_VIEW_IDS) setHidden(documentRef.getElementById(id), id !== view);
  for (const tab of documentRef.querySelectorAll(".tab")) {
    const tabView = tab.dataset?.view;
    setHidden(tab, !canAccessRoleView(role, tabView));
    tab.classList.toggle("active", tabView === view);
  }
  return true;
}
