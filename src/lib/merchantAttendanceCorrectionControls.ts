import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
export type CorrectionPolicy = { submissionWindowDays: number; timeZone: string };
export type CorrectionPeriod = { periodId: string; fromDate: string; throughDate: string; timeZone: string; startAt: string; endAt: string };
export type CorrectionControlCommand = { operationId: string; expectedRevision: number; expectedSettingsVersion: number; reason: string } & (
  { action: "set_policy"; submissionWindowDays: number } |
  { action: "lock_period"; fromDate: string; throughDate: string } |
  { action: "unlock_period"; periodId: string });
export type CorrectionControlEntry = { revision: number; operationId: string; recordedAt: string; reason: string } & (
  { action: "set_policy"; values: CorrectionPolicy } | { action: "lock_period" | "unlock_period"; values: CorrectionPeriod });
export type CorrectionControlQuery = { siteId: string; operationId: string | null; beforeRevision: number | null };
export type CorrectionControlResult = { siteId: string; asOf: string; controlsOnly: true; approvalAvailable: false; rulesEnforced: boolean;
  revision: number; settingsVersion: number; timeZone: string; policy: Extract<CorrectionControlEntry, { action: "set_policy" }> | null;
  activePeriods: (CorrectionPeriod & { revision: number })[]; entries: CorrectionControlEntry[]; nextBeforeRevision: number | null;
  receipt: CorrectionControlEntry | null };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
