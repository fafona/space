import { NextResponse } from "next/server";
import { createGoogleBusinessProfileOAuthState } from "@/lib/googleBusinessProfileCrypto";
import {
  buildGoogleBusinessProfileAuthorizationUrl,
  toGoogleBusinessProfileUserMessage,
} from "@/lib/googleBusinessProfileServer";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as { siteId?: unknown } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id", message: "商户 ID 无效。" }, { status: 400 });
    }
    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return NextResponse.json({ error: "unauthorized", message: "登录状态已失效，请重新登录。" }, { status: 401 });
    }
    const state = createGoogleBusinessProfileOAuthState(siteId);
    const authorizationUrl = buildGoogleBusinessProfileAuthorizationUrl({ request, state });
    return NextResponse.json({ ok: true, authorizationUrl });
  } catch (error) {
    return NextResponse.json(
      { error: "google_business_profile_connect_failed", message: toGoogleBusinessProfileUserMessage(error) },
      { status: 503 },
    );
  }
}
