import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getVisibleMerchantCoupons, type MerchantCouponInput } from "@/lib/merchantCoupons";
import {
  archiveMerchantCouponRecord,
  createMerchantCouponRecord,
  listMerchantCoupons,
  updateMerchantCouponRecord,
} from "@/lib/merchantCoupons.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function resolveCouponAdminSession(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  if (!session || session.merchantId !== siteId) return null;
  return session;
}

async function isCouponModuleEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return Boolean(site?.permissionConfig?.allowCouponModule);
}

async function isCouponWebsiteBlockEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return Boolean(site?.permissionConfig?.allowCouponModule && site?.permissionConfig?.allowCouponBlock);
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = trimText(searchParams.get("siteId"));
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }

    const publicScope = trimText(searchParams.get("scope")) === "public";
    if (publicScope) {
      if (!(await isCouponWebsiteBlockEnabled(siteId))) {
        return NextResponse.json({ ok: true, coupons: [] });
      }
      const coupons = getVisibleMerchantCoupons(await listMerchantCoupons(siteId));
      return NextResponse.json({ ok: true, coupons });
    }

    const session = await resolveCouponAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await isCouponModuleEnabled(siteId))) {
      return NextResponse.json({ error: "coupon_module_disabled" }, { status: 403 });
    }
    const coupons = await listMerchantCoupons(siteId);
    return NextResponse.json({ ok: true, coupons });
  } catch (error) {
    return NextResponse.json(
      {
        error: "coupon_list_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json()) as MerchantCouponInput | null;
    const siteId = trimText(body?.siteId);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const session = await resolveCouponAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await isCouponModuleEnabled(siteId))) {
      return NextResponse.json({ error: "coupon_module_disabled" }, { status: 403 });
    }
    const coupon = await createMerchantCouponRecord({
      ...(body ?? {}),
      siteId,
    });
    return NextResponse.json({ ok: true, coupon });
  } catch (error) {
    return NextResponse.json(
      {
        error: "coupon_create_failed",
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
    const body = (await request.json()) as { siteId?: unknown; couponId?: unknown; patch?: MerchantCouponInput } | null;
    const siteId = trimText(body?.siteId);
    const couponId = trimText(body?.couponId);
    if (!isMerchantNumericId(siteId) || !couponId) {
      return NextResponse.json({ error: "invalid_coupon" }, { status: 400 });
    }
    const session = await resolveCouponAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await isCouponModuleEnabled(siteId))) {
      return NextResponse.json({ error: "coupon_module_disabled" }, { status: 403 });
    }
    const coupon = await updateMerchantCouponRecord({
      siteId,
      couponId,
      patch: body?.patch ?? {},
    });
    return NextResponse.json({ ok: true, coupon });
  } catch (error) {
    return NextResponse.json(
      {
        error: "coupon_update_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
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
    const session = await resolveCouponAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await isCouponModuleEnabled(siteId))) {
      return NextResponse.json({ error: "coupon_module_disabled" }, { status: 403 });
    }
    const coupon = await archiveMerchantCouponRecord({ siteId, couponId });
    return NextResponse.json({ ok: true, coupon });
  } catch (error) {
    return NextResponse.json(
      {
        error: "coupon_delete_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
