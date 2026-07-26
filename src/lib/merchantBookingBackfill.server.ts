import type {
  MerchantBookingStatus,
  MerchantBookingStoredRecord,
} from "@/lib/merchantBookings";
import { MERCHANT_BOOKING_STATUSES } from "@/lib/merchantBookings";
import {
  buildMerchantBookingV1Mutation,
  type MerchantBookingV1Mutation,
} from "@/lib/merchantBookingsV1";

export const MERCHANT_BOOKING_BACKFILL_DEFAULT_BATCH_SIZE = 25;
export const MERCHANT_BOOKING_BACKFILL_MAX_BATCH_SIZE = 100;

export type MerchantBookingBackfillBlocker = {
  code:
    | "merchant_mismatch"
    | "missing_booking_id"
    | "duplicate_booking_id"
    | "invalid_status"
    | "invalid_appointment_at"
    | "invalid_created_at"
    | "invalid_updated_at"
    | "invalid_merchant_touched_at"
    | "invalid_no_show_marked_at"
    | "invalid_timeline_at"
    | "duplicate_timeline_event_id";
  bookingId: string;
};

export type MerchantBookingBackfillPlan = {
  merchantId: string;
  batchSize: number;
  bookingCount: number;
  batches: MerchantBookingV1Mutation[][];
  blockers: MerchantBookingBackfillBlocker[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTimestamp(value: unknown, optional = false) {
  const text = trimText(value);
  if (!text) return optional;
  return Number.isFinite(Date.parse(text));
}

function isValidLocalAppointment(value: unknown) {
  const text = trimText(value);
  const matched = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

export function normalizeMerchantBookingBackfillBatchSize(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return MERCHANT_BOOKING_BACKFILL_DEFAULT_BATCH_SIZE;
  return Math.min(
    MERCHANT_BOOKING_BACKFILL_MAX_BATCH_SIZE,
    Math.max(1, parsed),
  );
}

function compareBookings(
  left: MerchantBookingStoredRecord,
  right: MerchantBookingStoredRecord,
) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function pushBlocker(
  blockers: MerchantBookingBackfillBlocker[],
  bookingId: string,
  code: MerchantBookingBackfillBlocker["code"],
) {
  if (
    blockers.some(
      (blocker) => blocker.bookingId === bookingId && blocker.code === code,
    )
  ) {
    return;
  }
  blockers.push({ bookingId, code });
}

export function buildMerchantBookingBackfillPlan(input: {
  merchantId: string;
  bookings: MerchantBookingStoredRecord[];
  batchSize?: unknown;
}): MerchantBookingBackfillPlan {
  const merchantId = trimText(input.merchantId);
  const batchSize = normalizeMerchantBookingBackfillBatchSize(input.batchSize);
  const bookings = [...(Array.isArray(input.bookings) ? input.bookings : [])].sort(
    compareBookings,
  );
  const blockers: MerchantBookingBackfillBlocker[] = [];
  const bookingIds = new Set<string>();

  for (const booking of bookings) {
    const bookingId = trimText(booking?.id);
    if (trimText(booking?.siteId) !== merchantId) {
      pushBlocker(blockers, bookingId, "merchant_mismatch");
    }
    if (!bookingId) {
      pushBlocker(blockers, bookingId, "missing_booking_id");
    } else if (bookingIds.has(bookingId)) {
      pushBlocker(blockers, bookingId, "duplicate_booking_id");
    } else {
      bookingIds.add(bookingId);
    }
    if (
      !MERCHANT_BOOKING_STATUSES.includes(
        booking.status as MerchantBookingStatus,
      )
    ) {
      pushBlocker(blockers, bookingId, "invalid_status");
    }
    if (!isValidLocalAppointment(booking.appointmentAt)) {
      pushBlocker(blockers, bookingId, "invalid_appointment_at");
    }
    if (!isValidTimestamp(booking.createdAt)) {
      pushBlocker(blockers, bookingId, "invalid_created_at");
    }
    if (!isValidTimestamp(booking.updatedAt)) {
      pushBlocker(blockers, bookingId, "invalid_updated_at");
    }
    if (!isValidTimestamp(booking.merchantTouchedAt, true)) {
      pushBlocker(blockers, bookingId, "invalid_merchant_touched_at");
    }
    if (!isValidTimestamp(booking.noShowMarkedAt, true)) {
      pushBlocker(blockers, bookingId, "invalid_no_show_marked_at");
    }

    const timelineIds = new Set<string>();
    const timeline = Array.isArray(booking.timeline) ? booking.timeline : [];
    for (const entry of timeline) {
      const eventId = trimText(entry?.id);
      if (eventId && timelineIds.has(eventId)) {
        pushBlocker(blockers, bookingId, "duplicate_timeline_event_id");
      } else if (eventId) {
        timelineIds.add(eventId);
      }
      if (!isValidTimestamp(entry?.at)) {
        pushBlocker(blockers, bookingId, "invalid_timeline_at");
      }
    }
  }

  const mutations = bookings.map(buildMerchantBookingV1Mutation);
  const batches: MerchantBookingV1Mutation[][] = [];
  for (let index = 0; index < mutations.length; index += batchSize) {
    batches.push(mutations.slice(index, index + batchSize));
  }

  return {
    merchantId,
    batchSize,
    bookingCount: bookings.length,
    batches,
    blockers,
  };
}
