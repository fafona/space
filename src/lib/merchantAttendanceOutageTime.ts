import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, integer, label, micros, safeTree, stamp } from "./merchantAttendancePlanExceptionValidation";

export type OutageInterval = {
  startAt: string; endAt: string; timeZone: string;
  startOffsetMinutes: number; endOffsetMinutes: number;
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };

// Declared instants, not trusted clock events. Requiring both UTC and offsets
// makes the two occurrences of an autumn local time distinct. The database
// independently validates its own timezone rules and authoritative receipt time.
export function outageOffsetMinutes(instant: string, timeZone: string): number {
  try {
    const at = stamp(instant), zone = label(timeZone, 100);
    if (at < "2000-01-01T00:00:00.000000Z" || at >= "2101-01-01T00:00:00.000000Z") return fail();
    const ms = Date.parse(at.slice(0, 23) + "Z");
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, calendar: "iso8601", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(ms);
    const fields = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const local = Date.parse(`${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}.000Z`);
    return integer((local - Math.floor(ms / 1000) * 1000) / 60000, -840, 840);
  } catch { return fail(); }
}

export function parseOutageInterval(raw: unknown, verifyCurrentOffsets = true): OutageInterval {
  try {
    safeTree(raw, 2048);
    const s = exact(raw, ["startAt", "endAt", "timeZone", "startOffsetMinutes", "endOffsetMinutes"]);
    const startAt = stamp(s.startAt), endAt = stamp(s.endAt), timeZone = label(s.timeZone, 100);
    const startOffsetMinutes = integer(s.startOffsetMinutes, -840, 840), endOffsetMinutes = integer(s.endOffsetMinutes, -840, 840);
    const duration = micros(endAt) - micros(startAt);
    if (duration <= BigInt(0) || duration > BigInt(31 * 86400) * BigInt(1000000)
      || startAt < "2000-01-01T00:00:00.000000Z" || endAt >= "2101-01-01T00:00:00.000000Z") return fail();
    // Immutable history and exact retries retain their original timezone proof.
    // Fresh SQL writes still verify the authoritative database timezone rules.
    if (verifyCurrentOffsets && (outageOffsetMinutes(startAt, timeZone) !== startOffsetMinutes
      || outageOffsetMinutes(endAt, timeZone) !== endOffsetMinutes)) return fail();
    return { startAt, endAt, timeZone, startOffsetMinutes, endOffsetMinutes };
  } catch { return fail(); }
}
