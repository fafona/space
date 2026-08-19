import assert from "node:assert/strict";
import test from "node:test";
import { loadPublicPersonalProfileByAccountId } from "@/lib/publicPersonalProfile";

const TARGET_ACCOUNT_ID = "50010105";
const CANONICAL_USER_ID = "10000000-0000-4000-8000-000000000002";

function createBindingQuery(authUserId: string) {
  const query = {
    select() { return query; },
    eq() { return query; },
    limit() { return query; },
    async maybeSingle() {
      return {
        data: {
          auth_user_id: authUserId,
          personal_account_id: TARGET_ACCOUNT_ID,
          status: "active",
        },
        error: null,
      };
    },
  };
  return query;
}

test("public personal profile uses a canonical reverse candidate and requires resolver agreement", async () => {
  const rpcCalls: string[] = [];
  const client = {
    auth: {
      admin: {
        async getUserById(userId: string) {
          assert.equal(userId, CANONICAL_USER_ID);
          return {
            data: {
              user: {
                id: CANONICAL_USER_ID,
                user_metadata: {
                  account_type: "merchant",
                  account_id: "12345678",
                  displayName: "canonical",
                  country: "private-country",
                  province: "private-province",
                  city: "private-city",
                  address: "private-street-address",
                },
              },
            },
            error: null,
          };
        },
      },
    },
    from() {
      return createBindingQuery(CANONICAL_USER_ID);
    },
    async rpc(_functionName: string, args?: Record<string, unknown>) {
      const authUserId = String(args?.p_auth_user_id ?? "");
      rpcCalls.push(authUserId);
      return {
        data: {
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId:
            authUserId === CANONICAL_USER_ID ? TARGET_ACCOUNT_ID : "50010106",
        },
        error: null,
      };
    },
  };

  assert.deepEqual(
    await loadPublicPersonalProfileByAccountId(client, TARGET_ACCOUNT_ID),
    {
      accountId: TARGET_ACCOUNT_ID,
      displayName: "canonical",
      avatarUrl: "",
      signature: "",
      country: "",
      province: "",
      city: "",
      address: "",
    },
  );
  assert.deepEqual(rpcCalls, [CANONICAL_USER_ID]);
});

test("public personal profile fails closed for a disabled canonical binding", async () => {
  const client = {
    auth: {
      admin: {
        async getUserById() {
          return {
            data: {
              user: {
                id: CANONICAL_USER_ID,
                user_metadata: {
                  account_type: "personal",
                  account_id: TARGET_ACCOUNT_ID,
                },
              },
            },
            error: null,
          };
        },
      },
    },
    from() {
      return createBindingQuery(CANONICAL_USER_ID);
    },
    async rpc() {
      return {
        data: {
          schemaVersion: 1,
          status: "disabled",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: TARGET_ACCOUNT_ID,
        },
        error: null,
      };
    },
  };

  assert.equal(
    await loadPublicPersonalProfileByAccountId(client, TARGET_ACCOUNT_ID),
    null,
  );
});
