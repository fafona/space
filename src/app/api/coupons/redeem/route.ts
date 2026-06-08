import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { redeemMerchantCouponRecord } from "@/lib/merchantCoupons.server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json()) as {
      siteId?: unknown;
      settlementCode?: unknown;
      note?: unknown;
      operationId?: unknown;
    } | null;
    const siteId = trimText(body?.siteId, 32);
    const settlementCode = trimText(body?.settlementCode, 200);
    if (!isMerchantNumericId(siteId) || !settlementCode) {
      return NextResponse.json({ error: "invalid_coupon_redeem" }, { status: 400 });
    }
    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const coupon = await redeemMerchantCouponRecord({
      siteId,
      settlementCode,
      operatorId: session.merchantEmail || session.merchantId,
      note: trimText(body?.note, 500),
      operationId: body?.operationId,
    });
    return NextResponse.json({ ok: true, coupon });
  } catch (error) {
    return NextResponse.json(
      {
        error: "coupon_redeem_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
