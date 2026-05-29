import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { claimMerchantCouponRecord } from "@/lib/merchantCoupons.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function isCouponWebsiteBlockEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return Boolean(site?.permissionConfig?.allowCouponModule && site?.permissionConfig?.allowCouponBlock);
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json()) as { siteId?: unknown; couponId?: unknown } | null;
    const siteId = trimText(body?.siteId);
    const couponId = trimText(body?.couponId);
    if (!isMerchantNumericId(siteId) || !couponId) {
      return NextResponse.json({ error: "invalid_coupon" }, { status: 400 });
    }
    if (!(await isCouponWebsiteBlockEnabled(siteId))) {
      return NextResponse.json({ error: "coupon_block_disabled" }, { status: 403 });
    }
    const coupon = await claimMerchantCouponRecord({ siteId, couponId });
    return NextResponse.json({ ok: true, coupon });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "coupon_not_claimable" ? 409 : 400;
    return NextResponse.json(
      {
        error: "coupon_claim_failed",
        message,
      },
      { status },
    );
  }
}
