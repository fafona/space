import { NextResponse } from "next/server";
import { getMerchantCouponsSnapshot } from "@/lib/merchantCoupons.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  buildRedemptionCashierSettings,
  getMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings.server";
import { getMerchantMembershipsSnapshot } from "@/lib/merchantMemberships.server";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeLimit(value: unknown) {
  const numberValue = Number(trimText(value, 32));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 300;
  return Math.min(300, Math.max(1, Math.floor(numberValue)));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = trimText(url.searchParams.get("siteId"), 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }

    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const limit = normalizeLimit(url.searchParams.get("limit"));
    const [membershipsSnapshot, settings, couponsSnapshot] = await Promise.all([
      getMerchantMembershipsSnapshot(siteId),
      getMerchantMembershipSettings(siteId),
      getMerchantCouponsSnapshot(siteId).catch(() => ({ coupons: [], updatedAt: null })),
    ]);
    const memberships = membershipsSnapshot.memberships
      .filter((membership) => membership.status === "active")
      .slice(0, limit);
    const couponCatalog = couponsSnapshot.coupons.map((coupon) => ({
      ...coupon,
      claimEvents: [],
      redeemEvents: [],
    }));

    return NextResponse.json({
      ok: true,
      memberships,
      membershipVersion: membershipsSnapshot.updatedAt,
      settings: buildRedemptionCashierSettings(settings),
      settingsVersion: settings.updatedAt ?? null,
      coupons: couponCatalog,
      couponVersion: couponsSnapshot.updatedAt,
      limit,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "redemption_cashier_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
