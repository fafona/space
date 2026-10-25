import { NextResponse } from "next/server";
import { getMerchantBookingSelfServiceDetails } from "@/lib/merchantBookings.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cross-origin-resource-policy", "same-origin");
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
  const details = await getMerchantBookingSelfServiceDetails({
    bookingId,
    editToken,
  });
  return {
    ok: true as const,
    details,
  };
}

export async function GET(request: Request) {
  try {
    const resolved = await resolveSelfServiceBooking(request);
    if (!resolved.ok) {
      return resolved.response;
    }
    return noStoreJson({ ok: true, ...resolved.details });
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
    return noStoreJson({ ok: true, ...resolved.details });
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
