import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { parseCorrectionProposal, type CorrectionProposal } from "./merchantAttendanceCorrection";
import { summarizeAttendanceSessionRecords, type AttendanceSessionResult } from "./merchantAttendanceSession";
import { attendanceTimeZone } from "./merchantAttendanceTime";

export type CorrectionTimeInput = { local: string; offset: string };
export type CorrectionDraft = { start: CorrectionTimeInput; end: CorrectionTimeInput;
  breaks: { start: CorrectionTimeInput; end: CorrectionTimeInput; paid: boolean }[] };
// Native datetime-local accepts milliseconds, not the six-digit ledger precision.
// Display only: retain the full draft until the user explicitly edits this time.
export function correctionTimeControlValue(local:string){return local.replace(/(\.\d{3})\d{1,3}$/, "$1");}
// Explicit offset is essential at the autumn DST fold; never ask Date to guess a wall time.
export function correctionTimeInput(value: string, zone: string): CorrectionTimeInput {
  const instant = attendanceRecordInstant(value);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: attendanceTimeZone(zone), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { local: `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${instant.slice(20, 26)}`,
    offset: part("timeZoneName") === "GMT" ? "+00:00" : part("timeZoneName").replace("GMT", "") };
}
export function parseCorrectionTimeInput(input: CorrectionTimeInput, zone: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(input.local);
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(input.offset);
  if (!match || !offset || +offset[2] > 14 || +offset[3] > 59 || +offset[2] === 14 && +offset[3] !== 0) throw Error("invalid_time");
  const local = `${match[1]}:${match[2] ?? "00"}.${(match[3] ?? "").padEnd(6, "0")}`;
  attendanceRecordInstant(`${local}Z`); // Reject date normalization such as Feb 30.
  const delta = (+offset[2] * 60 + +offset[3]) * (offset[1] === "-" ? -1 : 1);
  const utc = new Date(Date.parse(`${local.slice(0, 23)}Z`) - delta * 60000).toISOString().slice(0, 23) + local.slice(23) + "Z";
  const roundTrip = correctionTimeInput(utc, zone);
  if (roundTrip.local !== local || roundTrip.offset !== input.offset) throw Error("time_zone_offset_mismatch");
  return utc;
}
export function correctionTimeOffsets(local: string, zone: string): string[] {
  // Discover nearby IANA offsets, then require exact wall-time round trips. Never guess at a fold/gap.
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(local)) return [];
    const wall = attendanceRecordInstant(`${local.slice(0, 16)}:00.000000Z`), base = Date.parse(wall);
    const offsets = new Set([-36, -12, 0, 12, 36].map(hours => correctionTimeInput(new Date(base + hours * 3600000).toISOString(), zone).offset));
    return [...offsets].filter(offset => { try { parseCorrectionTimeInput({ local, offset }, zone); return true; } catch { return false; } }).sort();
  } catch { return []; }
}
export function correctionDraftFromBasis(basis: AttendanceSessionResult): CorrectionDraft {
  const r = summarizeAttendanceSessionRecords(basis), convert = (s: string) => correctionTimeInput(s, r.timeZone);
  const empty = { local: "", offset: convert(r.startAt).offset };
  return { start: convert(r.startAt), end: r.endAt ? convert(r.endAt) : { ...empty },
    breaks: [...r.breaks.map(b => ({ start: convert(b.startAt), end: convert(b.endAt), paid: b.paid })),
      ...(r.openBreak ? [{ start: convert(r.openBreak.startAt), end: { ...empty }, paid: r.openBreak.paid }] : [])] };
}
export function correctionDraftProposal(draft: CorrectionDraft, zone: string): CorrectionProposal {
  return parseCorrectionProposal({ startAt: parseCorrectionTimeInput(draft.start, zone), endAt: parseCorrectionTimeInput(draft.end, zone),
    breaks: draft.breaks.map(b => ({ startAt: parseCorrectionTimeInput(b.start, zone), endAt: parseCorrectionTimeInput(b.end, zone), paid: b.paid })) });
}
