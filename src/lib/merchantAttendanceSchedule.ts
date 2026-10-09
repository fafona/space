import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceInstant, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { correctionTimeOffsets, parseCorrectionTimeInput } from "./merchantAttendanceCorrectionForm";

// A plan is not a punch, approved working time, absence determination or payroll.
export type ScheduleQuery = { siteId: string; access: "owner" | "self"; workerId: string | null; fromDate: string; throughDate: string; operationId: string | null };
export type ScheduleSlot = [string, string];
export type ScheduleCommand = { operationId: string; expectedRevision: number; expectedSettingsVersion: number; reason: string } &
  ({ action: "publish"; locationId: string; timeZone: string; slots: ScheduleSlot[] } | { action: "cancel"; slotId: string });
export type ScheduleEntry = { id: string; workerId: string; workerName: string; locationId: string; locationName: string; timeZone: string; workDate: string;
  startAt: string; endAt: string; revision: number; cancelled: boolean; reason: string; cancelReason: string | null };
export type ScheduleResult = { siteId: string; access: "owner" | "self"; fromDate: string; throughDate: string; revision: number; settingsVersion: number;
  timeZone: string; worker: null | { id: string; name: string; active: boolean; location: null | { id: string; name: string; timeZone: string; active: boolean } };
  entries: ScheduleEntry[]; rangeLimited: boolean; receipt: null | { operationId: string; revision: number; command: ScheduleCommand }; moduleEnabled: boolean };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
