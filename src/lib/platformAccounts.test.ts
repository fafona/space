import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformAccountMetadataPatch,
  isPersonalAccountNumericId,
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeFromMetadata,
} from "@/lib/platformAccounts";

test("platform account metadata helpers read type and account id", () => {
  const user = {
    user_metadata: {
      account_type: "personal",
      account_id: "50010105",
    },
  };

  assert.equal(readPlatformAccountTypeFromMetadata(user), "personal");
  assert.equal(readPlatformAccountIdFromMetadata(user), "50010105");
  assert.equal(isPersonalAccountNumericId("50010105"), true);
  assert.equal(isPersonalAccountNumericId("10000001"), false);
});

test("platform account metadata patch keeps mirrored account fields", () => {
  const patch = buildPlatformAccountMetadataPatch(
    {
      user_metadata: { username: "tester" },
      app_metadata: {},
    },
    "merchant",
    "10000001",
  );

  assert.equal(patch.user_metadata?.account_type, "merchant");
  assert.equal(patch.user_metadata?.account_id, "10000001");
  assert.equal(patch.user_metadata?.merchant_id, "10000001");
  assert.equal(patch.user_metadata?.login_id, "10000001");
  assert.equal(patch.user_metadata?.username, "tester");
});
