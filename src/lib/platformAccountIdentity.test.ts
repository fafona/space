import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlatformAccountIdentityForUser } from "@/lib/platformAccountIdentity";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";

function clientWith(data: unknown, error: unknown = null) {
  return {
    async rpc() {
      return { data, error };
    },
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [] }, error: null };
        },
        async updateUserById() {
          return { data: { user: null }, error: null };
        },
      },
    },
  };
}

test("platform identity only returns merchant ids positively bound by the authoritative resolver", async () => {
  const identity = await resolvePlatformAccountIdentityForUser(
    clientWith({
      schemaVersion: 1,
      status: "resolved",
      accountType: "merchant",
      merchantIds: ["12345678", "87654321"],
      personalAccountId: null,
    }),
    {
      id: AUTH_USER_ID,
      email: "forged-link@example.com",
      user_metadata: {
        account_type: "personal",
        merchant_id: "99999999",
      },
      app_metadata: {
        merchant_id: "99999999",
      },
    },
    {
      preferredAccountType: "personal",
      preferredAccountId: "99999999",
      preferredMerchantId: "87654321",
      preferredMerchantIds: ["99999999"],
      preferredEmail: "forged-link@example.com",
    },
  );

  assert.deepEqual(identity, {
    accountType: "merchant",
    accountId: "87654321",
    merchantId: "87654321",
    merchantIds: ["12345678", "87654321"],
  });

  await assert.rejects(
    () =>
      resolvePlatformAccountIdentityForUser(
        clientWith({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678", "87654321"],
          personalAccountId: null,
        }),
        { id: AUTH_USER_ID },
        {
          preferredMerchantId: "99999999",
          strictPreferredMerchantId: true,
        },
      ),
    /ordinary_account_merchant_selection_forbidden/,
  );
});

test("platform identity only returns the canonical active personal account", async () => {
  const identity = await resolvePlatformAccountIdentityForUser(
    clientWith({
      schemaVersion: 1,
      status: "resolved",
      accountType: "personal",
      merchantIds: [],
      personalAccountId: "50010105",
    }),
    {
      id: AUTH_USER_ID,
      user_metadata: {
        account_type: "merchant",
        merchant_id: "99999999",
      },
    },
    {
      preferredAccountType: "merchant",
      preferredAccountId: "forged-personal",
    },
  );

  assert.deepEqual(identity, {
    accountType: "personal",
    accountId: "50010105",
    merchantId: null,
    merchantIds: [],
  });
});

test("platform identity refuses disabled, unbound and employee-only principals", async () => {
  await assert.rejects(
    () =>
      resolvePlatformAccountIdentityForUser(
        clientWith({
          schemaVersion: 1,
          status: "disabled",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010106",
        }),
        { id: AUTH_USER_ID },
      ),
    /ordinary_account_personal_disabled/,
  );
  await assert.rejects(
    () =>
      resolvePlatformAccountIdentityForUser(
        clientWith({
          schemaVersion: 1,
          status: "unbound",
          accountType: null,
          merchantIds: [],
          personalAccountId: null,
        }),
        { id: AUTH_USER_ID },
      ),
    /ordinary_account_principal_unbound/,
  );
  await assert.rejects(
    () =>
      resolvePlatformAccountIdentityForUser(
        clientWith(null, {
          message: "ordinary_account_staff_identity_forbidden",
        }),
        {
          id: AUTH_USER_ID,
          user_metadata: { merchant_id: "12345678" },
        },
      ),
    /merchant_staff_identity_forbidden/,
  );
});
