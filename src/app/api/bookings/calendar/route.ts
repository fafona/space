import { NextResponse } from "next/server";
import { buildMerchantBookingsCalendarIcs } from "@/lib/merchantBookingCalendar";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { listMerchantBookings } from "@/lib/merchantBookings.server";
import { loadMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbenchStore";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = trimText(searchParams.get("siteId"));
  const token = trimText(searchParams.get("token"));
  const download = searchParams.get("download") === "1";

  if (!isMerchantNumericId(siteId)) {
    return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  }

  const settings = await loadMerchantBookingWorkbenchSettings(siteId);
  const tokenAuthorized = Boolean(token) && Boolean(settings.calendarSyncToken) && token === settings.calendarSyncToken;

  let sessionAuthorized = false;
  if (!tokenAuthorized) {
    const session = await resolveMerchantSessionFromRequest(request, {
      hintedMerchantId: siteId,
    });
    sessionAuthorized = Boolean(session && session.merchantId === siteId);
  }

  if (!tokenAuthorized && !sessionAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bookings = await listMerchantBookings(siteId);
  const siteName = bookings.find((item) => trimText(item.siteName))?.siteName ?? siteId;
  const ics = buildMerchantBookingsCalendarIcs({
    siteId,
    siteName,
    bookings,
  });

  const response = new NextResponse(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": tokenAuthorized ? "public, max-age=300, s-maxage=300" : "no-store",
    },
  });
  if (download) {
    response.headers.set("content-disposition", `attachment; filename="bookings-${siteId}.ics"`);
  }
  return response;
}