export function scheduleObject(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail(); }
function keys(v: Record<string, unknown>, names: string[]) { if (Object.keys(v).length !== names.length || names.some(k => !Object.hasOwn(v, k))) fail(); }
function version(v: unknown, minimum = 0): number { return typeof v === "number" && Number.isSafeInteger(v) && v >= minimum && v < Number.MAX_SAFE_INTEGER - 1 ? v : fail(); }
function text(v: unknown, max = 200): string { return typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail(); }
function bool(v: unknown): boolean { return typeof v === "boolean" ? v : fail(); }
export function scheduleDate(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  try { attendanceInstant(`${v}T00:00:00.000Z`); } catch { return fail(); } return v;
}
export function scheduleQueryString(q: ScheduleQuery): string {
  const params = new URLSearchParams({ siteId: q.siteId, access: q.access, fromDate: q.fromDate, throughDate: q.throughDate });
  if (q.workerId) params.set("workerId", q.workerId); if (q.operationId) params.set("operationId", q.operationId); return params.toString();
}
export function parseScheduleQuery(url: string): ScheduleQuery {
  const q = new URL(url).searchParams;
  for (const k of q.keys()) if (!["siteId", "access", "workerId", "fromDate", "throughDate", "operationId"].includes(k) || q.getAll(k).length !== 1) fail();
  const access = q.get("access"); if (access !== "owner" && access !== "self") return fail();
  const fromDate = scheduleDate(q.get("fromDate")), throughDate = scheduleDate(q.get("throughDate"));
  const days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000;
  if (days < 0 || days > 30 || access === "self" && (q.has("workerId") || q.has("operationId"))) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), access, fromDate, throughDate,
    workerId: q.has("workerId") ? attendanceSelfUuid(q.get("workerId")) : null, operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
}
export function parseScheduleBody(raw: unknown): { query: ScheduleQuery; command: ScheduleCommand } {
  const v = scheduleObject(raw); keys(v, ["query", "command"]); const q = scheduleObject(v.query);
  keys(q, ["siteId", "access", "workerId", "fromDate", "throughDate", "operationId"]);
  if (q.access !== "owner" || q.operationId !== null) fail(); attendanceSelfUuid(q.workerId); attendanceSelfSite(q.siteId); scheduleDate(q.fromDate); scheduleDate(q.throughDate);
  const query = parseScheduleQuery(`https://local.invalid/?${scheduleQueryString(q as ScheduleQuery)}`), c = scheduleObject(v.command);
  const base = { operationId: attendanceSelfUuid(c.operationId), expectedRevision: version(c.expectedRevision), expectedSettingsVersion: version(c.expectedSettingsVersion, 1), reason: text(c.reason) };
  if (c.action === "cancel") {
    keys(c, ["operationId", "expectedRevision", "expectedSettingsVersion", "reason", "action", "slotId"]);
    return { query, command: { ...base, action: "cancel", slotId: attendanceSelfUuid(c.slotId) } };
  }
  keys(c, ["operationId", "expectedRevision", "expectedSettingsVersion", "reason", "action", "locationId", "timeZone", "slots"]);
  if (c.action !== "publish" || !Array.isArray(c.slots) || c.slots.length < 1 || c.slots.length > 32) return fail();
  const timeZone = attendanceTimeZone(text(c.timeZone, 100)); let lastEnd = -Infinity;
  const slots = c.slots.map(rawSlot => {
    if (!Array.isArray(rawSlot) || rawSlot.length !== 2) return fail();
    const [start, end] = rawSlot as ScheduleSlot, a = attendanceInstant(start), b = attendanceInstant(end), date = attendanceLocalDate(start, timeZone);
    if (a % 60000 || b % 60000 || b <= a || b - a > 24 * 3600000 || a < lastEnd || date < query.fromDate || date > query.throughDate) fail();
    lastEnd = b; return [start, end] as ScheduleSlot;
  });
  return { query, command: { ...base, action: "publish", locationId: attendanceSelfUuid(c.locationId), timeZone, slots } };
}
export function parseScheduleResult(raw: unknown, q: ScheduleQuery, moduleRequired = true): ScheduleResult {
  const v = scheduleObject(raw);
  if (v.siteId !== q.siteId || v.access !== q.access || v.fromDate !== q.fromDate || v.throughDate !== q.throughDate || !Array.isArray(v.entries) || v.entries.length > 100) fail();
  const revision = version(v.revision), settingsVersion = version(v.settingsVersion, 1), timeZone = attendanceTimeZone(text(v.timeZone, 100)), rangeLimited = bool(v.rangeLimited);
  if (rangeLimited && (v.entries as unknown[]).length) fail();
  let worker: ScheduleResult["worker"] = null;
  if (v.worker !== null) {
    const w = scheduleObject(v.worker); let location: NonNullable<ScheduleResult["worker"]>["location"] = null;
    if (w.location !== null) { const l = scheduleObject(w.location); location = { id: attendanceSelfUuid(l.id), name: text(l.name, 120), timeZone: attendanceTimeZone(text(l.timeZone, 100)), active: bool(l.active) }; }
    worker = { id: attendanceSelfUuid(w.id), name: text(w.name, 120), active: bool(w.active), location };
  }
  if (q.workerId && worker?.id !== q.workerId || q.access === "self" && !worker || q.access === "owner" && !q.workerId && worker) fail();
  const entries = (v.entries as unknown[]).map(rawEntry => {
    const e = scheduleObject(rawEntry), startAt = text(e.startAt, 24), endAt = text(e.endAt, 24), zone = attendanceTimeZone(text(e.timeZone, 100));
    const start = attendanceInstant(startAt), end = attendanceInstant(endAt), workDate = scheduleDate(e.workDate), cancelled = bool(e.cancelled), rev = version(e.revision, 1);
    if (!worker || e.workerId !== worker.id || end <= start || end - start > 86400000 || start % 60000 || end % 60000 ||
      workDate !== attendanceLocalDate(startAt, zone) || workDate < q.fromDate || workDate > q.throughDate || rev > revision || (!cancelled && e.cancelReason !== null)) fail();
    return { id: attendanceSelfUuid(e.id), workerId: attendanceSelfUuid(e.workerId), workerName: text(e.workerName, 120), locationId: attendanceSelfUuid(e.locationId), locationName: text(e.locationName, 120), timeZone: zone,
      workDate, startAt, endAt, revision: rev, cancelled, reason: text(e.reason), cancelReason: cancelled ? text(e.cancelReason) : null };
  });
  if (new Set(entries.map(e => e.id)).size !== entries.length) fail();
  let receipt: ScheduleResult["receipt"] = null;
  if (v.receipt !== null) {
    if (q.access !== "owner" || !q.operationId || !q.workerId) fail();
    const r = scheduleObject(v.receipt), rev = version(r.revision, 1);
    const command = parseScheduleBody({ query: { ...q, operationId: null }, command: r.command }).command;
    if (r.operationId !== q.operationId || command.operationId !== q.operationId || rev !== command.expectedRevision + 1 || rev > revision) fail();
    receipt = { operationId: attendanceSelfUuid(r.operationId), revision: rev, command };
  }
  return { siteId: q.siteId, access: q.access, fromDate: q.fromDate, throughDate: q.throughDate, revision, settingsVersion, timeZone, worker, entries, rangeLimited, receipt,
    moduleEnabled: moduleRequired ? bool(v.moduleEnabled) : false };
}
export const SCHEDULE_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_invalid_time_zone: 400, attendance_invalid_instant: 400, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_access_denied: 403, attendance_platform_paused: 403, attendance_settings_required: 409, attendance_version_conflict: 409, attendance_operation_conflict: 409,
  attendance_schedule_overlap: 409, attendance_schedule_past: 409, attendance_schedule_not_active: 409, attendance_schedule_worker_invalid: 409,
  attendance_schedule_location_changed: 409, attendance_schedule_outside_employment: 409, attendance_schedule_range_limit: 409, attendance_rate_limited: 429,
};
export function scheduleMessage(code: string): string {
  return ({ attendance_schedule_overlap: "与该员工已有排班重叠；整批未保存。", attendance_schedule_past: "只能安排或取消尚未开始的班次，最多提前 180 天。",
    attendance_schedule_not_active: "该班次已取消或不在本次范围内。", attendance_schedule_worker_invalid: "员工或考勤档案当前不可排班。",
    attendance_schedule_location_changed: "默认工作地点或时区已变化，请重新读取。", attendance_schedule_outside_employment: "班次超出已配置的在职日期。",
    attendance_schedule_range_limit: "此范围记录超过 100 条，请缩短查询日期。", attendance_version_conflict: "配置或排班已变化，请重新读取后编辑。",
    attendance_platform_paused: "平台暂停排班写入；仍可查看已有安排与查询收据。", attendance_access_denied: "当前身份无权访问，已隐藏排班。" } as Record<string, string>)[code]
    ?? "未能确认，请重新读取。网络异常不代表操作未完成。";
}
export type ScheduleWallSlot = { start: string; end: string; startOffset: string; endOffset: string };
export function resolveScheduleWallSlots(slots: ScheduleWallSlot[], timeZone: string): ScheduleSlot[] {
  const instant = (local: string, selected: string) => {
    const choices = correctionTimeOffsets(local, timeZone);
    if (!choices.length) throw Error("所选当地时间不存在，请检查夏令时转换。");
    const offset = selected || (choices.length === 1 ? choices[0] : "");
    if (!choices.includes(offset)) throw Error("所选当地时间重复，请明确选择 UTC 偏移。");
    return new Date(parseCorrectionTimeInput({ local, offset }, timeZone)).toISOString();
  };
  return slots.map(s => [instant(s.start, s.startOffset), instant(s.end, s.endOffset)] as ScheduleSlot).sort((a, b) => a[0].localeCompare(b[0]));
}
