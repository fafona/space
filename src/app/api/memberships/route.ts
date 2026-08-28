import { NextResponse } from "next/server";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  reauthorizeMerchantBusinessMutation,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getMerchantCouponDiscountLabel,
  getMerchantCouponDisplayTitle,
  type MerchantCouponClaimEvent,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { listMerchantCoupons } from "@/lib/merchantCoupons.server";
import {
  getMerchantMembershipPatchRequiredPermission,
  matchesMerchantMembershipBusinessId,
  redactMerchantMembershipForCashier,
  redactMerchantMembershipListItem,
} from "@/lib/merchantMembershipBusinessPermissions";
import {
  toPersonalMembershipCard,
  type MerchantMemberCouponHistoryItem,
  type MerchantMembershipInsight,
  type MerchantMembershipListItem,
} from "@/lib/merchantMemberships";
import {
  applyMerchantMembershipAccountOperation,
  applyMerchantMembershipPointDeduction,
  applyMerchantMembershipRedemptionCart,
  adjustMerchantMembershipRecharge,
  awardMerchantMembershipRulePoints,
  cancelMerchantMembershipRecharge,
  getMerchantMembershipRechargeCancellationQuote,
  getMerchantMembershipsSnapshot,
  joinMerchantMembership,
  leaveMerchantMembership,
  quoteMerchantMembershipPointDeduction,
  updateMerchantMembershipAllergens,
} from "@/lib/merchantMemberships.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import {
  resolvePersonalAccountSessionFromFrontendAuthProofPayload,
  resolvePersonalAccountSessionFromRequest,
} from "@/lib/personalAccountSession.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function applyPrivateResponseHeaders(response: Response) {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function privateJson(body: unknown, init?: ResponseInit) {
  return applyPrivateResponseHeaders(NextResponse.json(body, init));
}

type MerchantMembershipAdminSession = {
  actor: MerchantBusinessActor;
  operatorId: string;
  assertAuthorizationCurrent: () => Promise<void>;
};

function redactMembershipMutationResult(
  membership: MerchantMembershipListItem,
  session: MerchantMembershipAdminSession,
  permission: MerchantStaffBusinessPermission,
) {
  if (permission.startsWith("redemptions.")) {
    return redactMerchantMembershipForCashier(
      membership,
      session.actor.type === "owner" ||
        session.actor.businessPermissions.includes("redemptions.customer_data.view"),
    );
  }
  return redactMerchantMembershipListItem(membership, {
    customerData:
      session.actor.type === "owner" ||
      session.actor.businessPermissions.includes("members.customer_data.view"),
    account:
      session.actor.type === "owner" ||
      session.actor.businessPermissions.includes("members.account.view"),
    insights: false,
  });
}

async function resolveMembershipAdminSession(
  request: Request,
  siteId: string,
  requiredPermission: MerchantStaffBusinessPermission,
): Promise<MerchantMembershipAdminSession> {
  const actor = await authorizeMerchantBusinessRequest(request, {
    siteId,
    requiredPermission,
  });
  return {
    actor,
    operatorId: actor.principalKey,
    assertAuthorizationCurrent: async () => {
      await reauthorizeMerchantBusinessMutation(request, {
        actor,
        requiredPermissions: [requiredPermission],
      });
    },
  };
}

function membershipAccessErrorResponse(error: unknown, fallbackError: string, status = 500) {
  if (error instanceof MerchantBusinessAccessError) {
    return privateJson({ error: error.code }, { status: error.status });
  }
  return privateJson(
    {
      error: fallbackError,
      message: error instanceof Error ? error.message : "unknown_error",
    },
    { status },
  );
}

function normalizeEmail(value: unknown) {
  return trimText(value, 320).toLowerCase();
}

function buildMemberIdentityKeys(input: { accountId?: unknown; userId?: unknown; email?: unknown }) {
  const keys: string[] = [];
  const accountId = trimText(input.accountId, 128);
  const userId = trimText(input.userId, 128);
  const email = normalizeEmail(input.email);
  if (accountId) keys.push(`account:${accountId}`);
  if (userId) keys.push(`user:${userId}`);
  if (email) keys.push(`email:${email}`);
  return keys;
}

function appendIdentityMappedItem<T>(
  map: Map<string, T[]>,
  keys: string[],
  item: T,
) {
  const uniqueKeys = [...new Set(keys)];
  uniqueKeys.forEach((key) => {
    const current = map.get(key);
    if (current) {
      current.push(item);
      return;
    }
    map.set(key, [item]);
  });
}

