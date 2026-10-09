import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";
import { ATTENDANCE_ADMIN_ERRORS } from "./merchantAttendanceAdmin";

// Owner-authored draft, not an activated rule or an employee consent record.
export type AttendanceLocationPolicyValues = {
  purpose: string; notice: string; contact: string; alternative: string; retentionDays: number;
  latitude: number; longitude: number; radiusMeters: number;
};
export type AttendanceLocationPolicyCommand = {
  operationId: string; expectedRevision: number; expectedSettingsVersion: number; expectedLocationVersion: number;
  values: AttendanceLocationPolicyValues;
};
export type AttendanceLocationPolicyQuery = { siteId: string; locationId: string; operationId: string | null };
export type AttendanceLocationPolicyRevision = {
  revision: number; recordedAt: string; settingsVersion: number; locationVersion: number; values: AttendanceLocationPolicyValues;
};
export type AttendanceLocationPolicyResult = {
  siteId: string; locationId: string; draftOnly: true; settingsVersion: number;
  location: { name: string; active: boolean; version: number };
  current: AttendanceLocationPolicyRevision | null; previous: AttendanceLocationPolicyRevision | null;
  receipt: { operationId: string; revision: number; recordedAt: string } | null;
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
const exact = (v: Record<string, unknown>, keys: string[]) => { if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(); };
function integer(v: unknown, min = 1, max = Number.MAX_SAFE_INTEGER - 1) { return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail(); }
function text(v: unknown, max: number) {
  return typeof v === "string" && v.trim().length > 0 && Array.from(v.trim()).length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : fail();
}
function number(v: unknown, min: number, max: number) { return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail(); }
export function parseAttendanceLocationPolicyValues(input: unknown): AttendanceLocationPolicyValues {
  const v = object(input); exact(v, ["purpose", "notice", "contact", "alternative", "retentionDays", "latitude", "longitude", "radiusMeters"]);
  return { purpose: text(v.purpose, 160), notice: text(v.notice, 400), contact: text(v.contact, 120), alternative: text(v.alternative, 240),
    retentionDays: integer(v.retentionDays, 1, 3650), latitude: number(v.latitude, -90, 90), longitude: number(v.longitude, -180, 180), radiusMeters: integer(v.radiusMeters, 1, 100000) };
}
export function parseAttendanceLocationPolicyCommand(input: unknown): { siteId: string; locationId: string; command: AttendanceLocationPolicyCommand } {
  const v = object(input); exact(v, ["siteId", "locationId", "operationId", "expectedRevision", "expectedSettingsVersion", "expectedLocationVersion", "values"]);
  return { siteId: attendanceSelfSite(v.siteId), locationId: attendanceSelfUuid(v.locationId), command: {
    operationId: attendanceSelfUuid(v.operationId), expectedRevision: integer(v.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 2),
    expectedSettingsVersion: integer(v.expectedSettingsVersion), expectedLocationVersion: integer(v.expectedLocationVersion), values: parseAttendanceLocationPolicyValues(v.values),
  } };
}
export function parseAttendanceLocationPolicyQuery(url: string): AttendanceLocationPolicyQuery {
  const q = new URL(url).searchParams;
  for (const key of q.keys()) if (!["siteId", "locationId", "operationId"].includes(key) || q.getAll(key).length !== 1) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), locationId: attendanceSelfUuid(q.get("locationId")), operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
}
function timestamp(v: unknown) { if (typeof v !== "string") return fail(); attendanceInstant(v); return v; }
function revision(v: unknown): AttendanceLocationPolicyRevision | null {
  if (v === null) return null;
  const r = object(v);
  return { revision: integer(r.revision), recordedAt: timestamp(r.recordedAt), settingsVersion: integer(r.settingsVersion), locationVersion: integer(r.locationVersion), values: parseAttendanceLocationPolicyValues(r.values) };
}
export function parseAttendanceLocationPolicyResult(input: unknown, expected: AttendanceLocationPolicyQuery): AttendanceLocationPolicyResult {
  const v = object(input), location = object(v.location);
  if (v.siteId !== expected.siteId || v.locationId !== expected.locationId || v.draftOnly !== true || typeof location.active !== "boolean") return fail();
  const current = revision(v.current), previous = revision(v.previous);
  if (current ? (current.revision === 1 ? previous !== null : previous?.revision !== current.revision - 1) : previous !== null) return fail();
  if (current && previous && attendanceInstant(previous.recordedAt) > attendanceInstant(current.recordedAt)) return fail();
  let receipt: AttendanceLocationPolicyResult["receipt"] = null;
  if (v.receipt !== null) {
    const r = object(v.receipt);
    if (r.operationId !== expected.operationId || !current) return fail();
    receipt = { operationId: attendanceSelfUuid(r.operationId), revision: integer(r.revision, 1, current.revision), recordedAt: timestamp(r.recordedAt) };
    if (attendanceInstant(receipt.recordedAt) > attendanceInstant(current.recordedAt)) return fail();
    if (receipt.revision === current.revision && receipt.recordedAt !== current.recordedAt) return fail();
  }
  return { siteId: expected.siteId, locationId: expected.locationId, draftOnly: true, settingsVersion: integer(v.settingsVersion),
    location: { name: text(location.name, 120), active: location.active, version: integer(location.version) }, current, previous, receipt };
}
export const ATTENDANCE_LOCATION_POLICY_ERRORS: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(ATTENDANCE_ADMIN_ERRORS).map(([key, value]) => [key, value.status]));
export function attendanceLocationPolicyNotice(values: AttendanceLocationPolicyValues): string[] {
  return ["政策草稿预览：尚未向员工发布，也未开启定位。", `用途：${values.purpose}`, `补充告知：${values.notice}`,
    "拟采用员工主动触发的单次定位，不进行持续追踪；范围判定不代表本人在场或工资审批。",
    "拟保留打卡关联的范围理由、时间、精度和取整距离，不保存原始设备经纬度。",
    `拟定摘要保留期限：${values.retentionDays} 天。当前仅记录政策草稿，未启用自动清理；打卡事实的保留规则需另行制定。`,
    `不能提供位置时：${values.alternative}`, `咨询与核查联系人：${values.contact}`,
    "员工阅读告知不等于同意放弃权利。启用前仍需完成适用规则评估、异常核查与保留期限流程。"];
}
