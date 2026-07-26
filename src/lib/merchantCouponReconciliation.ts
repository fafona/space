import { isDeepStrictEqual } from "node:util";

import type { MerchantCouponRecord } from "@/lib/merchantCoupons";
import {
  buildMerchantCouponV1Mutation,
  sanitizeMerchantCouponV1SourceSnapshot,
  type MerchantCouponClaimV1Payload,
  type MerchantCouponRedemptionV1Payload,
} from "@/lib/merchantCouponsV1";

export type MerchantCouponV1Row = {
  merchant_id?: unknown;
  id?: unknown;
  code?: unknown;
  title?: unknown;
  status?: unknown;
  discount_type?: unknown;
  discount_value?: unknown;
  minimum_amount?: unknown;
  total_quantity?: unknown;
  claimed_count?: unknown;
  used_count?: unknown;
  starts_at?: unknown;
  expires_at?: unknown;
  configuration?: unknown;
  source_snapshot?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export type MerchantCouponClaimV1Row = {
  merchant_id?: unknown;
  id?: unknown;
  coupon_id?: unknown;
  customer_id?: unknown;
  settlement_type?: unknown;
  settlement_code_hash?: unknown;
  claim_code_hash?: unknown;
  status?: unknown;
  customer_snapshot?: unknown;
  source_snapshot?: unknown;
  claimed_at?: unknown;
  valid_until?: unknown;
  source_updated_at?: unknown;
};

export type MerchantCouponRedemptionV1Row = {
  merchant_id?: unknown;
  id?: unknown;
  coupon_id?: unknown;
  claim_id?: unknown;
  customer_id?: unknown;
  state?: unknown;
  settlement_code_hash?: unknown;
  operator_id?: unknown;
  note?: unknown;
  source_snapshot?: unknown;
  redeemed_at?: unknown;
  source_updated_at?: unknown;
};

export type MerchantCouponEventV1Row = {
  merchant_id?: unknown;
  coupon_id?: unknown;
  idempotency_key?: unknown;
};

export type MerchantCouponReconciliationMismatch = {
  entity: "coupon" | "claim" | "redemption";
  couponId: string;
  recordId: string;
  fields: string[];
};

export type MerchantCouponReconciliationReport = {
  merchantId: string;
  legacyCouponCount: number;
  v1CouponCount: number;
  matchedCouponCount: number;
  missingCoupons: string[];
  unexpectedCoupons: string[];
  duplicateCouponIds: string[];
  missingClaims: string[];
  duplicateClaimIds: string[];
  missingRedemptions: string[];
  duplicateRedemptionIds: string[];
  unexpectedActiveRedemptions: string[];
  missingEventKeys: string[];
  mismatches: MerchantCouponReconciliationMismatch[];
  isMatch: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value: unknown) {
  const text = trimText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampsMatch(left: unknown, right: unknown) {
  const leftTimestamp = normalizeTimestamp(left);
  const rightTimestamp = normalizeTimestamp(right);
  if (leftTimestamp === null || rightTimestamp === null) {
    return leftTimestamp === rightTimestamp;
  }
  return Math.abs(leftTimestamp - rightTimestamp) < 1000;
}

function numbersMatch(left: unknown, right: unknown) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    Math.abs(leftNumber - rightNumber) < 0.0001;
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeLegacyCoupons(
  merchantId: string,
  coupons: MerchantCouponRecord[],
) {
  const map = new Map<string, MerchantCouponRecord>();
  for (const coupon of Array.isArray(coupons) ? coupons : []) {
    if (trimText(coupon?.siteId) !== merchantId) continue;
    const couponId = trimText(coupon?.id);
    if (!couponId) continue;
    const current = map.get(couponId);
    if (
      !current ||
      (normalizeTimestamp(coupon.updatedAt) ?? 0) >=
        (normalizeTimestamp(current.updatedAt) ?? 0)
    ) {
      map.set(couponId, coupon);
    }
  }
  return map;
}

function normalizeRows<T extends { merchant_id?: unknown; id?: unknown }>(
  merchantId: string,
  rows: T[],
  readCouponId: (row: T) => string,
) {
  const map = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trimText(row?.merchant_id) !== merchantId) continue;
    const id = trimText(row?.id);
    const couponId = readCouponId(row);
    if (!id || !couponId) continue;
    const key = `${couponId}:${id}`;
    if (map.has(key)) duplicates.add(key);
    map.set(key, row);
  }
  return { map, duplicates: [...duplicates].sort() };
}

function normalizeCouponRows(
  merchantId: string,
  rows: MerchantCouponV1Row[],
) {
  const map = new Map<string, MerchantCouponV1Row>();
  const duplicates = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trimText(row?.merchant_id) !== merchantId) continue;
    const couponId = trimText(row?.id);
    if (!couponId) continue;
    if (map.has(couponId)) duplicates.add(couponId);
    map.set(couponId, row);
  }
  return { map, duplicates: [...duplicates].sort() };
}

