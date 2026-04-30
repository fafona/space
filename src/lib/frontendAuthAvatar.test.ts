import test from "node:test";
import assert from "node:assert/strict";
import { readFrontendAuthMerchantIds, resolveFrontendAuthAvatarUrl } from "@/lib/frontendAuthAvatar";

test("readFrontendAuthMerchantIds includes merchant account id", () => {
  assert.deepEqual(
    readFrontendAuthMerchantIds({
      authenticated: true,
      accountType: "merchant",
      accountId: "10000000",
      merchantId: null,
      merchantIds: [],
    }),
    ["10000000"],
  );
});

test("resolveFrontendAuthAvatarUrl prefers current merchant avatar for merchant accounts", () => {
  assert.equal(
    resolveFrontendAuthAvatarUrl({
      accountType: "merchant",
      sessionAvatarUrl: "https://example.com/stale-session.webp",
      currentMerchantAvatarUrl: "https://example.com/current-merchant.webp",
      currentSiteBelongsToSession: true,
    }),
    "https://example.com/current-merchant.webp",
  );
});

test("resolveFrontendAuthAvatarUrl keeps session avatar first for personal accounts", () => {
  assert.equal(
    resolveFrontendAuthAvatarUrl({
      accountType: "personal",
      sessionAvatarUrl: "https://example.com/personal.webp",
      currentMerchantAvatarUrl: "https://example.com/merchant.webp",
      currentSiteBelongsToSession: true,
    }),
    "https://example.com/personal.webp",
  );
});
