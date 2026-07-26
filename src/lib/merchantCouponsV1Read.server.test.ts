import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMerchantCouponRecord,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { buildMerchantCouponV1Mutation } from "@/lib/merchantCouponsV1";
import {
  isMerchantCouponV1ReadEnabled,
  loadMerchantCouponsV1VerificationData,
  readMerchantCouponsWithV1Verification,
  resolveMerchantCouponV1ReadConfig,
  validateMerchantCouponV1VerificationData,
  type MerchantCouponV1ReadClient,
  type MerchantCouponV1ReadEvent,
  type MerchantCouponV1VerificationData,
} from "@/lib/merchantCouponsV1Read.server";

function buildCoupon(): MerchantCouponRecord {
  const coupon = normalizeMerchantCouponRecord({
    id: "coupon-1",
    siteId: "10000000",
    title: "Welcome",
    code: "WELCOME",
    discountType: "amount_off",
    discountValue: 10,
    minimumAmount: 30,
    totalQuantity: 100,
    claimedCount: 1,
    usedCount: 1,
    status: "active",
    claimEvents: [
      {
        id: "claim-1",
        at: "2026-07-25T08:00:00.000Z",
        accountId: "10000000000001",
        userId: "user-1",
        email: "customer@example.com",
        code: "SECRET-CLAIM-CODE",
        customerName: "Customer",
        settlementType: "qr",
        settlementCode: "SECRET-SETTLEMENT-CODE",
        validUntil: null,
      },
    ],
    redeemEvents: [
      {
        id: "redeem-1",
        at: "2026-07-25T09:00:00.000Z",
        claimEventId: "claim-1",
        settlementCode: "SECRET-SETTLEMENT-CODE",
        accountId: "10000000000001",
        userId: "user-1",
        operatorId: "operator",
        note: "desk",
      },
    ],
    createdAt: "2026-07-25T07:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
  });
  assert.ok(coupon);
  return coupon;
}

function buildMatchingData(
  coupon: MerchantCouponRecord,
): MerchantCouponV1VerificationData {
  const mutation = buildMerchantCouponV1Mutation(coupon);
  return {
    coupons: [{ ...mutation.coupon }],
    claims: mutation.claims.map((claim) => ({
      merchant_id: coupon.siteId,
      id: claim.id,
      coupon_id: coupon.id,
      customer_id: claim.customer ? "customer-uuid" : null,
      settlement_type: claim.settlement_type,
      settlement_code_hash: claim.settlement_code_hash,
      claim_code_hash: claim.claim_code_hash,
      status: claim.status,
      customer_snapshot: claim.customer_snapshot,
      source_snapshot: claim.source_snapshot,
      claimed_at: claim.claimed_at,
      valid_until: claim.valid_until,
      source_updated_at: claim.source_updated_at,
    })),
    redemptions: mutation.redemptions.map((redemption) => ({
      merchant_id: coupon.siteId,
      id: redemption.id,
      coupon_id: coupon.id,
      claim_id: redemption.claim_id,
      customer_id: "customer-uuid",
      state: "active",
      settlement_code_hash: redemption.settlement_code_hash,
      operator_id: redemption.operator_id,
      note: redemption.note,
      source_snapshot: redemption.source_snapshot,
      redeemed_at: redemption.redeemed_at,
      source_updated_at: redemption.source_updated_at,
    })),
    events: mutation.events.map((event) => ({
      merchant_id: coupon.siteId,
      coupon_id: coupon.id,
      idempotency_key: event.idempotency_key,
    })),
  };
}

function createReadClient(
  tables: Record<string, Array<Record<string, unknown>>>,
): MerchantCouponV1ReadClient {
  return {
    from: (table) => {
      let merchantId = "";
      let rangeStart = 0;
      let rangeEnd = Number.MAX_SAFE_INTEGER;
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          if (column === "merchant_id") merchantId = String(value);
          return query;
        },
        order: () => query,
        range: (from: number, to: number) => {
          rangeStart = from;
          rangeEnd = to;
          return query;
        },
        then: (
          onfulfilled?: ((
            value: { data: Array<Record<string, unknown>>; error: null },
          ) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null,
        ) => {
          const rows = (tables[table] ?? [])
            .filter((row) => String(row.merchant_id ?? "") === merchantId)
            .slice(rangeStart, rangeEnd + 1);
          return Promise.resolve({ data: rows, error: null }).then(
            onfulfilled ?? undefined,
            onrejected ?? undefined,
          );
        },
      };
      return query as unknown as ReturnType<
        MerchantCouponV1ReadClient["from"]
      >;
    },
  };
}

test("coupon read verification is default-off and exact-merchant only", () => {
  const config = resolveMerchantCouponV1ReadConfig({
    MERCHANT_COUPON_V1_READ_MODE: "verify",
    MERCHANT_COUPON_V1_READ_SITE_IDS:
      "10000000,*,bad,20000000,10000000",
    MERCHANT_COUPON_V1_READ_TIMEOUT_MS: "20",
  });
  assert.deepEqual(config, {
    mode: "verify",
    siteIds: ["10000000", "20000000"],
    timeoutMs: 250,
  });
  assert.equal(isMerchantCouponV1ReadEnabled("10000000", config), true);
  assert.equal(isMerchantCouponV1ReadEnabled("30000000", config), false);
  assert.equal(
    resolveMerchantCouponV1ReadConfig({
      MERCHANT_COUPON_V1_READ_MODE: "primary",
      MERCHANT_COUPON_V1_READ_SITE_IDS: "10000000",
    }).mode,
    "off",
  );
});

