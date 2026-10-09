import { attendanceSelfSite, attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { attendanceTimeZone, MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

export type AttendanceAdminSettings = { timeZone: string; enabled: boolean; webClockEnabled: boolean; webBreakPaid: boolean };
export type AttendanceAdminLocation = { id: string; name: string; timeZone: string; active: boolean };
export type AttendanceAdminWorker = { id: string; employeeId: string; workerNo: string; displayName: string; locationId: string; active: boolean; startsOn: string };
export type AttendanceAdminEmployee = { id: string; displayName: string };
export type AttendanceAdminChange =
  | { kind: "settings"; values: AttendanceAdminSettings }
  | { kind: "location"; values: AttendanceAdminLocation }
  | { kind: "worker"; values: AttendanceAdminWorker };
export type AttendanceAdminCommand = AttendanceAdminChange & { operationId: string; expectedVersion: number };
export type AttendanceAdminView = "settings" | "locations" | "workers" | "employees";
export type AttendanceAdminQuery = { siteId: string; view: AttendanceAdminView; cursor: string | null; search: string; operationId: string | null };
export type AttendanceAdminReceipt = { operationId: string; version: number; kind: AttendanceAdminChange["kind"]; targetId: string | null };
export type AttendanceAdminResult = {
  siteId: string; version: number; settings: AttendanceAdminSettings | null;
  view: AttendanceAdminView; items: (AttendanceAdminLocation | AttendanceAdminWorker | AttendanceAdminEmployee)[];
  nextCursor: string | null; receipt: AttendanceAdminReceipt | null;
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
function keys(v: Record<string, unknown>, names: string[]) {
  if (Object.keys(v).length !== names.length || names.some((n) => !Object.hasOwn(v, n))) fail();
}
function text(v: unknown, max: number) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max || /[\u0000-\u001f\u007f]/.test(v)) return fail();
  return v.trim();
}
function bool(v: unknown) { return typeof v === "boolean" ? v : fail(); }
function version(v: unknown) { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER ? v : fail(); }
function date(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : fail();
}
function settings(v: unknown): AttendanceAdminSettings {
  const o = object(v); keys(o, ["timeZone", "enabled", "webClockEnabled", "webBreakPaid"]);
  return { timeZone: attendanceTimeZone(text(o.timeZone, 100)), enabled: bool(o.enabled), webClockEnabled: bool(o.webClockEnabled), webBreakPaid: bool(o.webBreakPaid) };
}
function location(v: unknown): AttendanceAdminLocation {
  const o = object(v); keys(o, ["id", "name", "timeZone", "active"]);
  return { id: attendanceSelfUuid(o.id), name: text(o.name, 120), timeZone: attendanceTimeZone(text(o.timeZone, 100)), active: bool(o.active) };
}
function worker(v: unknown): AttendanceAdminWorker {
  const o = object(v); keys(o, ["id", "employeeId", "workerNo", "displayName", "locationId", "active", "startsOn"]);
  return { id: attendanceSelfUuid(o.id), employeeId: attendanceSelfUuid(o.employeeId), workerNo: text(o.workerNo, 40), displayName: text(o.displayName, 120), locationId: attendanceSelfUuid(o.locationId), active: bool(o.active), startsOn: date(o.startsOn) };
}
export function parseAttendanceAdminCommand(input: unknown): { siteId: string; command: AttendanceAdminCommand } {
  const o = object(input); keys(o, ["siteId", "operationId", "expectedVersion", "kind", "values"]);
  const base = { operationId: attendanceSelfUuid(o.operationId), expectedVersion: version(o.expectedVersion) };
  const change: AttendanceAdminChange = o.kind === "settings" ? { kind: o.kind, values: settings(o.values) }
    : o.kind === "location" ? { kind: o.kind, values: location(o.values) }
    : o.kind === "worker" ? { kind: o.kind, values: worker(o.values) } : fail();
  return { siteId: attendanceSelfSite(o.siteId), command: { ...base, ...change } };
}
export function parseAttendanceAdminQuery(url: string): AttendanceAdminQuery {
  const q = new URL(url).searchParams;
  for (const k of q.keys()) if (!["siteId", "view", "cursor", "search", "operationId"].includes(k) || q.getAll(k).length !== 1) fail();
  const view = q.get("view") ?? "settings";
  if (!["settings", "locations", "workers", "employees"].includes(view)) fail();
  const search = q.get("search") ?? "";
  if (search.length > 80 || /[\u0000-\u001f\u007f]/.test(search)) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), view: view as AttendanceAdminView, cursor: q.has("cursor") ? attendanceSelfUuid(q.get("cursor")) : null,
    search: search.trim(), operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
}
export function parseAttendanceAdminResult(input: unknown, expected: { siteId: string; view: AttendanceAdminView; operationId: string | null }): AttendanceAdminResult {
  const o = object(input);
  if (o.siteId !== expected.siteId || o.view !== expected.view || !Array.isArray(o.items) || o.items.length > 25) fail();
  const v = version(o.version);
  const config = o.settings === null ? null : settings(o.settings);
  if ((config === null) !== (v === 0)) fail();
  const items = (o.items as unknown[]).map((raw) => {
    if (expected.view === "locations") return location(raw);
    if (expected.view === "workers") return worker(raw);
    if (expected.view !== "employees") return fail();
    const row = object(raw); keys(row, ["id", "displayName"]);
    return { id: attendanceSelfUuid(row.id), displayName: text(row.displayName, 120) };
  });
  if (new Set(items.map((i) => i.id)).size !== items.length) fail();
  const nextCursor = o.nextCursor === null ? null : attendanceSelfUuid(o.nextCursor);
  if (nextCursor && (items.length !== 25 || nextCursor !== items.at(-1)?.id)) fail();
  let receipt: AttendanceAdminReceipt | null = null;
  if (o.receipt !== null) {
    const r = object(o.receipt);
    if (r.operationId !== expected.operationId || !["settings", "location", "worker"].includes(String(r.kind))) fail();
    const receiptVersion = version(r.version);
    if (receiptVersion < 1 || receiptVersion > v) fail();
    receipt = { operationId: attendanceSelfUuid(r.operationId), version: receiptVersion, kind: r.kind as AttendanceAdminReceipt["kind"], targetId: r.kind === "settings" && r.targetId === null ? null : attendanceSelfUuid(r.targetId) };
  }
  return { siteId: expected.siteId, version: v, settings: config, view: expected.view, items, nextCursor, receipt };
}
export const ATTENDANCE_ADMIN_ERRORS: Readonly<Record<string, { status: number; message: string }>> = {
  attendance_platform_paused: { status: 403, message: "平台尚未开放或已暂停新考勤。可读取已有配置及保存收据，不能修改配置。" },
  attendance_invalid_request: { status: 400, message: "请检查填写内容。" },
  attendance_invalid_time_zone: { status: 400, message: "请选择有效的 IANA 时区。" },
  attendance_body_too_large: { status: 413, message: "提交内容过长。" },
  attendance_invalid_content_type: { status: 415, message: "请求格式错误。" },
  attendance_access_denied: { status: 403, message: "仅当前商户负责人可以管理考勤配置。" },
  attendance_version_conflict: { status: 409, message: "配置已被修改，请重新读取后再编辑。" },
  attendance_operation_conflict: { status: 409, message: "操作编号冲突，请核对原操作。" },
  attendance_settings_required: { status: 409, message: "请先保存考勤设置。" },
  attendance_open_sessions: { status: 409, message: "还有未结束的工作或休息，不能进行此变更。请先核对考勤。" },
  attendance_location_in_use: { status: 409, message: "此地点仍分配给启用的考勤人员，请先调整人员地点。" },
  attendance_history_protected: { status: 409, message: "此变更会影响历史解释，需后续的生效日期／补正流程处理。" },
  attendance_employee_invalid: { status: 409, message: "该员工不属于本企业、尚未激活或已经关联其他档案。" },
  attendance_location_denied: { status: 409, message: "请选择本企业有效且启用的地点。" },
  attendance_duplicate_worker: { status: 409, message: "工号或关联员工已被其他档案使用。" },
  attendance_rate_limited: { status: 429, message: "操作较频繁，请稍后重试。" },
};
export function attendanceAdminMessage(code: string) {
  return Object.hasOwn(ATTENDANCE_ADMIN_ERRORS, code) ? ATTENDANCE_ADMIN_ERRORS[code].message : "暂时无法确认，请重新读取；未显示收据前不要当作保存成功。";
}
