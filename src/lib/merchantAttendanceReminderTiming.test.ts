import test from "node:test";
import assert from "node:assert/strict";
import { reminderDeferredUntil, reminderTiming, reminderTimingAfterDelivery, reminderUtcWindow } from "./merchantAttendanceReminderTiming";
const input = () => ({ anchorAt: "2026-10-08T12:00:00.000001Z", configuration: { mode: "enabled" as const, afterMinutes: 1, repeatMinutes: 60, maxOccurrences: 3 }, deliveredCount: 0, lastDeliveredAt: null });
test("shared reminder timing preserves UTC6 and exact due endpoint", () => {
  const value = input(); assert.deepEqual(reminderTiming(value), { state: "scheduled", ordinal: 1, dueAt: "2026-10-08T12:01:00.000001Z" });
  assert.throws(() => reminderTimingAfterDelivery(value, "2026-10-08T12:01:00.000000Z"));
  assert.deepEqual(reminderTimingAfterDelivery(value, "2026-10-08T12:01:00.000001Z"), { state: "scheduled", ordinal: 2, dueAt: "2026-10-08T13:01:00.000001Z" });
});
test("delayed execution emits one round and waits a complete repeat interval, never catches up", () => {
  assert.deepEqual(reminderTimingAfterDelivery(input(), "2026-10-09T19:43:15.999999Z"), { state: "scheduled", ordinal: 2, dueAt: "2026-10-09T20:43:15.999999Z" });
});
test("max actual occurrences terminates, including max1 first delivery", () => {
  const value = input(); value.configuration.maxOccurrences = 1;
  assert.deepEqual(reminderTimingAfterDelivery(value, "2026-10-08T12:01:00.000001Z"), { state: "exhausted", ordinal: null, dueAt: null });
  assert.throws(() => reminderTimingAfterDelivery({ ...value, deliveredCount: 1, lastDeliveredAt: "2026-10-08T12:01:00.000001Z" }, "2026-10-10T00:00:00.000000Z"));
});
test("disabled is distinct from zero count and rejects fabricated past deliveries", () => {
  const value = { ...input(), configuration: { mode: "disabled" } };
  assert.deepEqual(reminderTiming(value), { state: "disabled", ordinal: null, dueAt: null });
  assert.throws(() => reminderTiming({ ...value, deliveredCount: 1, lastDeliveredAt: "2026-10-08T12:01:00.000001Z" }));
});
test("hourly UTC half-open summary window is independent of civil DST and preserves boundaries", () => {
  assert.deepEqual(reminderUtcWindow("2026-10-25T01:59:59.999999Z"), { fromAt: "2026-10-25T01:00:00.000000Z", toAt: "2026-10-25T02:00:00.000000Z" });
  assert.deepEqual(reminderUtcWindow("2026-10-25T02:00:00.000000Z"), { fromAt: "2026-10-25T02:00:00.000000Z", toAt: "2026-10-25T03:00:00.000000Z" });
  assert.deepEqual(reminderUtcWindow("1969-12-31T23:59:59.999999Z"), { fromAt: "1969-12-31T23:00:00.000000Z", toAt: "1970-01-01T00:00:00.000000Z" });
});
test("an occupied immutable batch defers without spending an occurrence or altering input", () => {
  const value = input(), copy = structuredClone(value);
  assert.equal(reminderDeferredUntil(value, "2026-10-08T12:45:00.999999Z"), "2026-10-08T13:00:00.000000Z");
  assert.deepEqual(value, copy); assert.equal(reminderTiming(value).ordinal, 1);
  assert.throws(() => reminderDeferredUntil(value, "2026-10-08T12:00:00.999999Z"));
});
test("configuration, timing geometry and unsafe object shapes are strict", () => {
  const value = input();
  for (const bad of [{ ...value, injected: true }, { ...value, deliveredCount: -0 }, { ...value, deliveredCount: 1 },
    { ...value, lastDeliveredAt: value.anchorAt }, { ...value, deliveredCount: 1, lastDeliveredAt: value.anchorAt },
    { ...value, deliveredCount: 4, lastDeliveredAt: "2026-10-09T00:00:00.000000Z" },
    { ...value, anchorAt: "2026-02-30T12:00:00.000001Z" }, { ...value, configuration: { ...value.configuration, repeatMinutes: 59 } },
    { ...value, configuration: { ...value.configuration, mode: "enabled", extra: 1 } },
    Object.defineProperty({ ...value }, "anchorAt", { get() { assert.fail("getter must not execute"); }, enumerable: true })]) assert.throws(() => reminderTiming(bad));
});
test("snapshots and outputs are immutable, Gregorian rollover keeps the microsecond", () => {
  const value = { ...input(), anchorAt: "2024-02-29T23:59:00.123456Z" }, result = reminderTiming(value);
  assert.deepEqual(result, { state: "scheduled", ordinal: 1, dueAt: "2024-03-01T00:00:00.123456Z" }); assert(Object.isFrozen(result));
  value.configuration.afterMinutes = 10; assert.equal(result.dueAt, "2024-03-01T00:00:00.123456Z");
});
