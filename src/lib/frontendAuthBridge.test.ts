import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrustedFrontendAuthBridgeOrigin,
  normalizeFrontendAuthBridgePayload,
} from "@/lib/frontendAuthBridge";

test("frontend auth bridge trusts faolla subdomains", () => {
  assert.equal(isTrustedFrontendAuthBridgeOrigin("https://www.faolla.com", "https://faolla.com"), true);
  assert.equal(isTrustedFrontendAuthBridgeOrigin("https://fafona.faolla.com", "https://www.faolla.com"), true);
  assert.equal(isTrustedFrontendAuthBridgeOrigin("https://example.com", "https://faolla.com"), false);
});

test("frontend auth bridge keeps only public authenticated session fields", () => {
  assert.deepEqual(
    normalizeFrontendAuthBridgePayload({
      authenticated: true,
      accountType: "personal",
      accountId: " 50010105 ",
      merchantId: null,
      merchantIds: ["", "10000000"],
      accessToken: "secret",
      user: {
        email: "user@example.com",
        user_metadata: {
          displayName: "Nana",
        },
      },
    }),
    {
      authenticated: true,
      accountType: "personal",
      accountId: "50010105",
      merchantId: null,
      merchantIds: ["10000000"],
      user: {
        email: "user@example.com",
        user_metadata: {
          displayName: "Nana",
        },
      },
    },
  );
});
