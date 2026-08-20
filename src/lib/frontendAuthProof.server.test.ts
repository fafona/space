import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createFrontendAuthProof,
  verifyFrontendAuthProof,
} from "@/lib/frontendAuthProof.server";

const SECRET = "frontend-proof-account-id-length-regression-secret";

function withProofSecret(task: () => void) {
  const previous = process.env.FRONTEND_AUTH_PROOF_SECRET;
  process.env.FRONTEND_AUTH_PROOF_SECRET = SECRET;
  try {
    task();
  } finally {
    process.env.FRONTEND_AUTH_PROOF_SECRET = previous;
  }
}

function signRawPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

test("frontend proof minting stays disabled even for a canonical personal account", () => {
  withProofSecret(() => {
    assert.equal(createFrontendAuthProof({
      accountType: "personal",
      accountId: "50010105",
      userId: "10000000-0000-4000-8000-000000000001",
    }), "");
  });
});

test("the verifier rejects a correctly signed legacy two-hour proof", () => {
  withProofSecret(() => {
    const now = Math.floor(Date.now() / 1000);
    const legacyProof = signRawPayload({
      accountType: "personal",
      accountId: "50010105",
      userId: "10000000-0000-4000-8000-000000000001",
      iat: now,
      exp: now + 2 * 60 * 60,
    });
    assert.equal(verifyFrontendAuthProof(legacyProof), null);
    assert.equal(verifyFrontendAuthProof("malformed-proof"), null);
  });
});
