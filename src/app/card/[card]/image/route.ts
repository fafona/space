import { NextResponse } from "next/server";
import {
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";

function resolveRequestOrigin(request: Request) {
  const forwardedHost = String(request.headers.get("x-forwarded-host") ?? "").trim();
  const host = forwardedHost || String(request.headers.get("host") ?? "").trim();
  const forwardedProto = String(request.headers.get("x-forwarded-proto") ?? "").trim();
  if (!host) return new URL(request.url).origin;
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  if (!shareKey) {
    return new NextResponse("Invalid business card image", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const requestOrigin = resolveRequestOrigin(request);
  const payloadOrigin = resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin;
  const [revoked, payload] = await Promise.all([
    isMerchantBusinessCardShareRevoked({
      shareKey,
      preferredOrigin: requestOrigin,
    }),
    loadMerchantBusinessCardSharePayloadByKey(shareKey, payloadOrigin),
  ]);
  if (revoked) {
    return new NextResponse("Business card image not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }
  const imageUrl = String(payload?.imageUrl ?? "").trim();
  if (!imageUrl) {
    return new NextResponse("Business card image not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const response = NextResponse.redirect(imageUrl, { status: 302 });
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