function readIdentityMappedItems<T>(
  map: Map<string, T[]>,
  membership: Pick<MerchantMembershipListItem, "accountId" | "userId" | "email">,
  getItemKey: (item: T) => string,
) {
  const items: T[] = [];
  const seen = new Set<string>();
  buildMemberIdentityKeys(membership).forEach((key) => {
    (map.get(key) ?? []).forEach((item) => {
      const itemKey = getItemKey(item);
      if (seen.has(itemKey)) return;
      seen.add(itemKey);
      items.push(item);
    });
  });
  return items;
}

function getOrderActivityAt(order: MerchantOrderRecord) {
  return trimText(order.completedAt) || trimText(order.confirmedAt) || trimText(order.createdAt);
}

function isTimestampInCurrentYear(value: string, now: Date) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return new Date(timestamp).getFullYear() === now.getFullYear();
}

function getCouponRedeemAt(coupon: MerchantCouponRecord, claimEvent: MerchantCouponClaimEvent) {
  return (
    coupon.redeemEvents.find(
      (event) =>
        (claimEvent.id && event.claimEventId === claimEvent.id) ||
        (claimEvent.settlementCode && event.settlementCode === claimEvent.settlementCode),
    )?.at ?? null
  );
}

function getClaimStatus(coupon: MerchantCouponRecord, claimEvent: MerchantCouponClaimEvent, nowMs: number): MerchantMemberCouponHistoryItem["status"] {
  if (getCouponRedeemAt(coupon, claimEvent)) return "used";
  if (coupon.status !== "active") return "inactive";
  if (coupon.startsAt && Date.parse(coupon.startsAt) > nowMs) return "inactive";
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < nowMs) return "expired";
  if (claimEvent.validUntil && Date.parse(claimEvent.validUntil) < nowMs) return "expired";
  return "available";
}

function buildMemberOrdersByIdentity(orders: MerchantOrderRecord[]) {
  const map = new Map<string, MerchantOrderRecord[]>();
  orders
    .filter((order) => order.status !== "cancelled")
    .forEach((order) => {
      appendIdentityMappedItem(
        map,
        buildMemberIdentityKeys({
          accountId: order.customerAccountId,
          userId: order.customerUserId,
          email: order.customerLoginEmail || order.customer.email,
        }),
        order,
      );
    });
  return map;
}

function buildCouponHistoryByIdentity(coupons: MerchantCouponRecord[], nowMs: number) {
  const map = new Map<string, MerchantMemberCouponHistoryItem[]>();
  coupons.forEach((coupon) => {
    coupon.claimEvents.forEach((claimEvent) => {
      const redeemedAt = getCouponRedeemAt(coupon, claimEvent);
      const item = {
        id: claimEvent.id,
        couponId: coupon.id,
        couponCode: coupon.code,
        title: getMerchantCouponDisplayTitle(coupon),
        discountLabel: getMerchantCouponDiscountLabel(coupon),
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        pointsVoucherMaxPerRedemption: coupon.pointsVoucherMaxPerRedemption,
        pointsVoucherMinimumRedeemPoints: coupon.pointsVoucherMinimumRedeemPoints,
        productName: coupon.productName,
        productBarcode: coupon.productBarcode,
        productQuantity: coupon.productQuantity,
        productAmount: coupon.productAmount,
        exchangeItem: coupon.exchangeItem,
        exchangeQuantity: coupon.exchangeQuantity,
        ticketVenue: coupon.ticketVenue,
        ticketDurationMinutes: coupon.ticketDurationMinutes,
        claimedAt: claimEvent.at,
        validUntil: claimEvent.validUntil,
        redeemedAt,
        settlementType: claimEvent.settlementType,
        settlementCode: claimEvent.settlementCode,
        status: getClaimStatus(coupon, claimEvent, nowMs),
      } satisfies MerchantMemberCouponHistoryItem;
      appendIdentityMappedItem(
        map,
        buildMemberIdentityKeys({
          accountId: claimEvent.accountId,
          userId: claimEvent.userId,
          email: claimEvent.email,
        }),
        item,
      );
    });
  });
  return map;
}

