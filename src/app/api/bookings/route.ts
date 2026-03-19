import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createMerchantBooking, updateMerchantBooking } from "@/lib/merchantBookings.server";
import type { MerchantBookingActionInput, MerchantBookingCreateInput } from "@/lib/merchantBookings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<MerchantBookingCreateInput>;
    const siteId = String(body.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const created = await createMerchantBooking({
      siteId,
      siteName: String(body.siteName ?? "").trim(),
      store: String(body.store ?? ""),
      item: String(body.item ?? ""),
      appointmentAt: String(body.appointmentAt ?? ""),
      title: String(body.title ?? ""),
      customerName: String(body.customerName ?? ""),
      email: String(body.email ?? ""),
      phone: String(body.phone ?? ""),
      note: String(body.note ?? ""),
    });
    return NextResponse.json({ ok: true, ...created });
  } catch (error) {
    return NextResponse.json(
      {
        error: "booking_create_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Partial<MerchantBookingActionInput>;
    const action = body.action === "cancel" ? "cancel" : "update";
    const booking = await updateMerchantBooking({
      bookingId: String(body.bookingId ?? "").trim(),
      editToken: String(body.editToken ?? "").trim(),
      action,
      updates:
        action === "update"
          ? {
              store: String(body.updates?.store ?? ""),
              item: String(body.updates?.item ?? ""),
              appointmentAt: String(body.updates?.appointmentAt ?? ""),
              title: String(body.updates?.title ?? ""),
              customerName: String(body.updates?.customerName ?? ""),
              email: String(body.updates?.email ?? ""),
              phone: String(body.updates?.phone ?? ""),
              note: String(body.updates?.note ?? ""),
            }
          : undefined,
    });
    return NextResponse.json({ ok: true, booking });
  } catch (error) {
    return NextResponse.json(
      {
        error: "booking_update_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
