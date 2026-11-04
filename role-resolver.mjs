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

  // Only profiles without a role use the temporary legacy staff mapping.
  // An explicit role, especially "passenger", always takes precedence.
  if (!role && legacyStaff) role = legacyStaff.role;

  if (!allowedRoles.has(role)) return null;
  // No account other than the immutable root UID can become an administrator.
  if (role === "admin") return null;

  // A missing carId is a legacy profile; an explicit null means unassigned.
  const hasDynamicCarAssignment = Object.prototype.hasOwnProperty.call(currentProfile, "carId");
  const carId = role === "driver"
    ? (hasDynamicCarAssignment ? currentProfile.carId : legacyStaff?.carId || null)
    : null;

  if (role === "driver" && !carId) {
    throw new Error("Tu perfil de chofer no tiene un coche asignado. Contactá a un administrador.");
  }

  const name = [currentProfile.name, currentProfile.lastName]
    .filter(Boolean)
    .join(" ") || legacyStaff?.name || userEmail || "Usuario";

  return { role, name, carId, profile: currentProfile };
}

/**
 * Resolve the UID assigned to a car.
 * When Firebase has an explicit dynamic assignment field (including null),
 * it takes precedence over the temporary static compatibility map.
 */
export function resolveDriverUidForCar({ driverUid, driverUidConfigured }, legacyDriverUid) {
  if (driverUidConfigured === true) {
    return typeof driverUid === "string" && driverUid.length > 0 ? driverUid : null;
  }
  return legacyDriverUid || null;
}
