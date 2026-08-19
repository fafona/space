import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  hasMerchantStaffPrincipalDenyHint,
  hasImmutableMerchantStaffPrincipal,
} from "@/lib/merchantStaffPrincipal.server";

test("merchant staff marker is trusted only from immutable app metadata", async () => {
  assert.equal(
    hasImmutableMerchantStaffPrincipal({
      id: "user-1",
      app_metadata: { principal_type: "merchant_staff" },
    }),
    true,
  );
  assert.equal(
    hasImmutableMerchantStaffPrincipal({
      id: "user-1",
      app_metadata: {},
      user_metadata: { principal_type: "merchant_staff" },
    }),
    false,
  );
  assert.equal(
    hasMerchantStaffPrincipalDenyHint({
      id: "user-1",
      app_metadata: {},
      user_metadata: { principal_type: "merchant_staff" },
    }),
    false,
  );
});

test("owner-only token routes delegate to the authoritative ordinary-account principal", () => {
  [
    "src/app/api/publish/route.ts",
    "src/app/api/merchant-draft/route.ts",
    "src/app/api/merchant-domain-binding/route.ts",
    "src/app/api/merchant-chat-business-card/route.ts",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, /resolveMerchantPrincipalFromRequest\(/, relativePath);
    assert.doesNotMatch(
      source,
      /readMerchantRequestAccessTokens|readMetadataMerchantIds|getAuthorizedMerchantIds|assertLegacyMerchantIdentityAllowed/,
      relativePath,
    );
  });

  const principalSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/serverMerchantSession.ts"),
    "utf8",
  );
  assert.match(
    principalSource,
    /resolveOrdinaryAccountPlatformIdentity\(adminSupabase, user/,
  );
  assert.doesNotMatch(
    principalSource,
    /user\?\.(?:user_metadata|app_metadata)|owner_email|contact_email|user_email/,
  );

  const chatCardSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/merchant-chat-business-card/route.ts",
    ),
    "utf8",
  );
  assert.match(chatCardSource, /if \(options\.allowPeerRead !== true\) return false/);
  assert.equal(
    chatCardSource.match(/\{ allowPeerRead: true \}/g)?.length,
    1,
    "peer access must remain read-only; POST requires an owned binding",
  );
});

test("personal peer directory binds metadata candidates through the authoritative resolver", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/merchant-peer-messages/route.ts",
    ),
    "utf8",
  );
  assert.match(
    source,
    /resolvePlatformAccountIdentityForUser\(\s*supabase,\s*summary/,
  );
  assert.match(source, /identity\.accountType !== "personal"/);
  assert.match(source, /identity\.accountId/);
  assert.doesNotMatch(
    source,
    /readPlatformAccountIdFromMetadata|readPlatformAccountTypeHintFromMetadata/,
  );
});
