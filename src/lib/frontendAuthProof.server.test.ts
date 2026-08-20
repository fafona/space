import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrontendAuthProof,
  verifyFrontendAuthProof,
} from "@/lib/frontendAuthProof.server";

test("frontend auth proof minting stays disabled", () => {
  process.env.FRONTEND_AUTH_PROOF_SECRET = "legacy-test-secret";
  assert.equal(
    createFrontendAuthProof({
      accountType: "personal",
      accountId: "personal-1",
      userId: "user-1",
      email: "person@example.com",
    }),
    "",
  );
});

test("legacy and malformed frontend auth proofs are always rejected", () => {
  process.env.FRONTEND_AUTH_PROOF_SECRET = "legacy-test-secret";
  assert.equal(verifyFrontendAuthProof("legacy.payload.signature"), null);
  assert.equal(verifyFrontendAuthProof(""), null);
  assert.equal(verifyFrontendAuthProof(null), null);
});
