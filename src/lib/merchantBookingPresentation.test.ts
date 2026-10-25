import assert from "node:assert/strict";
import test from "node:test";
import { bookingDeliveryLabel, bookingScheduleDays, bookingCapacitySummary, mergeBookingDrafts, mergeBookingRefreshRecords } from "./merchantBookingPresentation";
import type { MerchantBookingRecord } from "./merchantBookings";
import type { MerchantBookingRulesSnapshot } from "./merchantBookingRules";

test("refresh and pagination preserve dirty drafts, refresh clean drafts and isolate removed records", () => {
  const previous = [{ id: "dirty", note: "saved" }, { id: "clean", note: "old" }];
  const next = [{ id: "dirty", note: "remote" }, { id: "clean", note: "remote" }, { id: "new", note: "fresh" }];
  const create = (record: typeof previous[number]) => ({ note: record.note });
  assert.deepEqual(mergeBookingDrafts({ dirty: { note: "unsaved" }, clean: { note: "old" }, removed: { note: "other" } }, previous, next, create),
    { dirty: { note: "unsaved" }, clean: { note: "remote" }, new: { note: "fresh" } });
});
test("week boundaries use calendar dates without DST/process timezone arithmetic", () => {
  assert.deepEqual(bookingScheduleDays("2026-10-25", "week"), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.deepEqual(bookingScheduleDays("2026-12-31", "day"), ["2026-12-31"]);
  assert.deepEqual(bookingScheduleDays("2026-02-30", "week"), []);
});
test("refresh retains dirty off-page records but does not inflate the remote offset", () => {
  const before = [{ id: "clean", note: "old" }, { id: "dirty", note: "old" }];
  const incoming = [{ id: "fresh", note: "new" }];
  assert.deepEqual(mergeBookingRefreshRecords(before, incoming, { dirty: { note: "unsaved" } }, (record) => ({ note: record.note })).map((record) => record.id), ["fresh", "dirty"]);
  assert.equal(incoming.length, 1);
});
test("capacity overview counts only open records in the same binding, date and slot", () => {
  const entry = { viewport: "desktop", blockId: "one", timeSlotRules: [{ timeRange: "10:00-11:00", maxBookings: 2 }] };
  const fixture = { id: "one", bookingBlockId: "one", bookingViewport: "desktop", appointmentAt: "2030-01-01T10:30", status: "active" };
  const records = [fixture, { ...fixture, id: "two", status: "confirmed" }, { ...fixture, id: "cancelled", status: "cancelled" }, { ...fixture, bookingViewport: "mobile" }, { ...fixture, appointmentAt: "2030-01-02T10:30" }];
  assert.equal(bookingCapacitySummary(records as MerchantBookingRecord[], "2030-01-01", { entries: [entry] } as MerchantBookingRulesSnapshot)[0].occupied, 2);
});
test("queued, skipped and uncertain delivery are never labelled as sent", () => {
  assert.equal(bookingDeliveryLabel("queued", "zh-CN"), "排队中");
  assert.ok(!bookingDeliveryLabel("skipped", "zh-CN").includes("已发送"));
  assert.equal(bookingDeliveryLabel("unconfirmed", "es-ES"), "sin confirmar");
  assert.equal(bookingDeliveryLabel(undefined, "zh-CN"), "状态未知");
});
