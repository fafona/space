import { NextResponse } from "next/server";
import { buildMerchantBookingsCalendarIcs } from "@/lib/merchantBookingCalendar";
import { getMerchantBookingByEditToken } from "@/lib/merchantBookings.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bookingId = trimText(searchParams.get("bookingId"));
    const editToken = trimText(searchParams.get("editToken"));
    const download = searchParams.get("download") === "1";
    if (!bookingId || !editToken) {
      return NextResponse.json({ error: "invalid_booking_token" }, { status: 400 });
    }
    const booking = await getMerchantBookingByEditToken({
      bookingId,
      editToken,
    });
    const ics = buildMerchantBookingsCalendarIcs({
      siteId: booking.siteId,
      siteName: booking.siteName,
      bookings: [booking],
    });
    const response = new NextResponse(ics, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "cache-control": "no-store",
      },
    });
    if (download) {
      response.headers.set("content-disposition", `attachment; filename="booking-${booking.id}.ics"`);
    }
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: "booking_customer_calendar_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