function buildMembershipInsight(
  membership: MerchantMembershipListItem,
  memberOrders: MerchantOrderRecord[],
  couponHistory: MerchantMemberCouponHistoryItem[],
  now: Date,
): MerchantMembershipInsight {
  const nowMs = now.getTime();
  const totalSpendAmount = memberOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const totalOrderCount = memberOrders.length;
  const orderedActivityTimes = memberOrders
    .map(getOrderActivityAt)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const firstPurchaseAt = orderedActivityTimes[0] ? new Date(orderedActivityTimes[0]).toISOString() : null;
  const recentPurchaseAt = orderedActivityTimes.at(-1) ? new Date(orderedActivityTimes.at(-1) ?? 0).toISOString() : null;
  const activeMonths =
    firstPurchaseAt && totalOrderCount > 0 ? Math.max(1, (nowMs - Date.parse(firstPurchaseAt)) / (30.4375 * 24 * 60 * 60 * 1000)) : 0;
  const productMap = new Map<string, { quantity: number; amount: number }>();
  memberOrders.forEach((order) => {
    order.items.forEach((item) => {
      const name = trimText(item.name || item.code || item.productId, 120);
      if (!name) return;
      const current = productMap.get(name) ?? { quantity: 0, amount: 0 };
      current.quantity += item.quantity;
      current.amount += item.subtotal;
      productMap.set(name, current);
    });
  });

  const availableCouponMap = new Map<string, MerchantMembershipInsight["availableCoupons"][number]>();
  couponHistory
    .filter((item) => item.status === "available")
    .forEach((item) => {
      const current = availableCouponMap.get(item.couponId) ?? {
        couponId: item.couponId,
        title: item.title,
        discountLabel: item.discountLabel,
        count: 0,
      };
      current.count += 1;
      availableCouponMap.set(item.couponId, current);
    });

  return {
    pointBalance: membership.pointBalance,
    balanceAmount: membership.balanceAmount,
    availableCouponCount: couponHistory.filter((item) => item.status === "available").length,
    availableCoupons: Array.from(availableCouponMap.values()).sort((left, right) => right.count - left.count),
    couponHistory,
    totalSpendAmount: Number(totalSpendAmount.toFixed(2)),
    totalOrderCount,
    consumptionFrequencyPerMonth: activeMonths > 0 ? Number((totalOrderCount / activeMonths).toFixed(2)) : 0,
    averageOrderAmount: totalOrderCount > 0 ? Number((totalSpendAmount / totalOrderCount).toFixed(2)) : 0,
    recentPurchaseAt,
    firstPurchaseAt,
    yearlySpendAmount: Number(
      memberOrders
        .filter((order) => isTimestampInCurrentYear(getOrderActivityAt(order), now))
        .reduce((sum, order) => sum + order.totalAmount, 0)
        .toFixed(2),
    ),
    productPreferences: Array.from(productMap.entries())
      .sort((left, right) => right[1].quantity - left[1].quantity || right[1].amount - left[1].amount)
      .slice(0, 5)
      .map(([name, summary]) => `${name}（${summary.quantity}）`),
  };
}

