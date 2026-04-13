import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getMerchantBookingWorkbenchPublicSettings } from "@/lib/merchantBookingWorkbench";
import { loadMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbenchStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = trimText(searchParams.get("siteId"));
  if (!isMerchantNumericId(siteId)) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }
  const settings = await loadMerchantBookingWorkbenchSettings(siteId);
  return noStoreJson({
    ok: true,
    settings: getMerchantBookingWorkbenchPublicSettings(settings),
  });
}
