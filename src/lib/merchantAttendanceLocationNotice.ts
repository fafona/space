import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseAttendanceLocationPolicyValues, ATTENDANCE_LOCATION_POLICY_ERRORS, type AttendanceLocationPolicyValues } from "./merchantAttendanceLocationPolicy";
export type NoticeAccess = "owner" | "self";
export type NoticeQuery = { siteId: string; access: NoticeAccess; locationId: string; expectedWorkerId: string | null; operationId: string | null };
export type NoticeCommand = { action: "acknowledge"; operationId: string; expectedRevision: number } |
  { action: "publish" | "withdraw"; operationId: string; expectedRevision: number; draftRevision: number | null; expectedSettingsVersion: number; expectedLocationVersion: number; reason: string };
export type PublicNoticeValues = Omit<AttendanceLocationPolicyValues, "latitude" | "longitude">;
export type NoticeRevision = { revision: number; action: "publish" | "withdraw"; draftRevision: number | null; templateVersion: 1; recordedAt: string; reason: string; values: PublicNoticeValues | null };
export type NoticeReceipt = { operationId: string; action: NoticeCommand["action"]; revision: number; draftRevision: number | null; reason: string | null; recordedAt: string };
export type NoticeResult = { siteId: string; access: NoticeAccess; employeeId: string | null; workerId: string | null; operationalChanged: false;
  location: { id: string; name: string; active: boolean; version: number }; settingsVersion: number;
  current: NoticeRevision | null; draft: { revision: number; values: AttendanceLocationPolicyValues } | null;
  noticeCurrent: boolean; canPublish: boolean; canWithdraw: boolean; canAcknowledge: boolean; acknowledgedAt: string | null; receipt: NoticeReceipt | null };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function object(v: unknown, keys?: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail(); const r = v as Record<string, unknown>;
  if (keys && (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k)))) return fail(); return r;
}
const integer = (v: unknown, min = 1, max = Number.MAX_SAFE_INTEGER - 1) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const text = (v: unknown, max: number) => typeof v === "string" && v.trim() && Array.from(v.trim()).length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : fail();
const access = (v: unknown): NoticeAccess => v === "owner" || v === "self" ? v : fail();
const base = (v: Record<string, unknown>) => {
  const a = access(v.access), worker = v.expectedWorkerId === null ? null : attendanceSelfUuid(v.expectedWorkerId);
  if ((a === "owner") !== (worker === null)) return fail();
  return { siteId: attendanceSelfSite(v.siteId), access: a, locationId: attendanceSelfUuid(v.locationId), expectedWorkerId: worker };
};
export const noticeQueryString = (q: NoticeQuery) => new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== null)).toString();
export function parseNoticeQuery(url: string): NoticeQuery {
  const q = new URL(url).searchParams;
  for (const k of q.keys()) if (!["siteId", "access", "locationId", "expectedWorkerId", "operationId"].includes(k) || q.getAll(k).length !== 1) return fail();
  return { ...base({ ...Object.fromEntries(q), expectedWorkerId: q.get("expectedWorkerId") }), operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
}
export function parseNoticeCommand(input: unknown): { query: NoticeQuery; command: NoticeCommand } {
  const v = object(input), b = base(v), self = b.access === "self";
  object(v, ["siteId", "access", "locationId", "expectedWorkerId", "action", "operationId", "expectedRevision", ...(self ? [] : ["draftRevision", "expectedSettingsVersion", "expectedLocationVersion", "reason"])]);
  const shared = { operationId: attendanceSelfUuid(v.operationId), expectedRevision: integer(v.expectedRevision, self ? 1 : 0, Number.MAX_SAFE_INTEGER - (self ? 1 : 2)) };
  const query = { ...b, operationId: null };
  if (self) { if (v.action !== "acknowledge") return fail(); return { query, command: { ...shared, action: "acknowledge" } }; }
  if (v.action !== "publish" && v.action !== "withdraw" || v.action === "withdraw" && v.draftRevision !== null) return fail();
  return { query, command: { ...shared, action: v.action, draftRevision: v.action === "publish" ? integer(v.draftRevision) : null,
    expectedSettingsVersion: integer(v.expectedSettingsVersion, 1, Number.MAX_SAFE_INTEGER - 2), expectedLocationVersion: integer(v.expectedLocationVersion, 1, Number.MAX_SAFE_INTEGER - 2), reason: text(v.reason, 240) } };
}
export function parseNoticeResult(input: unknown, q: NoticeQuery): NoticeResult {
  const v = object(input), l = object(v.location);
  if (v.siteId !== q.siteId || v.access !== q.access || l.id !== q.locationId || v.operationalChanged !== false || typeof l.active !== "boolean") return fail();
  for (const k of ["noticeCurrent", "canPublish", "canWithdraw", "canAcknowledge"]) if (typeof v[k] !== "boolean") return fail();
  const employeeId = q.access === "self" ? attendanceSelfUuid(v.employeeId) : null, workerId = q.access === "self" ? attendanceSelfUuid(v.workerId) : null;
  if (workerId !== q.expectedWorkerId || q.access === "owner" && (v.employeeId !== null || v.workerId !== null)) return fail();
  let current: NoticeRevision | null = null;
  if (v.current !== null) {
    const c = object(v.current); if (c.templateVersion !== 1 || c.action !== "publish" && c.action !== "withdraw") return fail();
    let values: PublicNoticeValues | null = null, draftRevision: number | null = null;
    if (c.action === "publish") {
      const x = object(c.values, ["purpose", "notice", "contact", "alternative", "retentionDays", "radiusMeters"]);
      const { latitude: _lat, longitude: _lon, ...publicValues } = parseAttendanceLocationPolicyValues({ ...x, latitude: 0, longitude: 0 }); void _lat; void _lon;
      values = publicValues; draftRevision = integer(c.draftRevision);
    } else if (c.values !== null || c.draftRevision !== null) return fail();
    current = { revision: integer(c.revision), action: c.action, draftRevision, templateVersion: 1, values, recordedAt: attendanceRecordInstant(c.recordedAt), reason: text(c.reason, 240) };
  }
  let draft: NoticeResult["draft"] = null;
  if (v.draft !== null) { if (q.access !== "owner") return fail(); const d = object(v.draft); draft = { revision: integer(d.revision), values: parseAttendanceLocationPolicyValues(d.values) }; }
  if (q.access === "owner" && current?.action === "publish" && (!draft || draft.revision < current.draftRevision!)) return fail();
  const acknowledgedAt = v.acknowledgedAt === null ? null : attendanceRecordInstant(v.acknowledgedAt);
  if (v.noticeCurrent && (!l.active || current?.action !== "publish") || acknowledgedAt && (q.access !== "self" || current?.action !== "publish" || acknowledgedAt < current.recordedAt)
    || q.access === "self" && (v.canPublish || v.canWithdraw) || q.access === "owner" && (v.canAcknowledge || acknowledgedAt !== null)
    || v.canAcknowledge && (!v.noticeCurrent || acknowledgedAt !== null) || v.canPublish && (!l.active || !draft || current?.action === "publish" && current.draftRevision === draft.revision)
    || v.canWithdraw !== (q.access === "owner" && current?.action === "publish")) return fail();
  let receipt: NoticeReceipt | null = null;
  if (v.receipt !== null) {
    const r = object(v.receipt), action = r.action;
    if (r.operationId !== q.operationId || !current || (q.access === "self" ? action !== "acknowledge" : action !== "publish" && action !== "withdraw")) return fail();
    const revision = integer(r.revision, 1, current.revision), recordedAt = attendanceRecordInstant(r.recordedAt);
    const draftRevision = action === "publish" ? integer(r.draftRevision) : null, reason = action === "acknowledge" ? null : text(r.reason, 240);
    if (action !== "publish" && r.draftRevision !== null || action === "acknowledge" && r.reason !== null) return fail();
    if (revision === current.revision && (action === "acknowledge" ? current.action !== "publish" || acknowledgedAt !== recordedAt
      : current.action !== action || current.recordedAt !== recordedAt || current.draftRevision !== draftRevision || current.reason !== reason)) return fail();
    receipt = { operationId: attendanceSelfUuid(r.operationId), action: action as NoticeCommand["action"], revision, recordedAt, draftRevision, reason };
  }
  return { siteId: q.siteId, access: q.access, employeeId, workerId, operationalChanged: false,
    location: { id: q.locationId, name: text(l.name, 120), active: l.active, version: integer(l.version) }, settingsVersion: integer(v.settingsVersion), current, draft,
    noticeCurrent: v.noticeCurrent as boolean, canPublish: v.canPublish as boolean, canWithdraw: v.canWithdraw as boolean, canAcknowledge: v.canAcknowledge as boolean, acknowledgedAt, receipt };
}
export function noticeReceiptMatches(receipt: NoticeReceipt, command: NoticeCommand) {
  return receipt.operationId === command.operationId && receipt.action === command.action && receipt.revision === command.expectedRevision + (command.action === "acknowledge" ? 0 : 1)
    && (command.action === "acknowledge" || receipt.draftRevision === command.draftRevision && receipt.reason === command.reason);
}
// Template 1 is immutable presentation text. New wording requires a new template
// version, publication and confirmation; never silently rewrite past notices.
export function locationNoticeTemplate1(values: PublicNoticeValues) {
  return [`用途：${values.purpose}`, `告知内容：${values.notice}`, "拟采用员工主动触发的单次定位，不进行持续追踪；范围判断不是本人在场证明或工资审批。",
    "拟保存打卡关联的范围理由、时间、精度与取整距离，不保存原始设备经纬度。", `围栏半径：${values.radiusMeters} 米。`,
    `拟定定位摘要保留期限：${values.retentionDays} 天。发布告知不会启动自动清理，打卡事实另有保留规则。`,
    `不能提供位置时：${values.alternative}`, `咨询与核查联系人：${values.contact}`,
    "本页发布或确认只记录告知版本，不启用定位、不触发采集、不授权新的考勤权限。确认按钮记录本人声明收到，不能证明已阅读理解全文，也不等同于同意定位或完成合规审核。"];
}
export const NOTICE_ERRORS: Readonly<Record<string, number>> = { ...ATTENDANCE_LOCATION_POLICY_ERRORS, attendance_worker_changed: 409, attendance_notice_unavailable: 409,
  attendance_notice_already_acknowledged: 409, attendance_notice_unchanged: 409, attendance_invalid_instant: 400 };
