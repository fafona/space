import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantCoupon } from "@/lib/merchantCoupons";
import {
  loadStoredMerchantCoupons,
  mergeStoredMerchantCouponRows,
  saveStoredMerchantCoupons,
  type MerchantCouponsStoreClient,
} from "@/lib/merchantCouponsStore";

function createReadClient(result: { data: unknown; error: unknown }): MerchantCouponsStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

test("coupon store merges the newest copy of each coupon", () => {
  const coupon = createMerchantCoupon({
    siteId: "10000000",
    title: "Welcome",
    discountValue: 5,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  const merged = mergeStoredMerchantCouponRows("10000000", [
    {
      id: "old-row",
      slug: "__merchant_coupons__:10000000",
      blocks: [coupon],
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "new-row",
      slug: "__merchant_coupons__:10000000",
      blocks: [{ ...coupon, title: "Updated", updatedAt: "2026-07-02T00:00:00.000Z" }],
      updated_at: "2026-07-02T00:00:00.000Z",
    },
  ]);

  assert.ok(merged);
  assert.equal(merged?.coupons.length, 1);
  assert.equal(merged?.coupons[0]?.title, "Updated");
  assert.equal(merged?.updatedAt, "2026-07-02T00:00:00.000Z");
});

test("coupon store propagates unexpected read failures instead of reporting empty data", async () => {
  const client = createReadClient({ data: null, error: { message: "upstream timeout" } });
  await assert.rejects(
    () => loadStoredMerchantCoupons(client, "10000000"),
    /merchant_coupons_read_failed:upstream timeout/,
  );
});

test("coupon store still treats a known legacy schema without slug as empty", async () => {
  const client = createReadClient({ data: null, error: { message: "column pages.slug does not exist" } });
  assert.equal(await loadStoredMerchantCoupons(client, "10000000"), null);
});

const VERSION = "2026-09-08T10:00:00.000Z";
const COMMITTED_VERSION = "2026-09-08T10:00:01.000Z";

test("coupon writes pass the original version and scoped normalized snapshot to the transaction only", async () => {
  const calls: unknown[] = [];
  const coupon = createMerchantCoupon({ siteId: "10000000", title: "Voucher" });
  const foreignCoupon = createMerchantCoupon({ siteId: "20000000", title: "Foreign" });
  const client: MerchantCouponsStoreClient = {
    from: () => { throw new Error("direct reads, history and writes are forbidden"); },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { updatedAt: COMMITTED_VERSION, replayed: false, versions: { coupons: COMMITTED_VERSION } }, error: null };
    },
  };
  const result = await saveStoredMerchantCoupons(client, {
    siteId: " 10000000 ", coupons: [coupon, foreignCoupon], expectedUpdatedAt: VERSION,
    existingRowId: "ignored-row", updatedAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(result.error, null);
  assert.deepEqual(calls, [{
    name: "faolla_commit_redemption_v1",
    args: { p_site_id: "10000000", p_mutation: { coupons: { expectedUpdatedAt: VERSION, next: [coupon] } } },
  }]);
});

test("coupon writes require an explicit expected version and never read a newer version", async () => {
  let calls = 0;
  const client: MerchantCouponsStoreClient = {
    from: () => { throw new Error("unexpected query"); },
    rpc: async () => { calls += 1; return { data: null, error: null }; },
  };
  for (const expectedUpdatedAt of [undefined, "", "   ", 123]) {
    const result = await saveStoredMerchantCoupons(client, {
      siteId: "10000000", coupons: [], expectedUpdatedAt,
    } as Parameters<typeof saveStoredMerchantCoupons>[1]);
    assert.equal(result.error, "merchant_coupons_expected_version_required");
  }
  assert.equal(calls, 0);
});

test("explicit null is forwarded as the absent-row CAS, never replaced with a fresh read", async () => {
  let captured: unknown;
  const result = await saveStoredMerchantCoupons({
    from: () => { throw new Error("unexpected query"); },
    rpc: async (_name, args) => {
      captured = args;
      return { data: { updatedAt: COMMITTED_VERSION, replayed: false, versions: { coupons: COMMITTED_VERSION } }, error: null };
    },
  }, { siteId: "10000000", coupons: [], expectedUpdatedAt: null });
  assert.equal(result.error, null);
  assert.deepEqual(captured, {
    p_site_id: "10000000", p_mutation: { coupons: { expectedUpdatedAt: null, next: [] } },
  });
});

test("coupon writes fail closed on missing RPC, conflicts, exceptions and malformed success", async () => {
  const noQueries = () => { throw new Error("direct write fallback forbidden"); };
  const scenarios: Array<{ client: MerchantCouponsStoreClient; expected: string }> = [
    { client: { from: noQueries }, expected: "merchant_transaction_unavailable" },
    { client: { from: noQueries, rpc: async () => ({ error: { message: "merchant_coupons_conflict" } }) }, expected: "merchant_coupons_conflict" },
    { client: { from: noQueries, rpc: async () => { throw new Error("network response lost"); } }, expected: "merchant_transaction_unavailable" },
    { client: { from: noQueries, rpc: async () => ({ data: { updatedAt: COMMITTED_VERSION }, error: null }) }, expected: "merchant_transaction_unavailable" },
  ];
  for (const { client, expected } of scenarios) {
    const result = await saveStoredMerchantCoupons(client, { siteId: "10000000", coupons: [], expectedUpdatedAt: VERSION });
    assert.equal(result.error, expected);
  }
});
