import { isDeepStrictEqual } from "node:util";

import type { MerchantBookingStoredRecord } from "@/lib/merchantBookings";
import {
  buildMerchantBookingV1Mutation,
  sanitizeMerchantBookingV1SourceSnapshot,
} from "@/lib/merchantBookingsV1";

export type MerchantBookingV1Row = {
  merchant_id?: unknown;
  id?: unknown;
  customer_id?: unknown;
  site_name?: unknown;
  booking_block_id?: unknown;
  booking_viewport?: unknown;
  status?: unknown;
  store?: unknown;
  item?: unknown;
  appointment_at_local?: unknown;
  title?: unknown;
  note?: unknown;
  source_snapshot?: unknown;
  merchant_touched_at?: unknown;
  no_show_marked_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export type MerchantBookingEventV1Row = {
  merchant_id?: unknown;
  booking_id?: unknown;
  idempotency_key?: unknown;
};

export type MerchantBookingReconciliationMismatch = {
  bookingId: string;
  fields: string[];
};

export type MerchantBookingReconciliationReport = {
  merchantId: string;
  legacyCount: number;
  v1Count: number;
  matchedCount: number;
  missingInV1: string[];
  unexpectedInV1: string[];
  duplicateV1Ids: string[];
  missingEventKeys: string[];
  mismatches: MerchantBookingReconciliationMismatch[];
  isMatch: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value: unknown) {
  const text = trimText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampsMatch(left: unknown, right: unknown) {
  const leftTimestamp = normalizeTimestamp(left);
  const rightTimestamp = normalizeTimestamp(right);
  if (leftTimestamp === null || rightTimestamp === null) {
    return leftTimestamp === rightTimestamp;
  }
  return Math.abs(leftTimestamp - rightTimestamp) < 1000;
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function readV1SourceUpdatedAt(row: MerchantBookingV1Row) {
  const snapshot = row.source_snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const sourceUpdatedAt = (snapshot as { updatedAt?: unknown }).updatedAt;
    if (trimText(sourceUpdatedAt)) return sourceUpdatedAt;
  }
  return row.updated_at;
}

function normalizeLegacyBookings(
  merchantId: string,
  records: MerchantBookingStoredRecord[],
) {
  const map = new Map<string, MerchantBookingStoredRecord>();
  for (const record of Array.isArray(records) ? records : []) {
    if (trimText(record?.siteId) !== merchantId) continue;
    const bookingId = trimText(record?.id);
    if (!bookingId) continue;
    const current = map.get(bookingId);
    if (
      !current ||
      (normalizeTimestamp(record.updatedAt) ?? 0) >=
        (normalizeTimestamp(current.updatedAt) ?? 0)
    ) {
      map.set(bookingId, record);
    }
  }
  return map;
}

function normalizeV1Bookings(merchantId: string, rows: MerchantBookingV1Row[]) {
  const map = new Map<string, MerchantBookingV1Row>();
  const duplicates = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trimText(row?.merchant_id) !== merchantId) continue;
    const bookingId = trimText(row?.id);
    if (!bookingId) continue;
    if (map.has(bookingId)) duplicates.add(bookingId);
    map.set(bookingId, row);
  }
  return { map, duplicates: [...duplicates].sort() };
}

function normalizeEventKeys(
  merchantId: string,
  rows: MerchantBookingEventV1Row[],
) {
  const keys = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trimText(row?.merchant_id) !== merchantId) continue;
    const bookingId = trimText(row?.booking_id);
    const key = trimText(row?.idempotency_key);
    if (bookingId && key) keys.add(`${bookingId}:${key}`);
  }
  return keys;
}

function hasStableCustomerIdentity(record: MerchantBookingStoredRecord) {
  return Boolean(
    trimText(record.customerAccountId) ||
      trimText(record.customerUserId) ||
      trimText(record.customerGuestHash) ||
      trimText(record.customerLoginEmail) ||
      trimText(record.email) ||
      trimText(record.phone),
  );
}

