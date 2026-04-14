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

type SelfServiceTokenPayload = {
  bookingId?: unknown;
  editToken?: unknown;
};

function readSelfServiceTokenInput(request: Request, body?: SelfServiceTokenPayload | null) {
  const url = new URL(request.url);
  return {
    bookingId: trimText(body?.bookingId ?? url.searchParams.get("bookingId")),
    editToken: trimText(body?.editToken ?? url.searchParams.get("editToken")),
  };
}

async function resolveSelfServiceBooking(request: Request, body?: SelfServiceTokenPayload | null) {
  const { bookingId, editToken } = readSelfServiceTokenInput(request, body);
  if (!bookingId || !editToken) {
    return {
      ok: false as const,
      response: noStoreJson({ error: "invalid_booking_token" }, { status: 400 }),
    };
  }
  const booking = await getMerchantBookingByEditToken({
    bookingId,
    editToken,
  });
  return {
    ok: true as const,
    booking,
  };
}

export async function GET(request: Request) {
  try {
    const resolved = await resolveSelfServiceBooking(request);
    if (!resolved.ok) {
      return resolved.response;
    }
    return noStoreJson({ ok: true, booking: resolved.booking });
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as SelfServiceTokenPayload | null;
    const resolved = await resolveSelfServiceBooking(request, body);
    if (!resolved.ok) {
      return resolved.response;
    }
    return noStoreJson({ ok: true, booking: resolved.booking });
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
