import assert from "node:assert/strict";
import test from "node:test";
import { reuseExistingPairing } from "./pairing.js";

test("reuses an existing valid pairing instead of starting another request", async () => {
  const session = { executor: { installId: "install-a" } };
  const result = await reuseExistingPairing({
    getToken: async () => "saved-token",
    getSession: async () => session,
    clearToken: async () => {},
  });

  assert.deepEqual(result, { session, alreadyPaired: true });
});

test("clears an invalid saved pairing so a new pairing can start", async () => {
  let cleared = false;
  const result = await reuseExistingPairing({
    getToken: async () => "stale-token",
    getSession: async () => {
      const error = new Error("Unauthorized");
      error.code = "UNAUTHORIZED";
      throw error;
    },
    clearToken: async () => {
      cleared = true;
    },
  });

  assert.equal(result, null);
  assert.equal(cleared, true);
});