function compareCoupon(
  legacy: MerchantCouponRecord,
  row: MerchantCouponV1Row,
) {
  const fields: string[] = [];
  const mutation = buildMerchantCouponV1Mutation(legacy);
  const expected = mutation.coupon;
  if (trimText(row.code) !== expected.code) fields.push("code");
  if (trimText(row.title) !== expected.title) fields.push("title");
  if (trimText(row.status) !== expected.status) fields.push("status");
  if (trimText(row.discount_type) !== expected.discount_type) {
    fields.push("discountType");
  }
  if (!numbersMatch(row.discount_value, expected.discount_value)) {
    fields.push("discountValue");
  }
  if (!numbersMatch(row.minimum_amount, expected.minimum_amount)) {
    fields.push("minimumAmount");
  }
  if (!numbersMatch(row.total_quantity, expected.total_quantity)) {
    fields.push("totalQuantity");
  }
  if (!numbersMatch(row.claimed_count, expected.claimed_count)) {
    fields.push("claimedCount");
  }
  if (!numbersMatch(row.used_count, expected.used_count)) {
    fields.push("usedCount");
  }
  if (!timestampsMatch(row.starts_at, expected.starts_at)) {
    fields.push("startsAt");
  }
  if (!timestampsMatch(row.expires_at, expected.expires_at)) {
    fields.push("expiresAt");
  }
  if (!timestampsMatch(row.created_at, expected.created_at)) {
    fields.push("createdAt");
  }
  if (!timestampsMatch(row.updated_at, expected.updated_at)) {
    fields.push("updatedAt");
  }
  if (
    !isDeepStrictEqual(
      normalizeJson(row.configuration),
      normalizeJson(expected.configuration),
    )
  ) {
    fields.push("configuration");
  }
  if (
    !isDeepStrictEqual(
      normalizeJson(row.source_snapshot),
      normalizeJson(sanitizeMerchantCouponV1SourceSnapshot(legacy)),
    )
  ) {
    fields.push("sourceSnapshot");
  }
  return fields;
}

