export async function completeLogout({
  cleanup = [],
  signOut,
  onSignedOut = () => {},
  onCleanupError = error => console.warn("Logout cleanup failed:", error?.name || "Error"),
  onTransitionError = error => console.error("Logout UI transition failed:", error?.name || "Error")
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
      try {
        onCleanupError(error);
      } catch (reportError) {
        console.error("Could not report logout cleanup failure:", reportError?.name || "Error");
      }
    }
  }

  // A partir de aquí Firebase confirmó el cierre. Un error visual no debe
  // propagarse como si la autenticación hubiera fallado.
  await signOut();
  try {
    await onSignedOut();
    return { signedOut: true, transitionCompleted: true };
  } catch (error) {
    try {
      onTransitionError(error);
    } catch (reportError) {
      console.error("Could not report logout UI transition failure:", reportError?.name || "Error");
    }
    return { signedOut: true, transitionCompleted: false };
  }
}