function buildMembershipSearchText(
  membership: MerchantMembershipListItem,
  includeCustomerData: boolean,
) {
  const publicParts = [membership.memberNo, membership.status, membership.joinedAt, membership.leftAt];
  if (!membership.profileVisible || !includeCustomerData) return publicParts.join(" ").toLowerCase();
  return [
    ...publicParts,
    membership.nickname,
    membership.name,
    membership.accountId,
    membership.email,
    membership.phone,
    membership.birthday,
    membership.gender,
    membership.country,
    membership.province,
    membership.city,
    membership.address,
    membership.taxName,
    membership.taxNumber,
    membership.taxCountry,
    membership.taxProvince,
    membership.taxCity,
    membership.taxAddress,
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeListOffset(value: unknown) {
  const numberValue = Number(trimText(value, 32));
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
}

function normalizeListLimit(value: unknown) {
  const numberValue = Number(trimText(value, 32));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 100;
  return Math.min(300, Math.max(1, Math.floor(numberValue)));
}

function shouldIncludeMembershipInsights(value: unknown) {
  const normalized = trimText(value, 32).toLowerCase();
  if (!normalized) return true;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldReturnLeanMemberships(value: unknown) {
  const normalized = trimText(value, 32).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function buildLeanMembershipListItem(membership: MerchantMembershipListItem): MerchantMembershipListItem {
  return {
    ...membership,
    transactions: [],
    insight: undefined,
  };
}

async function resolveSiteName(siteId: string, fallback: string) {
  const snapshot = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return trimText(snapshot?.merchantName, 120) || trimText(snapshot?.name, 120) || trimText(fallback, 120) || siteId;
}

async function handleGetMemberships(request: Request) {
  const url = new URL(request.url);
  const siteId = readUniqueMerchantBusinessSiteId(url);
  if (!isMerchantNumericId(siteId)) {
    return privateJson({ error: "invalid_site_id" }, { status: 400 });
  }
  const action = trimText(url.searchParams.get("action"), 80);
  const requiredPermission: MerchantStaffBusinessPermission =
    action === "recharge_cancellation_quote"
      ? "redemptions.recharge.cancel"
      : "members.view";
  const session = await resolveMembershipAdminSession(
    request,
    siteId,
    requiredPermission,
  );
  const canViewCustomerData =
    session.actor.type === "owner" ||
    session.actor.businessPermissions.includes("members.customer_data.view");
  const canViewAccount =
    session.actor.type === "owner" ||
    session.actor.businessPermissions.includes("members.account.view");
  const canViewInsights =
    session.actor.type === "owner" ||
    session.actor.businessPermissions.includes("members.insights.view");
  const statusFilter = trimText(url.searchParams.get("status"), 32);
  const keyword = trimText(url.searchParams.get("query") ?? url.searchParams.get("keyword"), 200).toLowerCase();
  const membershipId = trimText(url.searchParams.get("membershipId"), 160);
  if (action === "recharge_cancellation_quote") {
    try {
      await session.assertAuthorizationCurrent();
      const quote = await getMerchantMembershipRechargeCancellationQuote({
        siteId,
        membershipId,
        memberNo: url.searchParams.get("memberNo"),
        transactionId: url.searchParams.get("transactionId"),
      });
      return privateJson({ ok: true, quote });
    } catch (error) {
      if (error instanceof MerchantBusinessAccessError) throw error;
      const message = error instanceof Error ? error.message : "unknown_error";
      const status =
        message === "membership_not_found" || message === "membership_recharge_not_found"
          ? 404
          : message.startsWith("merchant_memberships_read_failed:")
            ? 500
            : 400;
      return privateJson({ error: "membership_recharge_quote_failed", message }, { status });
    }
  }
  const includeInsights =
    canViewInsights &&
    shouldIncludeMembershipInsights(url.searchParams.get("includeInsights"));
  const leanMemberships = !includeInsights && shouldReturnLeanMemberships(url.searchParams.get("lean"));
  const offset = normalizeListOffset(url.searchParams.get("offset"));
  const limit = normalizeListLimit(url.searchParams.get("limit"));
  const membershipsSnapshot = await getMerchantMembershipsSnapshot(siteId, {
    // Scheduled point rules persist membership state. Employee GET requests
    // must stay read-only; owner/system paths remain responsible for applying
    // those rules until the write is moved behind an atomic authorization
    // boundary.
    applyScheduledRules:
      session.actor.type === "owner" &&
      (includeInsights || Boolean(membershipId) || !keyword),
  });
  const knownVersion = trimText(url.searchParams.get("knownVersion"), 128);
  if (
    session.actor.type === "owner" &&
    !includeInsights &&
    knownVersion &&
    membershipsSnapshot.updatedAt &&
    knownVersion === membershipsSnapshot.updatedAt
  ) {
    return privateJson({ ok: true, notModified: true, version: membershipsSnapshot.updatedAt });
  }
  const memberships = membershipsSnapshot.memberships;
  const filteredMemberships = memberships.filter((membership) => {
    if (membershipId && !matchesMerchantMembershipBusinessId(membership, membershipId)) return false;
    if ((statusFilter === "active" || statusFilter === "left") && membership.status !== statusFilter) return false;
    if (!keyword) return true;
    return buildMembershipSearchText(membership, canViewCustomerData).includes(keyword);
  });
  const pagedMemberships = filteredMemberships.slice(offset, offset + limit);
  const [orders, coupons] =
    pagedMemberships.length > 0 && includeInsights
      ? await Promise.all([
          listMerchantOrders(siteId).catch(() => []),
          listMerchantCoupons(siteId).catch(() => []),
        ])
      : [[], []];
  const now = new Date();
  const memberOrdersByIdentity = buildMemberOrdersByIdentity(orders);
  const couponHistoryByIdentity = buildCouponHistoryByIdentity(coupons, now.getTime());
  return privateJson({
    ok: true,
    memberships: pagedMemberships.map((membership) => {
      const enriched = includeInsights
        ? {
            ...membership,
            insight: buildMembershipInsight(
              membership,
              readIdentityMappedItems(memberOrdersByIdentity, membership, (order) => order.id),
              readIdentityMappedItems(
                couponHistoryByIdentity,
                membership,
                (item) => `${item.couponId}:${item.id || item.settlementCode || item.claimedAt}`,
              ).sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt)),
              now,
            ),
          }
        : leanMemberships
          ? buildLeanMembershipListItem(membership)
          : membership;
      return redactMerchantMembershipListItem(enriched, {
        customerData: canViewCustomerData,
        account: canViewAccount,
        insights: canViewInsights && includeInsights,
      });
    }),
    total: filteredMemberships.length,
    allTotal: memberships.length,
    offset,
    limit,
    hasMore: offset + pagedMemberships.length < filteredMemberships.length,
    version: membershipsSnapshot.updatedAt,
  });
}

export async function GET(request: Request) {
  try {
    return await handleGetMemberships(request);
  } catch (error) {
    return membershipAccessErrorResponse(error, "membership_list_failed");
  }
}

export async function POST(request: Request) {
  if (request.headers.has("x-merchant-access-token")) {
    return privateJson(
      { error: "business_scope_required" },
      { status: 403 },
    );
  }
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      siteId?: unknown;
      siteName?: unknown;
      profile?: unknown;
      frontendAuthProof?: unknown;
    } | null;
    const directSession = await resolvePersonalAccountSessionFromRequest(request);
    const session =
      directSession ??
      (await resolvePersonalAccountSessionFromFrontendAuthProofPayload(verifyFrontendAuthProof(body?.frontendAuthProof)));
    if (!session) {
      return privateJson({ error: "unauthorized" }, { status: 401 });
    }
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const siteName = await resolveSiteName(siteId, trimText(body?.siteName, 120));
    const membership = await joinMerchantMembership({ siteId, siteName, session, profile: body?.profile });
    return privateJson({
      ok: true,
      membership: toPersonalMembershipCard(membership),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return privateJson(
      {
        error: "membership_join_failed",
        message,
      },
      { status: message.startsWith("merchant_memberships_read_failed:") ? 500 : 400 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      type?: unknown;
      siteId?: unknown;
      membershipId?: unknown;
      memberNo?: unknown;
      allergens?: unknown;
      points?: unknown;
      balanceAmount?: unknown;
      note?: unknown;
      rechargePlanId?: unknown;
      redemptionItemId?: unknown;
      redemptionQuantity?: unknown;
      redemptionItems?: unknown;
      orderAmount?: unknown;
      orderId?: unknown;
      requestedPoints?: unknown;
      referenceId?: unknown;
      transactionId?: unknown;
      operationId?: unknown;
      confirmationTransactionId?: unknown;
    } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const action = trimText(body?.action, 80);
    const merchantPermission = getMerchantMembershipPatchRequiredPermission({
      action,
      type: trimText(body?.type, 80),
    });
    if (
      request.headers.has("x-merchant-access-token") &&
      !merchantPermission
    ) {
      return privateJson(
        { error: "business_scope_required" },
        { status: 403 },
      );
    }
    const merchantSession = merchantPermission
      ? await resolveMembershipAdminSession(request, siteId, merchantPermission)
      : null;
    if (action === "update_allergens" && merchantSession) {
      const membership = await updateMerchantMembershipAllergens({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        allergens: body?.allergens,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        membership: redactMembershipMutationResult(
          membership,
          merchantSession,
          "members.allergens.manage",
        ),
      });
    }
    if (action === "member_operation" && merchantSession) {
      const membership = await applyMerchantMembershipAccountOperation({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        memberNo: trimText(body?.memberNo, 120),
        type: trimText(body?.type, 80) === "recharge" ? "recharge" : "redeem",
        points: body?.points,
        balanceAmount: body?.balanceAmount,
        note: body?.note,
        operatorId: merchantSession.operatorId,
        rechargePlanId: body?.rechargePlanId,
        redemptionItemId: body?.redemptionItemId,
        redemptionQuantity: body?.redemptionQuantity,
        operationId: body?.operationId,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        membership: redactMembershipMutationResult(
          membership,
          merchantSession,
          merchantPermission!,
        ),
      });
    }
    if (action === "cancel_recharge" && merchantSession) {
      const membership = await cancelMerchantMembershipRecharge({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        memberNo: trimText(body?.memberNo, 120),
        transactionId: body?.transactionId,
        note: body?.note,
        operatorId: merchantSession.operatorId,
        operationId: body?.operationId,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        membership: redactMembershipMutationResult(
          membership,
          merchantSession,
          "redemptions.recharge.cancel",
        ),
      });
    }
    if (action === "adjust_recharge" && merchantSession) {
      const membership = await adjustMerchantMembershipRecharge({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        memberNo: trimText(body?.memberNo, 120),
        transactionId: body?.transactionId,
        pointAmount: body?.points,
        balanceAmount: body?.balanceAmount,
        note: body?.note,
        operatorId: merchantSession.operatorId,
        operationId: body?.operationId,
        confirmationTransactionId: body?.confirmationTransactionId,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        membership: redactMembershipMutationResult(
          membership,
          merchantSession,
          "members.account.adjust",
        ),
      });
    }
    if (action === "member_redemption_checkout" && merchantSession) {
      const membership = await applyMerchantMembershipRedemptionCart({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        memberNo: trimText(body?.memberNo, 120),
        items: body?.redemptionItems,
        note: body?.note,
        operatorId: merchantSession.operatorId,
        operationId: body?.operationId,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        membership: redactMembershipMutationResult(
          membership,
          merchantSession,
          "redemptions.checkout",
        ),
      });
    }
    if (action === "member_checkin") {
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) {
        return privateJson({ error: "unauthorized" }, { status: 401 });
      }
      const membership = await awardMerchantMembershipRulePoints({
        siteId,
        session,
        action: "checkin",
      });
      return privateJson({ ok: true, membership });
    }
    if ((action === "award_invitation_points" || action === "award_review_points") && merchantSession) {
      const membership = await awardMerchantMembershipRulePoints({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        action: action === "award_invitation_points" ? "invitation" : "review",
        referenceId: body?.referenceId,
        operatorId: merchantSession.operatorId,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        membership: redactMembershipMutationResult(
          membership,
          merchantSession,
          "members.account.adjust",
        ),
      });
    }
    if (action === "point_deduction_quote" && merchantSession) {
      await merchantSession.assertAuthorizationCurrent();
      const quote = await quoteMerchantMembershipPointDeduction({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        orderAmount: body?.orderAmount,
        requestedPoints: body?.requestedPoints,
      });
      return privateJson({ ok: true, quote });
    }
    if (action === "point_deduction_apply" && merchantSession) {
      const result = await applyMerchantMembershipPointDeduction({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        orderAmount: body?.orderAmount,
        requestedPoints: body?.requestedPoints,
        orderId: body?.orderId,
        operationId: body?.operationId,
        operatorId: merchantSession.operatorId,
        assertAuthorizationCurrent: merchantSession.assertAuthorizationCurrent,
      });
      return privateJson({
        ok: true,
        ...result,
        membership: redactMembershipMutationResult(
          result.membership,
          merchantSession,
          "redemptions.checkout",
        ),
      });
    }
    const session = await resolvePersonalAccountSessionFromRequest(request);
    if (!session) {
      return privateJson({ error: "unauthorized" }, { status: 401 });
    }
    const membership = await leaveMerchantMembership({ siteId, session });
    return privateJson({
      ok: true,
      membership: toPersonalMembershipCard(membership),
    });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return privateJson({ error: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "unknown_error";
    const status =
      message === "membership_not_found" || message === "membership_recharge_not_found"
        ? 404
        : message === "membership_redemption_rollback_failed" ||
            message === "membership_redemption_stock_rollback_failed" ||
            message.startsWith("merchant_memberships_read_failed:") ||
            message.includes("_history_save_failed")
          ? 500
        : message === "membership_recharge_cancel_balance_insufficient" ||
            message === "membership_balance_insufficient" ||
            message === "membership_redemption_stock_insufficient" ||
            message === "merchant_memberships_conflict" ||
            message === "merchant_membership_settings_conflict" ||
            message === "coupon_already_redeemed"
          ? 409
          : 400;
    return privateJson(
      {
        error: "membership_leave_failed",
        message,
      },
      { status },
    );
  }
}
