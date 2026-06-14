import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { isCouponWebsiteBlockEnabled } from "@/lib/merchantCouponPermissions.server";
import { getVisibleMerchantCoupons, type MerchantCouponInput, type MerchantCouponRecord } from "@/lib/merchantCoupons";
import {
  archiveMerchantCouponRecord,
  createMerchantCouponRecord,
  getMerchantCouponsSnapshot,
  updateMerchantCouponRecord,
} from "@/lib/merchantCoupons.server";
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

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeListOffset(value: unknown) {
  const numberValue = Number(trimText(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
}

function normalizeListLimit(value: unknown) {
  const numberValue = Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 100;
  return Math.min(300, Math.max(1, Math.floor(numberValue)));
}

function buildCouponSearchText(coupon: MerchantCouponRecord) {
  return [
    coupon.id,
    coupon.code,
    coupon.title,
    coupon.description,
    coupon.productName,
    coupon.productBarcode,
    coupon.exchangeItem,
    coupon.ticketVenue,
    coupon.discountType,
    coupon.status,
  ]
    .join(" ")
    .toLowerCase();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = trimText(searchParams.get("siteId"));
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }

    const publicScope = trimText(searchParams.get("scope")) === "public";
    const knownVersion = trimText(searchParams.get("knownVersion"));
    if (publicScope) {
      if (!(await isCouponWebsiteBlockEnabled(siteId))) {
        return NextResponse.json({ ok: true, coupons: [], version: null });
      }
      const snapshot = await getMerchantCouponsSnapshot(siteId);
      if (knownVersion && snapshot.updatedAt && knownVersion === snapshot.updatedAt) {
        return NextResponse.json({ ok: true, notModified: true, version: snapshot.updatedAt });
      }
      const coupons = getVisibleMerchantCoupons(snapshot.coupons);
      return NextResponse.json({ ok: true, coupons, version: snapshot.updatedAt });
    }

    const session = await resolveCouponAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const snapshot = await getMerchantCouponsSnapshot(siteId);
    if (knownVersion && snapshot.updatedAt && knownVersion === snapshot.updatedAt) {
      return NextResponse.json({ ok: true, notModified: true, version: snapshot.updatedAt });
    }
    const statusFilter = trimText(searchParams.get("status"));
    const keyword = trimText(searchParams.get("query") ?? searchParams.get("keyword")).toLowerCase();
    const paged = searchParams.has("limit") || searchParams.has("offset");
    const filteredCoupons = snapshot.coupons.filter((coupon) => {
      if ((statusFilter === "active" || statusFilter === "paused" || statusFilter === "archived") && coupon.status !== statusFilter) {
        return false;
      }
      if (!keyword) return true;
      return buildCouponSearchText(coupon).includes(keyword);
    });
    const offset = paged ? normalizeListOffset(searchParams.get("offset")) : 0;
    const limit = paged ? normalizeListLimit(searchParams.get("limit")) : filteredCoupons.length;
    const coupons = paged ? filteredCoupons.slice(offset, offset + limit) : filteredCoupons;
    return NextResponse.json({
      ok: true,
      coupons,
      total: filteredCoupons.length,
      allTotal: snapshot.coupons.length,
      offset,
      limit,
      hasMore: offset + coupons.length < filteredCoupons.length,
      version: snapshot.updatedAt,
    });
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
