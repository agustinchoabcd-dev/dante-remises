const ROLE_VIEWS = Object.freeze({
  passenger: Object.freeze(["pasajero", "chat", "configuracion"]),
  driver: Object.freeze(["chofer", "chat", "configuracion"]),
  operator: Object.freeze(["central", "chat", "configuracion"]),
  admin: Object.freeze(["central", "chofer", "chat", "configuracion"])
});

export function canAccessRoleView(role, view) {
  return ROLE_VIEWS[role]?.includes(view) === true;
}
