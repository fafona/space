import assert from "node:assert/strict";
import test from "node:test";
import { resolveMerchantDeletionOwnerAuthUserId } from "./route";

const ownerId = "10000000-0000-4000-8000-000000000001";

function merchant(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000001",
    user_id: ownerId,
    auth_user_id: ownerId,
    owner_user_id: ownerId,
    owner_id: ownerId,
    auth_id: ownerId,
    created_by: ownerId,
    created_by_user_id: ownerId,
    ...overrides,
  };
}

test("merchant deletion accepts only one exact seven-column owner binding", () => {
  assert.equal(resolveMerchantDeletionOwnerAuthUserId(merchant()), ownerId);
  assert.equal(
    resolveMerchantDeletionOwnerAuthUserId(
      merchant({ auth_user_id: ownerId.toUpperCase() }),
    ),
    ownerId,
  );
});

test("merchant deletion fails closed for missing, malformed, or split owners", () => {
  assert.equal(
    resolveMerchantDeletionOwnerAuthUserId(merchant({ owner_id: null })),
    "",
  );
  assert.equal(
    resolveMerchantDeletionOwnerAuthUserId(merchant({ auth_id: "not-a-uuid" })),
    "",
  );
  assert.equal(
    resolveMerchantDeletionOwnerAuthUserId(
      merchant({
        created_by_user_id: "20000000-0000-4000-8000-000000000002",
      }),
    ),
    "",
  );
});
