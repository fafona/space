import assert from "node:assert/strict";
import test from "node:test";
import { outageOffsetMinutes, parseOutageInterval } from "./merchantAttendanceOutageTime";

const interval = () => ({ startAt: "2026-10-07T07:00:00.000001Z", endAt: "2026-10-07T08:00:00.999999Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 });

test("outage declarations retain exact UTC microseconds and explicit offsets without trusted clock claims", () => {
  assert.deepEqual(parseOutageInterval(interval()), interval());
  assert.equal(outageOffsetMinutes("2026-01-01T10:00:00.000000Z", "Europe/Madrid"), 60);
  assert.equal(outageOffsetMinutes("2026-01-01T10:00:00.000000Z", "Asia/Kathmandu"), 345);
  assert.equal(outageOffsetMinutes("2026-01-01T10:00:00.000000Z", "Pacific/Kiritimati"), 840);
  assert.equal(outageOffsetMinutes("2026-01-01T10:00:00.000000Z", "America/St_Johns"), -210);
  assert.equal(outageOffsetMinutes("2026-01-01T00:00:00.000000Z", "UTC"), 0);
});

test("autumn repeated hour is disambiguated by distinct UTC endpoints and differing offsets", () => {
  const span = { startAt: "2026-10-25T00:30:00.000000Z", endAt: "2026-10-25T01:30:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 60 };
  assert.deepEqual(parseOutageInterval(span), span);
  assert.throws(() => parseOutageInterval({ ...span, endOffsetMinutes: 120 }));
  assert.throws(() => parseOutageInterval({ ...span, startOffsetMinutes: 60 }));
});

test("spring clock skip cannot be represented with an impossible old offset", () => {
  const span = { startAt: "2026-03-29T00:30:00.000000Z", endAt: "2026-03-29T01:30:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 60, endOffsetMinutes: 120 };
  assert.deepEqual(parseOutageInterval(span), span);
  assert.throws(() => parseOutageInterval({ ...span, endOffsetMinutes: 60 }));
});

test("interval must be positive, bounded to 31 days, and canonical UTC6", () => {
  const startAt = "2026-10-01T00:00:00.000000Z", endAt = "2026-11-01T00:00:00.000000Z";
  assert.doesNotThrow(() => parseOutageInterval({ startAt, endAt, timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 }));
  assert.throws(() => parseOutageInterval({ startAt, endAt: "2026-11-01T00:00:00.000001Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 }));
  for (const patch of [{ endAt: interval().startAt }, { endAt: "2026-10-06T08:00:00.000000Z" }, { startAt: "2026-02-30T07:00:00.000001Z" },
    { startAt: "2026-10-07T07:00:00.000Z" }, { startAt: "2026-10-07T09:00:00.000001+02:00" }, { timeZone: "Bad/Zone" }, { timeZone: " Europe/Madrid" },
    { startOffsetMinutes: 120.5 }, { startOffsetMinutes: "120" }, { endOffsetMinutes: -0 }, { endOffsetMinutes: 841 }, { pin: "secret" }]) {
    assert.throws(() => parseOutageInterval({ ...interval(), ...patch }));
  }
  for (const instant of ["1999-12-31T00:00:00.000000Z", "2101-01-01T00:00:00.000000Z"]) assert.throws(() => outageOffsetMinutes(instant, "UTC"));
});

test("strict tree rejects getters, sparse inputs and oversized timezone labels", () => {
  let invoked = false;
  assert.throws(() => parseOutageInterval({ ...interval(), get startAt() { invoked = true; return interval().startAt; } }));
  assert.equal(invoked, false);
  for (const raw of [null, [], { ...interval(), timeZone: "a".repeat(101) }, { ...interval(), timeZone: "\ud800" }]) assert.throws(() => parseOutageInterval(raw));
});
