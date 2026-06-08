import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getMerchantCouponDiscountLabel,
  getMerchantCouponDisplayTitle,
  type MerchantCouponClaimEvent,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { listMerchantCoupons } from "@/lib/merchantCoupons.server";
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
  awardMerchantMembershipRulePoints,
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
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

function buildMembershipSearchText(membership: MerchantMembershipListItem) {
  const publicParts = [membership.memberNo, membership.status, membership.joinedAt, membership.leftAt];
  if (!membership.profileVisible) return publicParts.join(" ").toLowerCase();
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

async function resolveSiteName(siteId: string, fallback: string) {
  const snapshot = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return trimText(snapshot?.merchantName, 120) || trimText(snapshot?.name, 120) || trimText(fallback, 120) || siteId;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteId = trimText(url.searchParams.get("siteId"), 64);
  if (!isMerchantNumericId(siteId)) {
    return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  }
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
  if (!session || session.merchantId !== siteId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const statusFilter = trimText(url.searchParams.get("status"), 32);
  const keyword = trimText(url.searchParams.get("query") ?? url.searchParams.get("keyword"), 200).toLowerCase();
  const membershipId = trimText(url.searchParams.get("membershipId"), 160);
  const includeInsights = shouldIncludeMembershipInsights(url.searchParams.get("includeInsights"));
  const offset = normalizeListOffset(url.searchParams.get("offset"));
  const limit = normalizeListLimit(url.searchParams.get("limit"));
  const membershipsSnapshot = await getMerchantMembershipsSnapshot(siteId);
  const memberships = membershipsSnapshot.memberships;
  const filteredMemberships = memberships.filter((membership) => {
    if (membershipId && membership.id !== membershipId) return false;
    if ((statusFilter === "active" || statusFilter === "left") && membership.status !== statusFilter) return false;
    if (!keyword) return true;
    return buildMembershipSearchText(membership).includes(keyword);
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
  return NextResponse.json({
    ok: true,
    memberships: pagedMemberships.map((membership) =>
      includeInsights
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
        : membership,
    ),
    total: filteredMemberships.length,
    allTotal: memberships.length,
    offset,
    limit,
    hasMore: offset + pagedMemberships.length < filteredMemberships.length,
    version: membershipsSnapshot.updatedAt,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
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
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const siteName = await resolveSiteName(siteId, trimText(body?.siteName, 120));
    const membership = await joinMerchantMembership({ siteId, siteName, session, profile: body?.profile });
    return NextResponse.json({
      ok: true,
      membership: toPersonalMembershipCard(membership),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "membership_join_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      type?: unknown;
      siteId?: unknown;
      membershipId?: unknown;
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
      operationId?: unknown;
    } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    if (trimText(body?.action, 80) === "update_allergens") {
      const merchantSession = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!merchantSession || merchantSession.merchantId !== siteId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const membership = await updateMerchantMembershipAllergens({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        allergens: body?.allergens,
      });
      return NextResponse.json({ ok: true, membership });
    }
    if (trimText(body?.action, 80) === "member_operation") {
      const merchantSession = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!merchantSession || merchantSession.merchantId !== siteId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const membership = await applyMerchantMembershipAccountOperation({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        type: trimText(body?.type, 80) === "recharge" ? "recharge" : "redeem",
        points: body?.points,
        balanceAmount: body?.balanceAmount,
        note: body?.note,
        operatorId: merchantSession.merchantId,
        rechargePlanId: body?.rechargePlanId,
        redemptionItemId: body?.redemptionItemId,
        redemptionQuantity: body?.redemptionQuantity,
        operationId: body?.operationId,
      });
      return NextResponse.json({ ok: true, membership });
    }
    if (trimText(body?.action, 80) === "member_redemption_checkout") {
      const merchantSession = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!merchantSession || merchantSession.merchantId !== siteId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const membership = await applyMerchantMembershipRedemptionCart({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        items: body?.redemptionItems,
        note: body?.note,
        operatorId: merchantSession.merchantId,
        operationId: body?.operationId,
      });
      return NextResponse.json({ ok: true, membership });
    }
    if (trimText(body?.action, 80) === "member_checkin") {
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const membership = await awardMerchantMembershipRulePoints({
        siteId,
        session,
        action: "checkin",
      });
      return NextResponse.json({ ok: true, membership });
    }
    if (trimText(body?.action, 80) === "award_invitation_points" || trimText(body?.action, 80) === "award_review_points") {
      const merchantSession = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!merchantSession || merchantSession.merchantId !== siteId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const membership = await awardMerchantMembershipRulePoints({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        action: trimText(body?.action, 80) === "award_invitation_points" ? "invitation" : "review",
        referenceId: body?.referenceId,
        operatorId: merchantSession.merchantId,
      });
      return NextResponse.json({ ok: true, membership });
    }
    if (trimText(body?.action, 80) === "point_deduction_quote") {
      const merchantSession = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!merchantSession || merchantSession.merchantId !== siteId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const quote = await quoteMerchantMembershipPointDeduction({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        orderAmount: body?.orderAmount,
        requestedPoints: body?.requestedPoints,
      });
      return NextResponse.json({ ok: true, quote });
    }
    if (trimText(body?.action, 80) === "point_deduction_apply") {
      const merchantSession = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!merchantSession || merchantSession.merchantId !== siteId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const result = await applyMerchantMembershipPointDeduction({
        siteId,
        membershipId: trimText(body?.membershipId, 160),
        orderAmount: body?.orderAmount,
        requestedPoints: body?.requestedPoints,
        orderId: body?.orderId,
        operatorId: merchantSession.merchantId,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const session = await resolvePersonalAccountSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const membership = await leaveMerchantMembership({ siteId, session });
    return NextResponse.json({
      ok: true,
      membership: toPersonalMembershipCard(membership),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "membership_not_found" ? 404 : 400;
    return NextResponse.json(
      {
        error: "membership_leave_failed",
        message,
      },
      { status },
    );
  }
}