function compareBooking(
  legacy: MerchantBookingStoredRecord,
  v1: MerchantBookingV1Row,
) {
  const fields: string[] = [];
  if (trimText(v1.site_name) !== trimText(legacy.siteName)) fields.push("siteName");
  if (trimText(v1.booking_block_id) !== trimText(legacy.bookingBlockId)) {
    fields.push("bookingBlockId");
  }
  if (trimText(v1.booking_viewport) !== trimText(legacy.bookingViewport)) {
    fields.push("bookingViewport");
  }
  if (trimText(v1.status) !== legacy.status) fields.push("status");
  if (trimText(v1.store) !== trimText(legacy.store)) fields.push("store");
  if (trimText(v1.item) !== trimText(legacy.item)) fields.push("item");
  if (trimText(v1.appointment_at_local) !== trimText(legacy.appointmentAt)) {
    fields.push("appointmentAt");
  }
  if (trimText(v1.title) !== trimText(legacy.title)) fields.push("title");
  if (trimText(v1.note) !== trimText(legacy.note)) fields.push("note");
  if (!timestampsMatch(v1.created_at, legacy.createdAt)) fields.push("createdAt");
  if (!timestampsMatch(readV1SourceUpdatedAt(v1), legacy.updatedAt)) {
    fields.push("updatedAt");
  }
  if (!timestampsMatch(v1.merchant_touched_at, legacy.merchantTouchedAt)) {
    fields.push("merchantTouchedAt");
  }
  if (!timestampsMatch(v1.no_show_marked_at, legacy.noShowMarkedAt)) {
    fields.push("noShowMarkedAt");
  }
  if (
    !isDeepStrictEqual(
      normalizeJson(v1.source_snapshot),
      normalizeJson(sanitizeMerchantBookingV1SourceSnapshot(legacy)),
    )
  ) {
    fields.push("sourceSnapshot");
  }
  if (hasStableCustomerIdentity(legacy) && !trimText(v1.customer_id)) {
    fields.push("customerLink");
  }
  return fields;
}

export function reconcileMerchantBookingStorage(input: {
  merchantId: string;
  legacyBookings: MerchantBookingStoredRecord[];
  v1Bookings: MerchantBookingV1Row[];
  v1Events: MerchantBookingEventV1Row[];
}): MerchantBookingReconciliationReport {
  const merchantId = trimText(input.merchantId);
  const legacyMap = normalizeLegacyBookings(merchantId, input.legacyBookings);
  const normalizedV1 = normalizeV1Bookings(merchantId, input.v1Bookings);
  const v1Map = normalizedV1.map;
  const eventKeys = normalizeEventKeys(merchantId, input.v1Events);
  const missingInV1 = [...legacyMap.keys()]
    .filter((bookingId) => !v1Map.has(bookingId))
    .sort();
  const unexpectedInV1 = [...v1Map.keys()]
    .filter((bookingId) => !legacyMap.has(bookingId))
    .sort();
  const missingEventKeys: string[] = [];
  const mismatches: MerchantBookingReconciliationMismatch[] = [];
  let matchedCount = 0;

  for (const [bookingId, legacy] of legacyMap.entries()) {
    const v1 = v1Map.get(bookingId);
    if (!v1) continue;
    const fields = compareBooking(legacy, v1);
    const expectedEvents = buildMerchantBookingV1Mutation(legacy).events;
    for (const event of expectedEvents) {
      if (!eventKeys.has(`${bookingId}:${event.idempotency_key}`)) {
        missingEventKeys.push(event.idempotency_key);
      }
    }
    if (fields.length > 0) {
      mismatches.push({ bookingId, fields });
    } else {
      matchedCount += 1;
    }
  }

  mismatches.sort((left, right) => left.bookingId.localeCompare(right.bookingId));
  missingEventKeys.sort();
  return {
    merchantId,
    legacyCount: legacyMap.size,
    v1Count: v1Map.size,
    matchedCount,
    missingInV1,
    unexpectedInV1,
    duplicateV1Ids: normalizedV1.duplicates,
    missingEventKeys,
    mismatches,
    isMatch:
      missingInV1.length === 0 &&
      unexpectedInV1.length === 0 &&
      normalizedV1.duplicates.length === 0 &&
      missingEventKeys.length === 0 &&
      mismatches.length === 0,
  };
}
