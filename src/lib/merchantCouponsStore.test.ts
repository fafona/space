import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantCoupon } from "@/lib/merchantCoupons";
import {
  loadStoredMerchantCoupons,
  mergeStoredMerchantCouponRows,
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
