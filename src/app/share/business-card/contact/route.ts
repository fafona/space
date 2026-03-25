import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardVCard,
  buildMerchantBusinessCardVCardFileName,
  parseMerchantBusinessCardShareParams,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";

function buildContentDisposition(filename: string) {
  const safeAscii = filename.replace(/[^\x20-\x7E]+/g, "-").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = resolveMerchantBusinessCardShareOrigin(requestUrl.origin, requestUrl.searchParams.get("target"));
  const payload = parseMerchantBusinessCardShareParams(requestUrl.searchParams, origin || requestUrl.origin);
  if (!payload) {
    return new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
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
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
