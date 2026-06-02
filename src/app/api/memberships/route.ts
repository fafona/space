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
  joinMerchantMembership,
  leaveMerchantMembership,
  listMerchantMemberships,
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

function matchesMemberIdentity(
  membership: Pick<MerchantMembershipListItem, "accountId" | "userId" | "email">,
  input: { accountId?: string | null; userId?: string | null; email?: string | null },
) {
  const accountId = trimText(input.accountId, 128);
  const userId = trimText(input.userId, 128);
  const email = normalizeEmail(input.email);
  if (membership.accountId && accountId && membership.accountId === accountId) return true;
  if (membership.userId && userId && membership.userId === userId) return true;
  return Boolean(membership.email && email && normalizeEmail(membership.email) === email);
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

function buildMembershipInsight(
  membership: MerchantMembershipListItem,
  orders: MerchantOrderRecord[],
  coupons: MerchantCouponRecord[],
): MerchantMembershipInsight {
  const now = new Date();
  const nowMs = now.getTime();
  const memberOrders = orders
    .filter((order) =>
      matchesMemberIdentity(membership, {
        accountId: order.customerAccountId,
        userId: order.customerUserId,
        email: order.customerLoginEmail || order.customer.email,
      }),
    )
    .filter((order) => order.status !== "cancelled");
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

  const couponHistory = coupons
    .flatMap((coupon) =>
      coupon.claimEvents
        .filter((claimEvent) =>
          matchesMemberIdentity(membership, {
            accountId: claimEvent.accountId,
            userId: claimEvent.userId,
            email: claimEvent.email,
          }),
        )
        .map((claimEvent) => {
          const redeemedAt = getCouponRedeemAt(coupon, claimEvent);
          return {
            id: claimEvent.id,
            couponId: coupon.id,
            title: getMerchantCouponDisplayTitle(coupon),
            discountLabel: getMerchantCouponDiscountLabel(coupon),
            claimedAt: claimEvent.at,
            validUntil: claimEvent.validUntil,
            redeemedAt,
            settlementType: claimEvent.settlementType,
            settlementCode: claimEvent.settlementCode,
            status: getClaimStatus(coupon, claimEvent, nowMs),
          } satisfies MerchantMemberCouponHistoryItem;
        }),
    )
    .sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt));

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
  const [memberships, orders, coupons] = await Promise.all([
    listMerchantMemberships(siteId),
    listMerchantOrders(siteId).catch(() => []),
    listMerchantCoupons(siteId).catch(() => []),
  ]);
  return NextResponse.json({
    ok: true,
    memberships: memberships.map((membership) => ({
      ...membership,
      insight: buildMembershipInsight(membership, orders, coupons),
    })),
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
