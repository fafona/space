import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantBookingRecord, MerchantBookingStatus } from "@/lib/merchantBookings";
import {
  filterMerchantBookingRecordsByHistory,
  normalizeMerchantBookingManagerPreferences,
  sortMerchantBookingRecords,
} from "@/lib/merchantBookingManagerPreferences";

function createRecord(
  id: string,
  appointmentAt: string,
  createdAt: string,
  status: MerchantBookingStatus = "confirmed",
): MerchantBookingRecord {
  return {
    id,
    siteId: "10000000",
    siteName: "faolla",
    store: "store",
    item: "item",
    appointmentAt,
    title: "",
    customerName: "Tester",
    email: "tester@example.com",
    phone: "123456",
    note: "",
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

test("history visibility hides bookings older than the selected threshold", () => {
  const records = [
    createRecord("old", "2026-04-05T10:00", "2026-04-01T08:00:00.000Z"),
    createRecord("edge", "2026-04-08T10:00", "2026-04-02T08:00:00.000Z"),
    createRecord("fresh", "2026-04-15T10:00", "2026-04-03T08:00:00.000Z"),
  ];

  const visible = filterMerchantBookingRecordsByHistory(records, "7d", new Date("2026-04-15T12:00:00"));

  assert.deepEqual(
    visible.map((record) => record.id),
    ["edge", "fresh"],
  );
});

test("appointment sort keeps earlier appointment times first", () => {
  const records = [
    createRecord("late", "2026-04-15T11:00", "2026-04-10T08:00:00.000Z"),
    createRecord("early", "2026-04-15T09:00", "2026-04-09T08:00:00.000Z"),
    createRecord("next-day", "2026-04-16T09:00", "2026-04-08T08:00:00.000Z"),
  ];

  const sorted = sortMerchantBookingRecords(records, "appointment");

  assert.deepEqual(
    sorted.map((record) => record.id),
    ["early", "late", "next-day"],
  );
});

test("submitted sort keeps newest submissions first and normalizes invalid preferences", () => {
  const records = [
    createRecord("older", "2026-04-15T11:00", "2026-04-10T08:00:00.000Z"),
    createRecord("newer", "2026-04-15T09:00", "2026-04-12T08:00:00.000Z"),
  ];

  const sorted = sortMerchantBookingRecords(records, "submitted");

  assert.deepEqual(
    sorted.map((record) => record.id),
    ["newer", "older"],
  );

  assert.deepEqual(normalizeMerchantBookingManagerPreferences({}), {
    selectedStatuses: ["active", "confirmed", "completed", "no_show", "cancelled"],
    sortMode: "appointment",
    historyVisibility: "7d",
  });

  assert.deepEqual(
    normalizeMerchantBookingManagerPreferences({
      selectedStatuses: ["confirmed", "invalid"],
      sortMode: "submitted",
      historyVisibility: "none",
    }),
    {
      selectedStatuses: ["confirmed"],
      sortMode: "submitted",
      historyVisibility: "none",
    },
  );
});
