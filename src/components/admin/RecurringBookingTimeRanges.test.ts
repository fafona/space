import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecurringTimeRangeRows,
  recurringTimeOptions,
  serializeRecurringTimeRangeRows,
} from "./RecurringBookingTimeRanges";

test("existing multiple time ranges and exact single times round trip without rewriting", () => {
  const ranges = ["09:07-12:13", "13:00", "19:30-21:00", "23:55-23:59"];
  assert.deepEqual(serializeRecurringTimeRangeRows(createRecurringTimeRangeRows(ranges)), ranges);
});

test("empty and partially selected new rows are not persisted", () => {
  const existing = createRecurringTimeRangeRows(["13:00-18:00"]);
  assert.deepEqual(serializeRecurringTimeRangeRows([
    ...existing, { id: 1, start: "19:30", end: "" }, { id: 2, start: "", end: "21:00" },
  ]), ["13:00-18:00"]);
  assert.deepEqual(serializeRecurringTimeRangeRows(createRecurringTimeRangeRows([])), []);
});

test("complete multiple ranges save, can be edited, and are removed independently", () => {
  const rows = createRecurringTimeRangeRows(["13:00-18:00"]);
  rows.push({ id: 1, start: "19:30", end: "21:00" });
  assert.deepEqual(serializeRecurringTimeRangeRows(rows), ["13:00-18:00", "19:30-21:00"]);
  rows[0].end = "17:00";
  assert.deepEqual(serializeRecurringTimeRangeRows(rows), ["13:00-17:00", "19:30-21:00"]);
  assert.deepEqual(serializeRecurringTimeRangeRows(rows.filter((row) => row.id !== 0)), ["19:30-21:00"]);
  assert.deepEqual(serializeRecurringTimeRangeRows([]), []);
});

test("invalid reversed ranges cannot reach the persisted settings", () => {
  assert.deepEqual(serializeRecurringTimeRangeRows([{ id: 0, start: "18:00", end: "13:00" }]), []);
});

test("dropdowns span the day and retain existing off-grid minute values", () => {
  const options = recurringTimeOptions("12:13");
  assert.equal(options[0], "00:00");
  assert.equal(options.at(-1), "23:59");
  assert.ok(options.includes("12:10"));
  assert.ok(options.includes("12:13"));
  assert.ok(options.includes("12:15"));
  assert.equal(new Set(options).size, options.length);
  assert.deepEqual(options, [...options].sort());
});
