import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeMerchantIdentityCandidateIds,
  readMerchantIdFromMetadata,
  resolveMerchantIdentityForUser,
  type MerchantAuthUserSummary,
} from "@/lib/merchantAuthIdentity";

test("merchant identity candidate ids preserve preferred order and dedupe duplicates", () => {
  assert.deepEqual(
    mergeMerchantIdentityCandidateIds("10000002", ["10000003", "10000002"], "10000004", "legacy"),
    ["10000002", "10000003", "10000004"],
  );
});

test("merchant id can be read from auth metadata aliases", () => {
  const user: MerchantAuthUserSummary = {
    user_metadata: {
      merchantId: "10000008",
    },
  };
  assert.equal(readMerchantIdFromMetadata(user), "10000008");
});

test("resolved merchant identity keeps preferred id ahead of queried ids", async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit() {
                  return Promise.resolve({
                    data: [{ id: "10000005" }, { id: "10000006" }],
                    error: null,
                  });
                },
              };
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const identity = await resolveMerchantIdentityForUser(client, {
    id: "user-1",
    email: "merchant@example.com",
  }, {
    preferredMerchantId: "10000002",
  });

  assert.equal(identity.merchantId, "10000002");
  assert.deepEqual(identity.merchantIds, ["10000002", "10000005", "10000006"]);
});
