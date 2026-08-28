import type { MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import {
  readMerchantBookingTrustedBusinessProjection,
  type MerchantBookingRecord,
} from "@/lib/merchantBookings";

export function getMerchantBookingMutationRequiredPermissions(input: {
  status?: unknown;
  updates?: unknown;
  bookingBlockId?: unknown;
  bookingViewport?: unknown;
  sendCustomerEmail?: unknown;
  markTouched?: unknown;
  bookingIds?: unknown;
}): MerchantStaffBusinessPermission[] | null {
  const permissions: MerchantStaffBusinessPermission[] = [];
  if (input.sendCustomerEmail === true) {
    permissions.push("bookings.email.send");
  }
  if (input.markTouched === true) permissions.push("bookings.view");
  if (
    input.status !== undefined &&
    input.status !== null &&
    input.status !== ""
  ) {
    permissions.push("bookings.status.manage");
  }
  if (
    input.updates !== undefined ||
    input.bookingBlockId !== undefined ||
    input.bookingViewport !== undefined
  ) {
    permissions.push("bookings.update");
  }
  if (Array.isArray(input.bookingIds) && input.bookingIds.length > 0) {
    permissions.push("bookings.status.manage");
  }
  return permissions.length > 0
    ? Array.from(new Set(permissions))
    : null;
}

export function redactMerchantBookingForBusinessActor(
  booking: MerchantBookingRecord,
  actor: Pick<MerchantBusinessActor, "type" | "businessPermissions">,
): MerchantBookingRecord {
  if (
    actor.type === "owner" ||
    actor.businessPermissions.includes("bookings.customer_data.view")
  ) {
    return booking;
  }
  const trustedProjection =
    readMerchantBookingTrustedBusinessProjection(booking);
  return {
    ...booking,
    siteName: trustedProjection?.siteName ?? "",
    store: trustedProjection?.store ?? "",
    item: trustedProjection?.item ?? "",
    title: trustedProjection?.title ?? "",
    customerName: booking.customerName ? "客户" : "",
    email: "",
    phone: "",
    note: "",
    customerAccountId: "",
    customerUserId: "",
    customerLoginEmail: "",
    customerGuestHash: "",
    customerEmailLogs: [],
    timeline: booking.timeline?.map((entry) => ({
      ...entry,
      subject: undefined,
      senderName: undefined,
      note: undefined,
    })),
  };
}

export function redactMerchantBookingsForBusinessActor(
  bookings: MerchantBookingRecord[],
  actor: Pick<MerchantBusinessActor, "type" | "businessPermissions">,
) {
  return bookings.map((booking) =>
    redactMerchantBookingForBusinessActor(booking, actor),
  );
}
