export async function completeLogout({
  cleanup = [],
  signOut,
  onSignedOut = () => {},
  onCleanupError = error => console.warn("Logout cleanup failed:", error?.name || "Error")
} = {}) {
  if (typeof signOut !== "function") {
    throw new TypeError("completeLogout requires a signOut function");
  }
  if (!Array.isArray(cleanup) || cleanup.some(task => typeof task !== "function")) {
    throw new TypeError("cleanup must be an array of functions");
  }

  for (const task of cleanup) {
    try {
      await task();
    } catch (error) {
      onCleanupError(error);
    }
  }

  await signOut();
  onSignedOut();
}