test("disabled coupon verification never invokes the V1 loader", async () => {
  const legacy = { coupons: [buildCoupon()], updatedAt: null };
  let calls = 0;
  const result = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: async () => {
      calls += 1;
      return buildMatchingData(legacy.coupons[0]);
    },
    config: {
      mode: "off",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
  });
  assert.equal(result, legacy);
  assert.equal(calls, 0);
});

test("coupon verification records parity and returns the exact legacy snapshot", async () => {
  const coupon = buildCoupon();
  const legacy = {
    coupons: [coupon],
    updatedAt: "2026-07-25T09:00:00.000Z",
  };
  const events: MerchantCouponV1ReadEvent[] = [];
  const result = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: async () => buildMatchingData(coupon),
    config: {
      mode: "verify",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });
  assert.equal(result, legacy);
  assert.equal(events[0]?.outcome, "match");
  assert.equal(events[0]?.reason, "parity");
  assert.equal(events[0]?.matchedCouponCount, 1);
  assert.match(events[0]?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isInteger(events[0]?.durationMs), true);
});

test("coupon verification reports aggregate drift without logging secrets", async () => {
  const coupon = buildCoupon();
  const legacy = { coupons: [coupon], updatedAt: null };
  const data = buildMatchingData(coupon);
  data.coupons[0] = {
    ...data.coupons[0],
    used_count: 0,
    source_snapshot: {
      ...(data.coupons[0]?.source_snapshot as Record<string, unknown>),
      rawSecret: "SECRET-CLAIM-CODE",
    },
  };
  data.events = data.events.slice(1);
  const events: MerchantCouponV1ReadEvent[] = [];
  const result = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: async () => data,
    config: {
      mode: "verify",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });
  assert.equal(result, legacy);
  assert.equal(events[0]?.outcome, "fallback");
  assert.equal(events[0]?.reason, "v1_mismatch");
  assert.equal(events[0]?.missingEventCount, 1);
  assert.equal(events[0]?.mismatchCount, 1);
  assert.deepEqual(events[0]?.couponIds, ["coupon-1"]);
  assert.equal(JSON.stringify(events[0]).includes("SECRET"), false);
  assert.equal(JSON.stringify(events[0]).includes("customer@example.com"), false);
});

test("coupon timeout, failure, and missing data keep the legacy snapshot", async () => {
  const legacy = { coupons: [buildCoupon()], updatedAt: null };
  const events: MerchantCouponV1ReadEvent[] = [];
  const config = {
    mode: "verify" as const,
    siteIds: ["10000000"],
    timeoutMs: 1,
  };
  const timeout = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: () =>
      new Promise<MerchantCouponV1VerificationData | null>(() => undefined),
    config,
    logger: (event) => events.push(event),
  });
  const failed = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: async () => {
      throw new Error("database unavailable");
    },
    config,
    logger: (event) => events.push(event),
  });
  const missing = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: async () => null,
    config,
    logger: (event) => events.push(event),
  });
  assert.equal(timeout, legacy);
  assert.equal(failed, legacy);
  assert.equal(missing, legacy);
  assert.deepEqual(
    events.map((event) => event.reason),
    ["v1_timeout", "v1_query_failed", "v1_missing"],
  );
});

test("coupon V1 validation rejects cross-merchant and incomplete identities", () => {
  const data = buildMatchingData(buildCoupon());
  validateMerchantCouponV1VerificationData("10000000", data);
  assert.throws(
    () =>
      validateMerchantCouponV1VerificationData("10000000", {
        ...data,
        coupons: [{ ...data.coupons[0], merchant_id: "20000000" }],
      }),
    /merchant_coupons_v1_identity_failed/,
  );
  assert.throws(
    () =>
      validateMerchantCouponV1VerificationData("10000000", {
        ...data,
        claims: [{ ...data.claims[0], coupon_id: "" }],
      }),
    /merchant_coupons_v1_identity_failed/,
  );
});

test("coupon V1 loader reads all four scoped tables", async () => {
  const data = buildMatchingData(buildCoupon());
  const client = createReadClient({
    merchant_coupons: data.coupons as Array<Record<string, unknown>>,
    merchant_coupon_claims: data.claims as Array<Record<string, unknown>>,
    merchant_coupon_redemptions:
      data.redemptions as Array<Record<string, unknown>>,
    merchant_coupon_events: data.events as Array<Record<string, unknown>>,
  });
  const loaded = await loadMerchantCouponsV1VerificationData(
    client,
    "10000000",
  );
  assert.equal(loaded.coupons.length, 1);
  assert.equal(loaded.claims.length, 1);
  assert.equal(loaded.redemptions.length, 1);
  assert.equal(loaded.events.length, data.events.length);
});

test("coupon verification logging failures never affect legacy reads", async () => {
  const coupon = buildCoupon();
  const legacy = { coupons: [coupon], updatedAt: null };
  const result = await readMerchantCouponsWithV1Verification({
    siteId: "10000000",
    legacy,
    loadV1: async () => buildMatchingData(coupon),
    config: {
      mode: "verify",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: () => {
      throw new Error("logger failed");
    },
  });
  assert.equal(result, legacy);
});
