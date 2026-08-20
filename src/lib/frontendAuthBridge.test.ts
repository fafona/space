import assert from "node:assert/strict";
import test from "node:test";
import {
  installFrontendAuthBridgeResponder,
  isDirectFrontendAuthBridgeChild,
  isTrustedFrontendAuthBridgeOrigin,
  normalizeFrontendAuthBridgePayload,
  requestParentFrontendAuthPayload,
} from "@/lib/frontendAuthBridge";

test("frontend auth bridge rejects every origin and payload", async () => {
  assert.equal(
    isTrustedFrontendAuthBridgeOrigin("https://www.faolla.com", "https://www.faolla.com"),
    false,
  );
  assert.equal(
    isTrustedFrontendAuthBridgeOrigin("https://merchant.faolla.com", "https://www.faolla.com"),
    false,
  );
  assert.equal(isDirectFrontendAuthBridgeChild({} as Window, null), false);
  assert.equal(
    normalizeFrontendAuthBridgePayload({
      authenticated: true,
      frontendAuthProof: "legacy-proof",
      user: { id: "user-1", email: "person@example.com" },
    }),
    null,
  );
  assert.equal(await requestParentFrontendAuthPayload(), null);
});

test("frontend auth responder is a no-op", () => {
  let reads = 0;
  const uninstall = installFrontendAuthBridgeResponder(() => {
    reads += 1;
    return { authenticated: true, user: { id: "user-1" } };
  });
  uninstall();
  assert.equal(reads, 0);
});
