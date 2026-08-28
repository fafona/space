import { NextResponse } from "next/server";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
} from "@/lib/merchantBusinessActor.server";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import { getMerchantCouponsSnapshot } from "@/lib/merchantCoupons.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { redactMerchantMembershipForCashier } from "@/lib/merchantMembershipBusinessPermissions";
import {
  buildRedemptionCashierSettings,
  getMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings.server";
import { getMerchantMembershipsSnapshot } from "@/lib/merchantMemberships.server";
import { buildRedemptionCashierMembershipList } from "@/lib/merchantRedemptionCashier";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function normalizeLimit(value: unknown) {
  const numberValue = Number(trimText(value, 32));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 300;
  return Math.min(300, Math.max(1, Math.floor(numberValue)));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = readUniqueMerchantBusinessSiteId(url);
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }

    const actor = await authorizeMerchantBusinessRequest(request, {
      siteId,
      requiredPermission: "redemptions.view",
    });
    const canViewCustomerData =
      actor.type === "owner" ||
      actor.businessPermissions.includes("redemptions.customer_data.view");

    const limit = normalizeLimit(url.searchParams.get("limit"));
    const knownMembershipVersion = trimText(url.searchParams.get("knownMembershipVersion"), 128);
    const knownSettingsVersion = trimText(url.searchParams.get("knownSettingsVersion"), 128);
    const knownCouponVersion = trimText(url.searchParams.get("knownCouponVersion"), 128);
    const [membershipsSnapshot, settings, couponsSnapshot] = await Promise.all([
      getMerchantMembershipsSnapshot(siteId, { applyScheduledRules: false }),
      getMerchantMembershipSettings(siteId),
      getMerchantCouponsSnapshot(siteId).catch(() => ({ coupons: [], updatedAt: null })),
    ]);
    const membershipVersion = membershipsSnapshot.updatedAt;
    const settingsVersion = settings.updatedAt ?? null;
    const couponVersion = couponsSnapshot.updatedAt;
    // A restricted employee must receive a freshly redacted payload instead
    // of reusing a full owner/customer-data cache entry in the same browser.
    const membershipsNotModified = Boolean(
      canViewCustomerData &&
      knownMembershipVersion &&
      membershipVersion &&
      knownMembershipVersion === membershipVersion,
    );
    const settingsNotModified = Boolean(knownSettingsVersion && settingsVersion && knownSettingsVersion === settingsVersion);
    const couponsNotModified = Boolean(knownCouponVersion && couponVersion && knownCouponVersion === couponVersion);
    const mode = trimText(url.searchParams.get("mode"), 32);
    const memberships = buildRedemptionCashierMembershipList(
      membershipsSnapshot.memberships,
      { mode, limit },
    ).map((membership) =>
      redactMerchantMembershipForCashier(membership, canViewCustomerData),
    );
    const couponCatalog = couponsSnapshot.coupons.map((coupon) => ({
      ...coupon,
      claimEvents: [],
      redeemEvents: [],
    }));

    return privateJson({
      ok: true,
      memberships: membershipsNotModified ? undefined : memberships,
      membershipsNotModified,
      membershipVersion,
      settings: settingsNotModified ? undefined : buildRedemptionCashierSettings(settings),
      settingsNotModified,
      settingsVersion,
      coupons: couponsNotModified ? undefined : couponCatalog,
      couponsNotModified,
      couponVersion,
      limit,
    });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return privateJson({ error: error.code }, { status: error.status });
    }
    return privateJson(
      {
        error: "redemption_cashier_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
