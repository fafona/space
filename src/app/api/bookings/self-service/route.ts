import { NextResponse } from "next/server";
import { getMerchantBookingByEditToken } from "@/lib/merchantBookings.server";

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
  try {
    const { searchParams } = new URL(request.url);
    const bookingId = trimText(searchParams.get("bookingId"));
    const editToken = trimText(searchParams.get("editToken"));
    if (!bookingId || !editToken) {
      return noStoreJson({ error: "invalid_booking_token" }, { status: 400 });
    }
    const booking = await getMerchantBookingByEditToken({
      bookingId,
      editToken,
    });
    return noStoreJson({ ok: true, booking });
  } catch (error) {
    return noStoreJson(
      {
        error: "booking_self_service_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
