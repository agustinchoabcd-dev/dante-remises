export function createRoleTransitionController(documentRef) {
  if (!documentRef?.body?.classList) {
    throw new TypeError("A document with a body classList is required");
  }

  let generation = 0;

  return Object.freeze({
    begin() {
      const token = ++generation;
      documentRef.body.classList.add("dante-role-transition");
      return token;
    },

    isCurrent(token) {
      return token === generation;
    },

    finish(token) {
      if (token !== generation) return false;
      documentRef.body.classList.remove("dante-role-transition");
      return true;
    },

    invalidate() {
      generation += 1;
      documentRef.body.classList.remove("dante-role-transition");
      return generation;
    }
  });
}
