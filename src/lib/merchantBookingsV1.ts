import { createHash } from "node:crypto";

import type {
  MerchantBookingStoredRecord,
  MerchantBookingTimelineEntry,
} from "@/lib/merchantBookings";

export type MerchantBookingCustomerV1Payload = {
  merchant_id: string;
  account_id: string | null;
  auth_user_id: string | null;
  guest_hash: string | null;
  email: string | null;
  phone: string | null;
  display_name: string;
  profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MerchantBookingV1Payload = {
  merchant_id: string;
  id: string;
  site_name: string;
  booking_block_id: string;
  booking_viewport: "desktop" | "mobile" | null;
  status: MerchantBookingStoredRecord["status"];
  store: string;
  item: string;
  appointment_at_local: string;
  title: string;
  customer_snapshot: Record<string, unknown>;
  note: string;
  source_snapshot: Record<string, unknown>;
  merchant_touched_at: string | null;
  no_show_marked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MerchantBookingEventV1Payload = {
  event_id: string;
  event_type: string;
  actor: string;
  from_status: string | null;
  to_status: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type MerchantBookingV1Mutation = {
  customer: MerchantBookingCustomerV1Payload | null;
  booking: MerchantBookingV1Payload;
  events: MerchantBookingEventV1Payload[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lowerEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function validTimestamp(value: unknown, fallback: string) {
  const text = trimText(value);
  return text && Number.isFinite(Date.parse(text)) ? text : fallback;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function sanitizeMerchantBookingV1SourceSnapshot(
  record: MerchantBookingStoredRecord,
): Record<string, unknown> {
  const { editToken, ...snapshot } = record;
  void editToken;
  return snapshot;
}

export function buildMerchantBookingCustomerV1Payload(
  record: MerchantBookingStoredRecord,
): MerchantBookingCustomerV1Payload | null {
  const accountId = trimText(record.customerAccountId);
  const authUserId = trimText(record.customerUserId);
  const guestHash = trimText(record.customerGuestHash);
  const email = lowerEmail(record.customerLoginEmail) || lowerEmail(record.email);
  const phone = trimText(record.phone);
  if (!accountId && !authUserId && !guestHash && !email && !phone) return null;

  return {
    merchant_id: trimText(record.siteId),
    account_id: accountId || null,
    auth_user_id: authUserId || null,
    guest_hash: guestHash || null,
    email: email || null,
    phone: phone || null,
    display_name: trimText(record.customerName),
    profile: {
      bookingContact: {
        name: trimText(record.customerName),
        email: lowerEmail(record.email),
        phone,
      },
      lastLegacyBookingId: trimText(record.id),
    },
    created_at: validTimestamp(record.createdAt, new Date(0).toISOString()),
    updated_at: validTimestamp(record.updatedAt, record.createdAt),
  };
}

function normalizeTimelineEvent(
  record: MerchantBookingStoredRecord,
  entry: MerchantBookingTimelineEntry,
  index: number,
): MerchantBookingEventV1Payload {
  const entryFingerprint = hashJson(entry);
  const eventId = trimText(entry.id) || `timeline-${index + 1}-${entryFingerprint}`;
  return {
    event_id: eventId,
    event_type: trimText(entry.kind) || "legacy_timeline",
    actor: trimText(entry.actor) || "system",
    from_status: trimText(entry.fromStatus) || null,
    to_status: trimText(entry.toStatus) || null,
    idempotency_key: `legacy-booking-timeline:${record.siteId}:${record.id}:${eventId}`,
    payload: { ...entry, fingerprint: entryFingerprint },
    created_at: validTimestamp(entry.at, record.updatedAt),
  };
}

export function buildMerchantBookingV1Mutation(
  record: MerchantBookingStoredRecord,
): MerchantBookingV1Mutation {
  const sourceSnapshot = sanitizeMerchantBookingV1SourceSnapshot(record);
  const fingerprint = hashJson(sourceSnapshot);
  const timeline = Array.isArray(record.timeline) ? record.timeline : [];
  const events = timeline.map((entry, index) => normalizeTimelineEvent(record, entry, index));
  events.push({
    event_id: `snapshot-${fingerprint}`,
    event_type: "legacy_snapshot_synced",
    actor: "legacy-booking-bridge",
    from_status: null,
    to_status: record.status,
    idempotency_key: `legacy-booking-snapshot:${record.siteId}:${record.id}:${fingerprint}`,
    payload: {
      fingerprint,
      legacyUpdatedAt: record.updatedAt,
    },
    created_at: validTimestamp(record.updatedAt, record.createdAt),
  });

  return {
    customer: buildMerchantBookingCustomerV1Payload(record),
    booking: {
      merchant_id: trimText(record.siteId),
      id: trimText(record.id),
      site_name: trimText(record.siteName),
      booking_block_id: trimText(record.bookingBlockId),
      booking_viewport:
        record.bookingViewport === "desktop" || record.bookingViewport === "mobile"
          ? record.bookingViewport
          : null,
      status: record.status,
      store: trimText(record.store),
      item: trimText(record.item),
      appointment_at_local: trimText(record.appointmentAt),
      title: trimText(record.title),
      customer_snapshot: {
        accountId: trimText(record.customerAccountId),
        userId: trimText(record.customerUserId),
        loginEmail: lowerEmail(record.customerLoginEmail),
        guestHash: trimText(record.customerGuestHash),
        name: trimText(record.customerName),
        email: lowerEmail(record.email),
        phone: trimText(record.phone),
      },
      note: trimText(record.note),
      source_snapshot: sourceSnapshot,
      merchant_touched_at: trimText(record.merchantTouchedAt) || null,
      no_show_marked_at: trimText(record.noShowMarkedAt) || null,
      created_at: validTimestamp(record.createdAt, new Date(0).toISOString()),
      updated_at: validTimestamp(record.updatedAt, record.createdAt),
    },
    events,
  };
}
