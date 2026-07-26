import { createHash } from "node:crypto";

import type {
  MerchantCouponClaimEvent,
  MerchantCouponRecord,
  MerchantCouponRedeemEvent,
} from "@/lib/merchantCoupons";

export type MerchantCouponCustomerV1Payload = {
  merchant_id: string;
  account_id: string | null;
  auth_user_id: string | null;
  guest_hash: string | null;
  email: string | null;
  phone: string | null;
  display_name: string;
  profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MerchantCouponV1Payload = {
  merchant_id: string;
  id: string;
  code: string;
  title: string;
  status: MerchantCouponRecord["status"];
  discount_type: MerchantCouponRecord["discountType"];
  discount_value: number;
  minimum_amount: number;
  total_quantity: number;
  claimed_count: number;
  used_count: number;
  starts_at: string | null;
  expires_at: string | null;
  configuration: Record<string, unknown>;
  source_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MerchantCouponClaimV1Payload = {
  id: string;
  customer: MerchantCouponCustomerV1Payload | null;
  settlement_type: "qr" | "barcode";
  settlement_code_hash: string | null;
  claim_code_hash: string | null;
  status: "claimed" | "redeemed";
  customer_snapshot: Record<string, unknown>;
  source_snapshot: Record<string, unknown>;
  claimed_at: string;
  valid_until: string | null;
  source_updated_at: string;
};

export type MerchantCouponRedemptionV1Payload = {
  id: string;
  claim_id: string;
  settlement_code_hash: string | null;
  operator_id: string;
  note: string;
  source_snapshot: Record<string, unknown>;
  redeemed_at: string;
  source_updated_at: string;
};

export type MerchantCouponEventV1Payload = {
  event_id: string;
  event_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type MerchantCouponV1Mutation = {
  coupon: MerchantCouponV1Payload;
  claims: MerchantCouponClaimV1Payload[];
  redemptions: MerchantCouponRedemptionV1Payload[];
  released_redemption_ids: string[];
  events: MerchantCouponEventV1Payload[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lowerEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function validTimestamp(value: unknown, fallback: string) {
  const text = trimText(value);
  return text && Number.isFinite(Date.parse(text)) ? text : fallback;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashMerchantCouponSensitiveValue(
  kind: "claim-code" | "settlement-code",
  value: unknown,
) {
  const text =
    kind === "claim-code"
      ? trimText(value).replace(/\s+/g, "").toUpperCase()
      : trimText(value);
  return text ? createHash("sha256").update(`${kind}:${text}`).digest("hex") : "";
}

function sanitizeClaimEvent(event: MerchantCouponClaimEvent) {
  const { code, settlementCode, ...snapshot } = event;
  return {
    ...snapshot,
    claimCodeHash:
      hashMerchantCouponSensitiveValue("claim-code", code) || null,
    settlementCodeHash:
      hashMerchantCouponSensitiveValue("settlement-code", settlementCode) ||
      null,
  };
}

function sanitizeRedeemEvent(event: MerchantCouponRedeemEvent) {
  const { settlementCode, ...snapshot } = event;
  return {
    ...snapshot,
    settlementCodeHash:
      hashMerchantCouponSensitiveValue("settlement-code", settlementCode) ||
      null,
  };
}

export function sanitizeMerchantCouponV1SourceSnapshot(
  coupon: MerchantCouponRecord,
): Record<string, unknown> {
  const {
    claimAllowedCodes,
    claimEvents,
    redeemEvents,
    ...snapshot
  } = coupon;
  return {
    ...snapshot,
    claimAllowedCodeHashes: claimAllowedCodes.map((code) =>
      hashMerchantCouponSensitiveValue("claim-code", code),
    ),
    claimEvents: claimEvents.map(sanitizeClaimEvent),
    redeemEvents: redeemEvents.map(sanitizeRedeemEvent),
  };
}

function buildCouponConfiguration(sourceSnapshot: Record<string, unknown>) {
  const configuration = { ...sourceSnapshot };
  [
    "siteId",
    "id",
    "code",
    "title",
    "status",
    "discountType",
    "discountValue",
    "minimumAmount",
    "totalQuantity",
    "claimedCount",
    "usedCount",
    "startsAt",
    "expiresAt",
    "createdAt",
    "updatedAt",
    "claimEvents",
    "redeemEvents",
  ].forEach((key) => {
    delete configuration[key];
  });
  return configuration;
}

function buildClaimCustomer(
  coupon: MerchantCouponRecord,
  claim: MerchantCouponClaimEvent,
): MerchantCouponCustomerV1Payload | null {
  const accountId = trimText(claim.accountId);
  const authUserId = trimText(claim.userId);
  const email = lowerEmail(claim.email);
  if (!accountId && !authUserId && !email) return null;
  return {
    merchant_id: trimText(coupon.siteId),
    account_id: accountId || null,
    auth_user_id: authUserId || null,
    guest_hash: null,
    email: email || null,
    phone: null,
    display_name: trimText(claim.customerName),
    profile: {
      lastLegacyCouponId: trimText(coupon.id),
      lastLegacyCouponClaimId: trimText(claim.id),
    },
    created_at: validTimestamp(claim.at, coupon.createdAt),
    updated_at: validTimestamp(coupon.updatedAt, claim.at),
  };
}

function isClaimRedeemed(
  coupon: MerchantCouponRecord,
  claim: MerchantCouponClaimEvent,
) {
  return coupon.redeemEvents.some(
    (event) =>
      event.claimEventId === claim.id ||
      (trimText(event.settlementCode) &&
        event.settlementCode === claim.settlementCode),
  );
}

function buildClaimPayload(
  coupon: MerchantCouponRecord,
  claim: MerchantCouponClaimEvent,
): MerchantCouponClaimV1Payload {
  return {
    id: trimText(claim.id),
    customer: buildClaimCustomer(coupon, claim),
    settlement_type: claim.settlementType === "barcode" ? "barcode" : "qr",
    settlement_code_hash:
      hashMerchantCouponSensitiveValue(
        "settlement-code",
        claim.settlementCode,
      ) || null,
    claim_code_hash:
      hashMerchantCouponSensitiveValue("claim-code", claim.code) || null,
    status: isClaimRedeemed(coupon, claim) ? "redeemed" : "claimed",
    customer_snapshot: {
      accountId: trimText(claim.accountId),
      userId: trimText(claim.userId),
      email: lowerEmail(claim.email),
      name: trimText(claim.customerName),
    },
    source_snapshot: sanitizeClaimEvent(claim),
    claimed_at: validTimestamp(claim.at, coupon.createdAt),
    valid_until: trimText(claim.validUntil) || null,
    source_updated_at: validTimestamp(coupon.updatedAt, claim.at),
  };
}

function buildRedemptionPayload(
  coupon: MerchantCouponRecord,
  redemption: MerchantCouponRedeemEvent,
): MerchantCouponRedemptionV1Payload {
  return {
    id: trimText(redemption.id),
    claim_id: trimText(redemption.claimEventId),
    settlement_code_hash:
      hashMerchantCouponSensitiveValue(
        "settlement-code",
        redemption.settlementCode,
      ) || null,
    operator_id: trimText(redemption.operatorId),
    note: trimText(redemption.note),
    source_snapshot: sanitizeRedeemEvent(redemption),
    redeemed_at: validTimestamp(redemption.at, coupon.updatedAt),
    source_updated_at: validTimestamp(coupon.updatedAt, redemption.at),
  };
}

function buildCouponEvents(
  coupon: MerchantCouponRecord,
  sourceSnapshot: Record<string, unknown>,
  releasedRedemptionIds: string[],
) {
  const events: MerchantCouponEventV1Payload[] = [];
  coupon.claimEvents.forEach((claim) => {
    events.push({
      event_id: `claim-${claim.id}`,
      event_type: "coupon_claimed",
      idempotency_key: `legacy-coupon-claim:${coupon.siteId}:${coupon.id}:${claim.id}`,
      payload: sanitizeClaimEvent(claim),
      created_at: validTimestamp(claim.at, coupon.createdAt),
    });
  });
  coupon.redeemEvents.forEach((redemption) => {
    events.push({
      event_id: `redeem-${redemption.id}`,
      event_type: "coupon_redeemed",
      idempotency_key: `legacy-coupon-redeem:${coupon.siteId}:${coupon.id}:${redemption.id}`,
      payload: sanitizeRedeemEvent(redemption),
      created_at: validTimestamp(redemption.at, coupon.updatedAt),
    });
  });
  releasedRedemptionIds.forEach((redemptionId) => {
    events.push({
      event_id: `release-${redemptionId}-${coupon.updatedAt}`,
      event_type: "coupon_redemption_released",
      idempotency_key: `legacy-coupon-release:${coupon.siteId}:${coupon.id}:${redemptionId}:${coupon.updatedAt}`,
      payload: {
        redemptionId,
        legacyUpdatedAt: coupon.updatedAt,
      },
      created_at: validTimestamp(coupon.updatedAt, coupon.createdAt),
    });
  });
  const fingerprint = hashJson(sourceSnapshot).slice(0, 24);
  events.push({
    event_id: `snapshot-${fingerprint}`,
    event_type: "legacy_snapshot_synced",
    idempotency_key: `legacy-coupon-snapshot:${coupon.siteId}:${coupon.id}:${fingerprint}`,
    payload: {
      fingerprint,
      legacyUpdatedAt: coupon.updatedAt,
    },
    created_at: validTimestamp(coupon.updatedAt, coupon.createdAt),
  });
  return events;
}

export function buildMerchantCouponV1Mutation(
  coupon: MerchantCouponRecord,
  previousCoupon?: MerchantCouponRecord | null,
): MerchantCouponV1Mutation {
  const sourceSnapshot = sanitizeMerchantCouponV1SourceSnapshot(coupon);
  const currentRedemptionIds = new Set(
    coupon.redeemEvents.map((event) => trimText(event.id)).filter(Boolean),
  );
  const releasedRedemptionIds = (previousCoupon?.redeemEvents ?? [])
    .map((event) => trimText(event.id))
    .filter((id) => id && !currentRedemptionIds.has(id));

  return {
    coupon: {
      merchant_id: trimText(coupon.siteId),
      id: trimText(coupon.id),
      code: trimText(coupon.code),
      title: trimText(coupon.title),
      status: coupon.status,
      discount_type: coupon.discountType,
      discount_value: coupon.discountValue,
      minimum_amount: coupon.minimumAmount,
      total_quantity: coupon.totalQuantity,
      claimed_count: coupon.claimedCount,
      used_count: coupon.usedCount,
      starts_at: trimText(coupon.startsAt) || null,
      expires_at: trimText(coupon.expiresAt) || null,
      configuration: buildCouponConfiguration(sourceSnapshot),
      source_snapshot: sourceSnapshot,
      created_at: validTimestamp(coupon.createdAt, new Date(0).toISOString()),
      updated_at: validTimestamp(coupon.updatedAt, coupon.createdAt),
    },
    claims: coupon.claimEvents.map((claim) =>
      buildClaimPayload(coupon, claim),
    ),
    redemptions: coupon.redeemEvents.map((redemption) =>
      buildRedemptionPayload(coupon, redemption),
    ),
    released_redemption_ids: [...new Set(releasedRedemptionIds)],
    events: buildCouponEvents(
      coupon,
      sourceSnapshot,
      [...new Set(releasedRedemptionIds)],
    ),
  };
}
