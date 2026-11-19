import test from "node:test";
import assert from "node:assert/strict";
import { completeLogout } from "./session-logout.mjs";

test("logout completes every cleanup, signs out, then returns to the login home", async () => {
  const calls = [];
  await completeLogout({
    cleanup: [
      async () => { calls.push("dismiss-alert"); },
      async () => { calls.push("unregister-push"); throw new Error("offline"); },
      async () => { calls.push("clear-presence"); }
    ],
    signOut: async () => { calls.push("sign-out"); },
    onSignedOut: () => { calls.push("show-login"); },
    onCleanupError: error => { calls.push("cleanup-error:" + error.message); }
  });
  assert.deepEqual(calls, [
    "dismiss-alert",
    "unregister-push",
    "cleanup-error:offline",
    "clear-presence",
    "sign-out",
    "show-login"
  ]);
});

test("logout does not show the logged-out home if Firebase sign-out fails", async () => {
  let returnedHome = false;
  await assert.rejects(
    completeLogout({
      signOut: async () => { throw new Error("auth unavailable"); },
      onSignedOut: () => { returnedHome = true; }
    }),
    /auth unavailable/
  );
  assert.equal(returnedHome, false);
});

test("logout requires a signOut function", async () => {
  await assert.rejects(completeLogout(), /requires a signOut function/);
});
