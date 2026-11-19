const roleLoaders = Object.freeze({
  passenger: () => import("./roles/passenger.mjs"),
  driver: () => import("./roles/driver.mjs"),
  operator: () => import("./roles/operator.mjs"),
  admin: () => import("./roles/admin.mjs")
});

/**
 * Load only the activation module for the authenticated role.
 * Shared services remain owned by the application shell and are injected
 * through context, so role modules cannot create parallel app state.
 */
export async function activateRole(role, context) {
  const loader = roleLoaders[role];
  if (!loader) throw new Error("Unsupported Dante Remises role: " + String(role));

  const module = await loader();
  if (typeof module.activate !== "function") {
    throw new TypeError("Role module does not export activate(): " + role);
  }

  return module.activate(context);
}
