import { NextResponse } from "next/server";
import {
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";

function readSafeContentType(value: string | null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/webp") return "image/webp";
  return "image/png";
}

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
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  }

  const requestOrigin = resolveRequestOrigin(request);
  const payload = await loadMerchantBusinessCardSharePayloadByKey(
    shareKey,
    resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin,
  );
  const imageUrl = String(payload?.imageUrl ?? "").trim();
  if (!imageUrl) {
    return new NextResponse("Business card image not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  }

  try {
    const upstream = await fetch(imageUrl, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!upstream.ok) {
      return new NextResponse("Business card image unavailable", {
        status: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=60",
        },
      });
    }

    const contentType = readSafeContentType(upstream.headers.get("content-type"));
    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Business card image unavailable", {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  }
}
