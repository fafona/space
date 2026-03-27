import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardVCard,
  buildMerchantBusinessCardVCardFileName,
  isMerchantBusinessCardShareRevoked,
  parseMerchantBusinessCardShareParams,
  readMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";

function buildContentDisposition(filename: string) {
  const safeAscii = filename.replace(/[^\x20-\x7E]+/g, "-").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = resolveMerchantBusinessCardShareOrigin(requestUrl.origin, requestUrl.searchParams.get("target"));
  const payload = parseMerchantBusinessCardShareParams(requestUrl.searchParams, origin || requestUrl.origin);
  const shareKey = readMerchantBusinessCardShareKey(requestUrl.searchParams);
  if (!payload) {
    return new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  if (
    await isMerchantBusinessCardShareRevoked({
      shareKey,
      payload,
      preferredOrigin: origin || requestUrl.origin,
    })
  ) {
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
