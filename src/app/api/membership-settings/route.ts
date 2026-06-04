import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getMerchantMembershipSettings,
  updateMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings.server";
import type { MerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function requireMerchant(siteId: string, request: Request) {
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
  return Boolean(session && session.merchantId === siteId);
}

function buildRedemptionCashierSettings(settings: MerchantMembershipSettings): MerchantMembershipSettings {
  return {
    ...settings,
    rechargePlans: settings.rechargePlans.filter((plan) => plan.enabled),
    redemptionCategories: settings.redemptionCategories
      .filter((category) => category.enabled)
      .map((category) => ({
        id: category.id,
        name: category.name,
        iconName: category.iconName,
        enabled: category.enabled,
        sort: category.sort,
      })),
    redemptionItems: settings.redemptionItems
      .filter((item) => item.enabled)
      .map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        code: item.code,
        barcode: item.barcode,
        name: item.name,
        imageUrl: item.imageUrl,
        iconName: item.iconName,
        description: item.description,
        enabled: item.enabled,
        pointsCost: item.pointsCost,
        referenceAmount: item.referenceAmount,
        memberPrice: item.memberPrice,
        taxRate: item.taxRate,
        stock: item.stock,
        pointProduct: item.pointProduct,
        recommended: item.recommended,
        sort: item.sort,
      })),
    levels: settings.levels
      .filter((level) => level.enabled)
      .map((level) => ({
        ...level,
        benefit: {
          ...level.benefit,
          pointDiscount: level.benefit.pointDiscount,
        },
      })),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteId = trimText(url.searchParams.get("siteId"), 64);
  if (!isMerchantNumericId(siteId)) {
    return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  }
  if (!(await requireMerchant(siteId, request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await getMerchantMembershipSettings(siteId);
  const scope = trimText(url.searchParams.get("scope"), 64);
  return NextResponse.json({
    ok: true,
    settings: scope === "redemption-cashier" ? buildRedemptionCashierSettings(settings) : settings,
  });
}

export async function PUT(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as { siteId?: unknown; settings?: unknown } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    if (!(await requireMerchant(siteId, request))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const settings = await updateMerchantMembershipSettings({
      siteId,
      settings: body?.settings,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json(
      {
        error: "membership_settings_save_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
