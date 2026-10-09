import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceDayUtcRange, attendanceInstant, attendanceLocalDate, attendanceTimeZone,
  MerchantAttendanceError, splitAttendanceIntervalByDay,
} from "./merchantAttendanceTime";

const error = (code: string) => (value: unknown) => value instanceof MerchantAttendanceError && value.code === code;

for (const value of ["2026-02-30T00:00:00.000Z", "2026-09-29", "2026-09-29T09:00:00", "2026-09-29T09:00:00+02:00", "", "2026-13-01T00:00:00.000Z"]) {
  test(`rejects noncanonical instant ${JSON.stringify(value)}`, () => assert.throws(() => attendanceInstant(value), error("attendance_invalid_instant")));
}
for (const zone of ["", "local", "+02:00", "Madrid", "Europe/Fake", "Europe/Madrid "]) {
  test(`rejects invalid/implicit zone ${JSON.stringify(zone)}`, () => assert.throws(() => attendanceTimeZone(zone), error("attendance_invalid_time_zone")));
}

for (const [date, hours, start, end] of [
  ["2026-03-29", 23, "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
  ["2026-10-25", 25, "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
  ["2026-09-29", 24, "2026-09-28T22:00:00.000Z", "2026-09-29T22:00:00.000Z"],
] as const) {
  test(`Madrid ${date} is ${hours} actual hours`, () => assert.deepEqual(attendanceDayUtcRange(date, "Europe/Madrid"),
    { startAt: start, endAt: end, durationMs: hours * 3_600_000 }));
}

test("UTC, fractional offsets and midnight DST shifts have correct boundaries", () => {
  assert.equal(attendanceDayUtcRange("2026-09-29", "UTC").startAt, "2026-09-29T00:00:00.000Z");
  assert.equal(attendanceDayUtcRange("2026-09-29", "Asia/Kathmandu").startAt, "2026-09-28T18:15:00.000Z");
  const day = attendanceDayUtcRange("2026-09-06", "America/Santiago");
  assert.equal(day.durationMs, 23 * 3_600_000);
  assert.equal(attendanceLocalDate(day.startAt, "America/Santiago"), "2026-09-06");
});

test("a skipped civil date is rejected rather than silently assigned another day", () => {
  assert.throws(() => attendanceDayUtcRange("2011-12-30", "Pacific/Apia"), error("attendance_local_date_does_not_exist"));
});

for (const date of ["2026-02-29", "2026-02-30", "2026-9-1", "1999-12-31", "2101-01-01"]) {
  test(`rejects invalid/out-of-range civil date ${date}`, () => assert.throws(() => attendanceDayUtcRange(date, "UTC"), error("attendance_invalid_date")));
}

test("fall-back repeated hour measures actual elapsed time, not wall-clock subtraction", () => {
  const parts = splitAttendanceIntervalByDay("2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z", "Europe/Madrid");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].durationMs, 3_600_000);
});

test("half-open midnight boundaries never double count", () => {
  const start = "2026-09-28T22:00:00.000Z", end = "2026-09-29T22:00:00.000Z";
  const parts = splitAttendanceIntervalByDay(start, end, "Europe/Madrid");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].date, "2026-09-29");
  assert.equal(parts[0].durationMs, 86_400_000);
  assert.deepEqual(splitAttendanceIntervalByDay(start, start, "Europe/Madrid"), []);
});

test("bounds splitting work and rejects reversed intervals", () => {
  assert.throws(() => splitAttendanceIntervalByDay("2026-09-29T00:00:00.000Z", "2026-09-28T00:00:00.000Z", "UTC"), error("attendance_interval_out_of_bounds"));
  assert.throws(() => splitAttendanceIntervalByDay("2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z", "UTC"), error("attendance_interval_out_of_bounds"));
});

test("sum of local slices equals elapsed UTC time across zones and DST boundaries", () => {
  for (const zone of ["UTC", "Europe/Madrid", "America/New_York", "Australia/Lord_Howe", "Pacific/Apia"]) {
    for (const date of ["2026-03-28", "2026-10-24", "2026-04-04"]) {
      const start = `${date}T20:15:00.000Z`;
      const end = new Date(Date.parse(start) + 55 * 3_600_000).toISOString();
      const pieces = splitAttendanceIntervalByDay(start, end, zone);
      assert.equal(pieces.reduce((total, piece) => total + piece.durationMs, 0), 55 * 3_600_000);
      for (let index = 1; index < pieces.length; index++) assert.equal(pieces[index - 1].endAt, pieces[index].startAt);
    }
  }
});