const exact = (v: Record<string, unknown>, keys: string[]) => { if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(); };
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER - 2) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const reason = (v: unknown) => typeof v === "string" && v.trim() && [...v.trim()].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v.trim() : fail();
const day = (v: unknown) => { if (typeof v !== "string") return fail(); attendanceDayUtcRange(v, "UTC"); return v; };
export function correctionControlDates(from: unknown, through: unknown) {
  const fromDate = day(from), throughDate = day(through);
  if (fromDate > throughDate || Date.parse(throughDate) - Date.parse(fromDate) >= 366 * 86400000) fail();
  return { fromDate, throughDate };
}
export function parseCorrectionControlCommand(raw: unknown): { siteId: string; command: CorrectionControlCommand } {
  const v = object(raw), keys = ["siteId", "operationId", "expectedRevision", "expectedSettingsVersion", "reason", "action"];
  if (v.action === "set_policy") keys.push("submissionWindowDays");
  else if (v.action === "lock_period") keys.push("fromDate", "throughDate");
  else if (v.action === "unlock_period") keys.push("periodId"); else fail();
  exact(v, keys);
  const base = { operationId: attendanceSelfUuid(v.operationId), expectedRevision: integer(v.expectedRevision), expectedSettingsVersion: integer(v.expectedSettingsVersion, 1), reason: reason(v.reason) };
  const command: CorrectionControlCommand = v.action === "set_policy" ? { ...base, action: "set_policy", submissionWindowDays: integer(v.submissionWindowDays, 0, 365) }
    : v.action === "lock_period" ? { ...base, action: "lock_period", ...correctionControlDates(v.fromDate, v.throughDate) }
      : { ...base, action: "unlock_period", periodId: attendanceSelfUuid(v.periodId) };
  return { siteId: attendanceSelfSite(v.siteId), command };
}
export function correctionControlQueryString(q: CorrectionControlQuery) {
  return new URLSearchParams(Object.entries(q).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])).toString();
}
export function parseCorrectionControlQuery(url: string): CorrectionControlQuery {
  const q = new URL(url).searchParams;
  for (const key of q.keys()) if (!["siteId", "operationId", "beforeRevision"].includes(key) || q.getAll(key).length !== 1) fail();
  const before = q.get("beforeRevision"); if (before !== null && !/^[1-9]\d{0,15}$/.test(before)) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null,
    beforeRevision: before === null ? null : integer(Number(before), 1) };
}
function period(raw: unknown): CorrectionPeriod {
  const v = object(raw), dates = correctionControlDates(v.fromDate, v.throughDate), timeZone = attendanceTimeZone(v.timeZone as string);
  const startAt = attendanceRecordInstant(v.startAt), endAt = attendanceRecordInstant(v.endAt);
  if (startAt !== attendanceRecordInstant(attendanceDayUtcRange(dates.fromDate, timeZone).startAt)
    || endAt !== attendanceRecordInstant(attendanceDayUtcRange(dates.throughDate, timeZone).endAt) || startAt >= endAt) fail();
  return { periodId: attendanceSelfUuid(v.periodId), ...dates, timeZone, startAt, endAt };
}
function entry(raw: unknown, maxRevision: number, asOf: string): CorrectionControlEntry {
  const v = object(raw), recordedAt = attendanceRecordInstant(v.recordedAt);
  if (recordedAt > asOf) fail();
  const base = { revision: integer(v.revision, 1, maxRevision), operationId: attendanceSelfUuid(v.operationId), recordedAt, reason: reason(v.reason) };
  if (v.action === "set_policy") { const p = object(v.values); return { ...base, action: "set_policy", values: { submissionWindowDays: integer(p.submissionWindowDays, 0, 365), timeZone: attendanceTimeZone(p.timeZone as string) } }; }
  if (v.action !== "lock_period" && v.action !== "unlock_period") return fail();
  const values = period(v.values);
  if (values.endAt > recordedAt || v.action === "lock_period" && values.periodId !== base.operationId) fail();
  return { ...base, action: v.action, values };
}
export function parseCorrectionControlResult(raw: unknown, q: CorrectionControlQuery, requireRules=false): CorrectionControlResult {
  const v = object(raw), revision = integer(v.revision, 0, Number.MAX_SAFE_INTEGER - 1), asOf = attendanceRecordInstant(v.asOf);
  if (v.siteId !== q.siteId || v.controlsOnly !== true || v.approvalAvailable !== false || typeof v.rulesEnforced !== "boolean" || requireRules && v.rulesEnforced !== true) fail();
  const policy = v.policy === null ? null : entry(v.policy, revision, asOf);
  if (policy && policy.action !== "set_policy") return fail();
  if (!Array.isArray(v.activePeriods) || v.activePeriods.length > 200 || !Array.isArray(v.entries) || v.entries.length > 25) fail();
  let lastEnd = "";
  const activePeriods = (v.activePeriods as unknown[]).map(raw => { const r = object(raw), p = period(r);
    if (p.startAt < lastEnd || p.endAt > asOf) fail(); lastEnd = p.endAt; return { ...p, revision: integer(r.revision, 1, revision) }; });
  if (new Set(activePeriods.map(p => p.periodId)).size !== activePeriods.length) fail();
  let prior = q.beforeRevision ?? revision + 1, priorAt: string | null = null;
  const entries = (v.entries as unknown[]).map(raw => { const e = entry(raw, revision, asOf);
    if (e.revision >= prior || priorAt !== null && e.recordedAt >= priorAt) fail(); prior = e.revision; priorAt = e.recordedAt; return e; });
  if (new Set(entries.map(e => e.operationId)).size !== entries.length) fail();
  const nextBeforeRevision = v.nextBeforeRevision === null ? null : integer(v.nextBeforeRevision, 1, revision);
  if (nextBeforeRevision !== null && (entries.length !== 25 || nextBeforeRevision !== entries.at(-1)?.revision)) fail();
  if (q.beforeRevision === null && (revision === 0 ? entries.length !== 0 || activePeriods.length !== 0 || policy !== null : entries[0]?.revision !== revision)) fail();
  const receipt = v.receipt === null ? null : entry(v.receipt, revision, asOf);
  if (receipt && receipt.operationId !== q.operationId) fail();
  return { siteId: q.siteId, asOf, controlsOnly: true, approvalAvailable: false, rulesEnforced: v.rulesEnforced as boolean, revision,
    settingsVersion: integer(v.settingsVersion, 1), timeZone: attendanceTimeZone(v.timeZone as string), policy, activePeriods, entries, nextBeforeRevision, receipt };
}
export function correctionControlReceiptMatches(command: CorrectionControlCommand, receipt: CorrectionControlEntry) {
  if (command.operationId !== receipt.operationId || command.action !== receipt.action || receipt.revision !== command.expectedRevision + 1 || command.reason !== receipt.reason) return false;
  if (command.action === "set_policy" && receipt.action === "set_policy") return command.submissionWindowDays === receipt.values.submissionWindowDays;
  if (command.action === "lock_period" && receipt.action === "lock_period") return command.fromDate === receipt.values.fromDate && command.throughDate === receipt.values.throughDate;
  return command.action === "unlock_period" && receipt.action === "unlock_period" && command.periodId === receipt.values.periodId;
}
export const CORRECTION_CONTROL_ERRORS: Readonly<Record<string, number>> = { attendance_invalid_request: 400, attendance_invalid_date: 400, attendance_invalid_instant: 400,
  attendance_invalid_content_type: 415, attendance_body_too_large: 413, attendance_access_denied: 403, attendance_settings_required: 409,
  attendance_platform_paused: 403, attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_rate_limited: 429,
  attendance_period_overlap: 409, attendance_period_not_locked: 409, attendance_period_future: 409, attendance_period_limit: 409,
  attendance_local_date_does_not_exist: 400, attendance_invalid_time_zone: 400 };
