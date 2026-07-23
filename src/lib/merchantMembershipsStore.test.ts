import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantMembershipRecord } from "@/lib/merchantMemberships";
import {
  loadStoredMerchantMemberships,
  mergeStoredMerchantMembershipRows,
  type MerchantMembershipsStoreClient,
} from "@/lib/merchantMembershipsStore";

function createReadClient(result: { data: unknown; error: unknown }): MerchantMembershipsStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

function createMembership(updatedAt: string, nickname: string) {
  const membership = normalizeMerchantMembershipRecord({
    id: "membership-1",
    siteId: "10000000",
    siteName: "Test merchant",
    memberNo: "10000000000001",
    serial: 1,
    accountId: "account-1",
    nickname,
    joinedAt: "2026-07-01T00:00:00.000Z",
    updatedAt,
    status: "active",
  });
  assert.ok(membership);
  return membership;
}

test("membership store merges the newest copy of each member", () => {
  const merged = mergeStoredMerchantMembershipRows("10000000", [
    {
      id: "old-row",
      slug: "__merchant_memberships__:10000000",
      blocks: [createMembership("2026-07-01T00:00:00.000Z", "Old")],
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "new-row",
      slug: "__merchant_memberships__:10000000",
      blocks: [createMembership("2026-07-02T00:00:00.000Z", "Updated")],
      updated_at: "2026-07-02T00:00:00.000Z",
    },
  ]);

  assert.ok(merged);
  assert.equal(merged?.memberships.length, 1);
  assert.equal(merged?.memberships[0]?.nickname, "Updated");
  assert.equal(merged?.updatedAt, "2026-07-02T00:00:00.000Z");
});

test("membership store propagates unexpected read failures instead of reporting empty data", async () => {
  const client = createReadClient({ data: null, error: { message: "upstream timeout" } });
  await assert.rejects(
    () => loadStoredMerchantMemberships(client, "10000000"),
    /merchant_memberships_read_failed:upstream timeout/,
  );
});

test("membership store still treats a known legacy schema without slug as empty", async () => {
  const client = createReadClient({ data: null, error: { message: "column pages.slug does not exist" } });
  assert.equal(await loadStoredMerchantMemberships(client, "10000000"), null);
});
