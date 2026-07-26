import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMerchantCouponRecord,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import {
  mirrorMerchantCouponChanges,
  normalizeMerchantCouponDualWriteSiteIds,
  resolveMerchantCouponDualWriteConfig,
} from "@/lib/merchantCouponDualWrite.server";

function buildCoupon(
  overrides: Parameters<typeof normalizeMerchantCouponRecord>[0] = {},
): MerchantCouponRecord {
  const coupon = normalizeMerchantCouponRecord({
    id: "coupon-1",
    siteId: "10000000",
    title: "Welcome",
    code: "WELCOME",
    discountType: "amount_off",
    discountValue: 10,
    status: "active",
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-25T08:00:00.000Z",
    ...overrides,
  });
  assert.ok(coupon);
  return coupon;
}

test("coupon shadow configuration is off and deny-by-default", () => {
  assert.deepEqual(resolveMerchantCouponDualWriteConfig({}), {
    mode: "off",
    siteIds: [],
    timeoutMs: 2500,
  });
  assert.deepEqual(
    resolveMerchantCouponDualWriteConfig({
      MERCHANT_COUPON_V1_DUAL_WRITE_MODE: "shadow",
      MERCHANT_COUPON_V1_DUAL_WRITE_SITE_IDS:
        "10000000,*,bad,10000000,10000001",
      MERCHANT_COUPON_V1_DUAL_WRITE_TIMEOUT_MS: "50",
    }),
    {
      mode: "shadow",
      siteIds: ["10000000", "10000001"],
      timeoutMs: 250,
    },
  );
});

test("coupon shadow allowlist rejects wildcard and malformed ids", () => {
  assert.deepEqual(
    normalizeMerchantCouponDualWriteSiteIds(
      "10000000,*,1000000,100000000,abcdefgh,10000001",
    ),
    ["10000000", "10000001"],
  );
});

test("coupon shadow writer does not call RPC while disabled", async () => {
  let called = false;
  const result = await mirrorMerchantCouponChanges(
    {
      rpc: async () => {
        called = true;
        return {};
      },
    },
    [{ current: buildCoupon() }],
    { config: { mode: "off", siteIds: ["10000000"], timeoutMs: 1000 } },
  );

  assert.equal(called, false);
  assert.deepEqual(result, { status: "disabled", count: 0 });
});

test("coupon shadow writer merges same-coupon changes and retains releases", async () => {
  const redeemed = buildCoupon({
    usedCount: 1,
    claimEvents: [
      {
        id: "claim-1",
        at: "2026-07-25T08:10:00.000Z",
        accountId: "",
        userId: "",
        email: "",
        code: "",
        customerName: "",
        settlementType: "qr",
        settlementCode: "QR-1",
        validUntil: null,
      },
    ],
    redeemEvents: [
      {
        id: "redeem-1",
        at: "2026-07-25T08:20:00.000Z",
        claimEventId: "claim-1",
        settlementCode: "QR-1",
        accountId: "",
        userId: "",
        operatorId: "operator",
        note: "",
      },
    ],
    updatedAt: "2026-07-25T08:20:00.000Z",
  });
  const released = buildCoupon({
    claimEvents: redeemed.claimEvents,
    redeemEvents: [],
    usedCount: 0,
    updatedAt: "2026-07-25T08:30:00.000Z",
  });
  const receivedCalls: Array<Record<string, unknown>> = [];

  const result = await mirrorMerchantCouponChanges(
    {
      rpc: async (_name, args) => {
        receivedCalls.push(args);
        return { data: 1 };
      },
    },
    [
      { current: redeemed, previous: buildCoupon() },
      { current: released, previous: redeemed },
      {
        current: buildCoupon({ siteId: "10000001", id: "other" }),
      },
    ],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 1000 },
    },
  );

  assert.deepEqual(result, { status: "written", count: 1 });
  const mutations = receivedCalls[0]?.p_mutations;
  assert.equal(Array.isArray(mutations), true);
  const mutation = (
    mutations as Array<{
      coupon: { used_count: number };
      redemptions: Array<{ id: string }>;
      released_redemption_ids: string[];
    }>
  )[0];
  assert.equal(mutation?.coupon.used_count, 0);
  assert.deepEqual(mutation?.released_redemption_ids, ["redeem-1"]);
  assert.equal(
    mutation?.redemptions.some((redemption) => redemption.id === "redeem-1"),
    true,
  );
});

test("coupon shadow writer reports RPC failures without throwing", async () => {
  const logged: unknown[] = [];
  const result = await mirrorMerchantCouponChanges(
    {
      rpc: async () => ({ error: { message: "rpc unavailable" } }),
    },
    [{ current: buildCoupon() }],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 1000 },
      logger: (event) => logged.push(event),
    },
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error, "rpc unavailable");
  assert.equal(logged.length, 1);
});

test("coupon shadow writer contains mapper failures after legacy save", async () => {
  let rpcCalled = false;
  const result = await mirrorMerchantCouponChanges(
    {
      rpc: async () => {
        rpcCalled = true;
        return {};
      },
    },
    [{ current: buildCoupon() }],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 1000 },
      logger: () => {},
      buildMutation: () => {
        throw new Error("invalid legacy coupon");
      },
    },
  );

  assert.equal(rpcCalled, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "invalid legacy coupon");
});

test("coupon shadow writer bounds a stalled RPC", async () => {
  const result = await mirrorMerchantCouponChanges(
    {
      rpc: () => new Promise(() => {}),
    },
    [{ current: buildCoupon() }],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 5 },
      logger: () => {},
    },
  );

  assert.equal(result.status, "timeout");
});