function compareClaim(
  expected: MerchantCouponClaimV1Payload,
  row: MerchantCouponClaimV1Row,
) {
  const fields: string[] = [];
  if (trimText(row.settlement_type) !== expected.settlement_type) {
    fields.push("settlementType");
  }
  if (trimText(row.settlement_code_hash) !== trimText(expected.settlement_code_hash)) {
    fields.push("settlementCodeHash");
  }
  if (trimText(row.claim_code_hash) !== trimText(expected.claim_code_hash)) {
    fields.push("claimCodeHash");
  }
  if (trimText(row.status) !== expected.status) fields.push("status");
  if (!timestampsMatch(row.claimed_at, expected.claimed_at)) {
    fields.push("claimedAt");
  }
  if (!timestampsMatch(row.valid_until, expected.valid_until)) {
    fields.push("validUntil");
  }
  if (!timestampsMatch(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  if (
    !isDeepStrictEqual(
      normalizeJson(row.customer_snapshot),
      normalizeJson(expected.customer_snapshot),
    )
  ) {
    fields.push("customerSnapshot");
  }
  if (
    !isDeepStrictEqual(
      normalizeJson(row.source_snapshot),
      normalizeJson(expected.source_snapshot),
    )
  ) {
    fields.push("sourceSnapshot");
  }
  if (expected.customer && !trimText(row.customer_id)) {
    fields.push("customerLink");
  }
  return fields;
}

function compareRedemption(
  expected: MerchantCouponRedemptionV1Payload,
  row: MerchantCouponRedemptionV1Row,
) {
  const fields: string[] = [];
  if (trimText(row.claim_id) !== expected.claim_id) fields.push("claimId");
  if (trimText(row.state) !== "active") fields.push("state");
  if (trimText(row.settlement_code_hash) !== trimText(expected.settlement_code_hash)) {
    fields.push("settlementCodeHash");
  }
  if (trimText(row.operator_id) !== expected.operator_id) fields.push("operatorId");
  if (trimText(row.note) !== expected.note) fields.push("note");
  if (!timestampsMatch(row.redeemed_at, expected.redeemed_at)) {
    fields.push("redeemedAt");
  }
  if (!timestampsMatch(row.source_updated_at, expected.source_updated_at)) {
    fields.push("sourceUpdatedAt");
  }
  if (
    !isDeepStrictEqual(
      normalizeJson(row.source_snapshot),
      normalizeJson(expected.source_snapshot),
    )
  ) {
    fields.push("sourceSnapshot");
  }
  return fields;
}

export function reconcileMerchantCouponStorage(input: {
  merchantId: string;
  legacyCoupons: MerchantCouponRecord[];
  v1Coupons: MerchantCouponV1Row[];
  v1Claims: MerchantCouponClaimV1Row[];
  v1Redemptions: MerchantCouponRedemptionV1Row[];
  v1Events: MerchantCouponEventV1Row[];
}): MerchantCouponReconciliationReport {
  const merchantId = trimText(input.merchantId);
  const legacyMap = normalizeLegacyCoupons(merchantId, input.legacyCoupons);
  const couponRows = normalizeCouponRows(merchantId, input.v1Coupons);
  const claimRows = normalizeRows(
    merchantId,
    input.v1Claims,
    (row) => trimText(row.coupon_id),
  );
  const redemptionRows = normalizeRows(
    merchantId,
    input.v1Redemptions,
    (row) => trimText(row.coupon_id),
  );
  const v1CouponIds = new Set(couponRows.map.keys());
  const missingCoupons = [...legacyMap.keys()]
    .filter((couponId) => !v1CouponIds.has(couponId))
    .sort();
  const unexpectedCoupons = [...v1CouponIds]
    .filter((couponId) => !legacyMap.has(couponId))
    .sort();
  const eventKeys = new Set(
    input.v1Events
      .filter((row) => trimText(row.merchant_id) === merchantId)
      .map((row) => `${trimText(row.coupon_id)}:${trimText(row.idempotency_key)}`)
      .filter((key) => !key.endsWith(":")),
  );
  const expectedActiveRedemptions = new Set<string>();
  const missingClaims: string[] = [];
  const missingRedemptions: string[] = [];
  const missingEventKeys: string[] = [];
  const mismatches: MerchantCouponReconciliationMismatch[] = [];
  let matchedCouponCount = 0;

  for (const [couponId, legacy] of legacyMap.entries()) {
    const couponRow = couponRows.map.get(couponId);
    if (!couponRow) continue;
    const couponFields = compareCoupon(legacy, couponRow);
    if (couponFields.length > 0) {
      mismatches.push({
        entity: "coupon",
        couponId,
        recordId: couponId,
        fields: couponFields,
      });
    } else {
      matchedCouponCount += 1;
    }

    const mutation = buildMerchantCouponV1Mutation(legacy);
    for (const claim of mutation.claims) {
      const key = `${couponId}:${claim.id}`;
      const row = claimRows.map.get(key);
      if (!row) {
        missingClaims.push(key);
        continue;
      }
      const fields = compareClaim(claim, row);
      if (fields.length > 0) {
        mismatches.push({
          entity: "claim",
          couponId,
          recordId: claim.id,
          fields,
        });
      }
    }
    for (const redemption of mutation.redemptions) {
      const key = `${couponId}:${redemption.id}`;
      expectedActiveRedemptions.add(key);
      const row = redemptionRows.map.get(key);
      if (!row) {
        missingRedemptions.push(key);
        continue;
      }
      const fields = compareRedemption(redemption, row);
      if (fields.length > 0) {
        mismatches.push({
          entity: "redemption",
          couponId,
          recordId: redemption.id,
          fields,
        });
      }
    }
    for (const event of mutation.events) {
      const key = `${couponId}:${event.idempotency_key}`;
      if (!eventKeys.has(key)) missingEventKeys.push(event.idempotency_key);
    }
  }

  const unexpectedActiveRedemptions = [...redemptionRows.map.entries()]
    .filter(
      ([key, row]) =>
        trimText(row.state) === "active" &&
        legacyMap.has(trimText(row.coupon_id)) &&
        !expectedActiveRedemptions.has(key),
    )
    .map(([key]) => key)
    .sort();

  mismatches.sort((left, right) => {
    const couponComparison = left.couponId.localeCompare(right.couponId);
    if (couponComparison !== 0) return couponComparison;
    return left.recordId.localeCompare(right.recordId);
  });
  return {
    merchantId,
    legacyCouponCount: legacyMap.size,
    v1CouponCount: v1CouponIds.size,
    matchedCouponCount,
    missingCoupons,
    unexpectedCoupons,
    duplicateCouponIds: couponRows.duplicates,
    missingClaims: missingClaims.sort(),
    duplicateClaimIds: claimRows.duplicates,
    missingRedemptions: missingRedemptions.sort(),
    duplicateRedemptionIds: redemptionRows.duplicates,
    unexpectedActiveRedemptions,
    missingEventKeys: missingEventKeys.sort(),
    mismatches,
    isMatch:
      missingCoupons.length === 0 &&
      unexpectedCoupons.length === 0 &&
      couponRows.duplicates.length === 0 &&
      missingClaims.length === 0 &&
      claimRows.duplicates.length === 0 &&
      missingRedemptions.length === 0 &&
      redemptionRows.duplicates.length === 0 &&
      unexpectedActiveRedemptions.length === 0 &&
      missingEventKeys.length === 0 &&
      mismatches.length === 0,
  };
}
