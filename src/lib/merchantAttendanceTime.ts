// Attendance arithmetic uses UTC instants and an explicit workplace IANA zone.
// Never use the browser's default zone or silently normalize an invalid date.
export class MerchantAttendanceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MerchantAttendanceError";
  }
}

export function attendanceInstant(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new MerchantAttendanceError("attendance_invalid_instant");
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    throw new MerchantAttendanceError("attendance_invalid_instant");
  }
  return instant;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function attendanceTimeZone(value: string): string {
  // Offset strings are not an authoritative DST-aware workplace time zone.
  if (typeof value !== "string" || value.length > 100 ||
      (value !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value))) {
    throw new MerchantAttendanceError("attendance_invalid_time_zone");
  }
  if (!formatters.has(value)) {
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: value, year: "numeric", month: "2-digit", day: "2-digit",
        calendar: "iso8601", numberingSystem: "latn",
      });
    } catch {
      throw new MerchantAttendanceError("attendance_invalid_time_zone");
    }
    // User-selected zones must not grow a process-wide cache without a bound.
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
    formatters.set(value, formatter);
  }
  return value;
}

function localDateAt(instant: number, timeZone: string): string {
  const fields = formatters.get(attendanceTimeZone(timeZone))!.formatToParts(instant);
  const get = (type: string) => fields.find((field) => field.type === type)!.value;
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

export function attendanceLocalDate(instant: string, timeZone: string): string {
  return localDateAt(attendanceInstant(instant), timeZone);
}

function dateEpoch(date: string): number {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MerchantAttendanceError("attendance_invalid_date");
  }
  const epoch = Date.parse(`${date}T00:00:00.000Z`);
  // Bound operational dates to the supported workforce/calendar horizon.
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== date ||
      date < "2000-01-01" || date > "2100-12-31") {
    throw new MerchantAttendanceError("attendance_invalid_date");
  }
  return epoch;
}

function firstInstantOnOrAfterDate(date: string, guessedMidnight: number, timeZone: string): number {
  // Includes IANA offsets, midnight DST transitions and skipped calendar days.
  let low = guessedMidnight - 36 * 3_600_000;
  let high = guessedMidnight + 36 * 3_600_000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDateAt(middle, timeZone) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function attendanceDayUtcRange(date: string, timeZone: string) {
  attendanceTimeZone(timeZone);
  const midnight = dateEpoch(date);
  const nextMidnight = midnight + 86_400_000;
  const nextDate = new Date(nextMidnight).toISOString().slice(0, 10);
  const start = firstInstantOnOrAfterDate(date, midnight, timeZone);
  if (localDateAt(start, timeZone) !== date) {
    throw new MerchantAttendanceError("attendance_local_date_does_not_exist");
  }
  const end = firstInstantOnOrAfterDate(nextDate, nextMidnight, timeZone);
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), durationMs: end - start };
}

export type AttendanceDayInterval = {
  date: string;
  startAt: string;
  endAt: string;
  durationMs: number;
};

export function splitAttendanceIntervalByDay(startAt: string, endAt: string, timeZone: string): AttendanceDayInterval[] {
  let cursor = attendanceInstant(startAt);
  const end = attendanceInstant(endAt);
  attendanceTimeZone(timeZone);
  if (end < cursor || end - cursor > 31 * 86_400_000) {
    throw new MerchantAttendanceError("attendance_interval_out_of_bounds");
  }
  const result: AttendanceDayInterval[] = [];
  while (cursor < end) {
    const date = localDateAt(cursor, timeZone);
    const boundary = attendanceInstant(attendanceDayUtcRange(date, timeZone).endAt);
    const next = Math.min(end, boundary);
    if (next <= cursor) throw new MerchantAttendanceError("attendance_invalid_day_boundary");
    result.push({ date, startAt: new Date(cursor).toISOString(), endAt: new Date(next).toISOString(), durationMs: next - cursor });
    cursor = next;
  }
  return result;
}
