import { NextRequest, NextResponse } from "next/server";
import { authorizeMerchantServiceOrigin } from "@/lib/merchantServiceOrigin.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";

export async function handleMerchantServiceFrameEntry(request: NextRequest, authorize = authorizeMerchantServiceOrigin) {
  if (!isCanonicalPortalRequest(request)) return NextResponse.json({ error: "portal_origin_required" }, { status: 421 });
  const origin = request.nextUrl.searchParams.get("parentOrigin") || "";
  const siteId = request.nextUrl.searchParams.get("siteId") || "";
  const nonce = request.nextUrl.searchParams.get("nonce") || "";
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(nonce) || !await authorize(request, origin, siteId)) {
    return NextResponse.json({ error: "invalid_service_frame" }, { status: 403,
      headers: { "content-security-policy": "frame-ancestors 'none'", "cache-control": "no-store" } });
  }
  const response = NextResponse.next();
  response.headers.set("content-security-policy", `frame-ancestors 'self' ${origin}; object-src 'none'; base-uri 'self'; form-action 'self'`);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("permissions-policy", "camera=(), microphone=(), payment=()");
  return response;
}
