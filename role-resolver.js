export function resolveRoleFromProfile({ uid, profile, legacyStaff, adminUid, userEmail }) {
  if (!uid) return null;

  // The root administrator is immutable and remains the driver of car 144.
  if (uid === adminUid) {
    return { ...(legacyStaff || {}), role: "admin", carId: "144" };
  }

  const currentProfile = profile && typeof profile === "object" ? profile : {};
  if (currentProfile.active === false) {
    throw new Error("Tu cuenta está desactivada. Contactá a un administrador.");
  }

  const allowedRoles = new Set(["passenger", "driver", "operator", "admin"]);
  let role = currentProfile.role;

  // Temporary bridge for existing staff profiles created before role migration.
  if (legacyStaff && (!role || role === "passenger")) {
    role = legacyStaff.role;
  }

  if (!allowedRoles.has(role)) return null;
  // No account other than the immutable root UID can become an administrator.
  if (role === "admin") return null;

  const carId = role === "driver"
    ? (currentProfile.carId || legacyStaff?.carId || null)
    : null;

  if (role === "driver" && !carId) {
    throw new Error("Tu perfil de chofer no tiene un coche asignado. Contactá a un administrador.");
  }

  const name = [currentProfile.name, currentProfile.lastName]
    .filter(Boolean)
    .join(" ") || legacyStaff?.name || userEmail || "Usuario";

  return { role, name, carId, profile: currentProfile };
}
