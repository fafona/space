import { NextResponse } from "next/server";
import { buildMerchantBookingsCalendarIcs } from "@/lib/merchantBookingCalendar";
import { getMerchantBookingByEditToken } from "@/lib/merchantBookings.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type CustomerCalendarPayload = {
  bookingId?: unknown;
  editToken?: unknown;
  download?: unknown;
};

function readCustomerCalendarInput(request: Request, body?: CustomerCalendarPayload | null) {
  const url = new URL(request.url);
  return {
    bookingId: trimText(body?.bookingId ?? url.searchParams.get("bookingId")),
    editToken: trimText(body?.editToken ?? url.searchParams.get("editToken")),
    download: body?.download === true || url.searchParams.get("download") === "1",
  };
}

async function buildCalendarResponse(request: Request, body?: CustomerCalendarPayload | null) {
  const { bookingId, editToken, download } = readCustomerCalendarInput(request, body);
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
}

export async function GET(request: Request) {
  try {
    return await buildCalendarResponse(request);
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CustomerCalendarPayload | null;
    return await buildCalendarResponse(request, body);
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
