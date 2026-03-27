import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardVCard,
  buildMerchantBusinessCardVCardFileName,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";

function buildContentDisposition(filename: string) {
  const safeAscii = filename.replace(/[^\x20-\x7E]+/g, "-").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
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
    return new NextResponse("Invalid business card contact", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const requestOrigin = resolveRequestOrigin(request);
  const payload = await loadMerchantBusinessCardSharePayloadByKey(
    shareKey,
    resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin,
  );
  if (!payload) {
    return new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const vcard = buildMerchantBusinessCardVCard(payload);
  const fileName = buildMerchantBusinessCardVCardFileName(payload);
  return new NextResponse(vcard, {
    status: 200,
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": buildContentDisposition(fileName),
      "cache-control": "no-store, max-age=0",
    },
  });
}
