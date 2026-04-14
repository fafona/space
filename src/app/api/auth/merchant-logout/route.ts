import { NextResponse } from "next/server";
import { clearMerchantAuthCookies } from "@/lib/merchantAuthSession";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const response = NextResponse.json({ ok: true });
  clearMerchantAuthCookies(response, request);
  return response;
}
