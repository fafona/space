import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

export type AttendanceTerminal = {
  id: string; label: string; locationId: string; locationName: string; timeZone: string;
  state: "pending" | "active" | "expired" | "revoked" | "blocked";
  createdAt: string; pairExpiresAt: string; pairedAt: string | null; deviceExpiresAt: string | null; revokedAt: string | null;
};
export type TerminalQuery = { siteId: string; cursor: string | null; terminalId: string | null };
export type TerminalCommand = { action: "create"; terminalId: string; locationId: string; label: string; pairSecret: string }
  | { action: "revoke"; terminalId: string };
export type TerminalList = { siteId: string; items: AttendanceTerminal[]; nextCursor: string | null };
export type TerminalDevice = { siteId: string; terminal: AttendanceTerminal; attendanceEnabled: boolean; clockEnabled: false };
export const TERMINAL_COOKIE = "__Host-faolla-attendance-terminal";
export const TERMINAL_API = "/api/merchant-enterprise/attendance/terminals";
export const TERMINAL_DEVICE_API = "/api/merchant-enterprise/attendance/terminal-device";
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
export function terminalObject(v: unknown, keys: readonly string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k))) return fail();
  return o;
}
function text(v: unknown, max: number): string {
  return typeof v === "string" && v === v.trim() && [...v].length > 0 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
export function terminalSecret(v: unknown): string {
  // 32 cryptographically random bytes in canonical unpadded base64url form.
  return typeof v === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(v) ? v : fail();
}
export function terminalPairToken(siteId: string, terminalId: string, secret: string) {
  return `${attendanceSelfSite(siteId)}.${attendanceSelfUuid(terminalId)}.${terminalSecret(secret)}`;
}
export function parseTerminalToken(value: unknown) {
  if (typeof value !== "string" || value.length !== 89) return fail();
  const [siteId, terminalId, secret] = value.split(".");
  return { siteId: attendanceSelfSite(siteId), terminalId: attendanceSelfUuid(terminalId), secret: terminalSecret(secret) };
}
export function parseTerminalQuery(url: string): TerminalQuery {
  const q = new URL(url).searchParams;
  for (const k of q.keys()) if (!["siteId", "cursor", "terminalId"].includes(k) || q.getAll(k).length !== 1) fail();
  if (q.has("cursor") && q.has("terminalId")) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), cursor: q.has("cursor") ? attendanceSelfUuid(q.get("cursor")) : null,
    terminalId: q.has("terminalId") ? attendanceSelfUuid(q.get("terminalId")) : null };
}
export function parseTerminalBody(value: unknown): { siteId: string; command: TerminalCommand } {
  const o = terminalObject(value, ["siteId", "command"]), raw = o.command as Record<string, unknown> | null;
  const c = terminalObject(raw, raw?.action === "create" ? ["action", "terminalId", "locationId", "label", "pairSecret"] : ["action", "terminalId"]);
  const terminalId = attendanceSelfUuid(c.terminalId);
  const command: TerminalCommand = c.action === "create"
    ? { action: "create", terminalId, locationId: attendanceSelfUuid(c.locationId), label: text(c.label, 80), pairSecret: terminalSecret(c.pairSecret) }
    : c.action === "revoke" ? { action: "revoke", terminalId } : fail();
  return { siteId: attendanceSelfSite(o.siteId), command };
}
export function parseTerminal(value: unknown): AttendanceTerminal {
  const o = terminalObject(value, ["id", "label", "locationId", "locationName", "timeZone", "state", "createdAt", "pairExpiresAt", "pairedAt", "deviceExpiresAt", "revokedAt"]);
  if (!["pending", "active", "expired", "revoked", "blocked"].includes(String(o.state))) fail();
  const createdAt = attendanceRecordInstant(o.createdAt), pairExpiresAt = attendanceRecordInstant(o.pairExpiresAt);
  const pairedAt = o.pairedAt === null ? null : attendanceRecordInstant(o.pairedAt);
  const deviceExpiresAt = o.deviceExpiresAt === null ? null : attendanceRecordInstant(o.deviceExpiresAt);
  const revokedAt = o.revokedAt === null ? null : attendanceRecordInstant(o.revokedAt);
  if (Date.parse(pairExpiresAt) - Date.parse(createdAt) !== 300_000 || (pairedAt === null) !== (deviceExpiresAt === null)
    || pairedAt && (pairedAt < createdAt || pairedAt >= pairExpiresAt || Date.parse(deviceExpiresAt!) - Date.parse(pairedAt) !== 30 * 86400_000)
    || revokedAt && revokedAt < (pairedAt ?? createdAt)
    || (o.state === "revoked") !== (revokedAt !== null) || o.state === "pending" && pairedAt !== null || o.state === "active" && pairedAt === null) fail();
  return { id: attendanceSelfUuid(o.id), label: text(o.label, 80), locationId: attendanceSelfUuid(o.locationId), locationName: text(o.locationName, 120),
    timeZone: attendanceTimeZone(text(o.timeZone, 100)), state: o.state as AttendanceTerminal["state"], createdAt, pairExpiresAt, pairedAt, deviceExpiresAt, revokedAt };
}
export function parseTerminalList(value: unknown, query: TerminalQuery): TerminalList {
  const o = terminalObject(value, ["siteId", "items", "nextCursor"]);
  if (o.siteId !== query.siteId || !Array.isArray(o.items) || o.items.length > (query.terminalId ? 1 : 25)) fail();
  const items = (o.items as unknown[]).map(parseTerminal);
  items.forEach((t, i) => { if (query.terminalId && t.id !== query.terminalId || query.cursor && t.id <= query.cursor || i > 0 && t.id <= items[i - 1].id) fail(); });
  const nextCursor = o.nextCursor === null ? null : attendanceSelfUuid(o.nextCursor);
  if (nextCursor && (query.terminalId || items.length !== 25 || nextCursor !== items.at(-1)?.id)) fail();
  return { siteId: query.siteId, items, nextCursor };
}
export function parseTerminalDevice(value: unknown, expected?: { siteId: string; terminalId: string }): TerminalDevice {
  const o = terminalObject(value, ["siteId", "terminal", "attendanceEnabled", "clockEnabled"]);
  const siteId = attendanceSelfSite(o.siteId), terminal = parseTerminal(o.terminal);
  if (typeof o.attendanceEnabled !== "boolean" || o.clockEnabled !== false || terminal.state !== "active"
    || expected && (expected.siteId !== siteId || expected.terminalId !== terminal.id)) fail();
  return { siteId, terminal, attendanceEnabled: o.attendanceEnabled as boolean, clockEnabled: false };
}
export const TERMINAL_ERRORS: Readonly<Record<string, { status: number; message: string }>> = {
  attendance_invalid_request: { status: 400, message: "请检查终端名称、地点和完整配对码。" },
  attendance_body_too_large: { status: 413, message: "提交内容过长。" },
  attendance_invalid_content_type: { status: 415, message: "请求格式错误。" },
  attendance_access_denied: { status: 403, message: "仅当前企业负责人可以管理终端。" },
  attendance_platform_paused: { status: 403, message: "考勤已暂停，不能新增配对；负责人仍可查看和撤销已有终端。" },
  attendance_settings_required: { status: 409, message: "请先保存企业考勤设置和工作地点。" },
  attendance_location_denied: { status: 409, message: "请选择本企业已启用的工作地点。" },
  attendance_operation_conflict: { status: 409, message: "原操作与此次内容不一致，请核对终端记录。" },
  attendance_terminal_limit: { status: 429, message: "每企业最多 20 个有效终端或待配对终端，每小时最多创建 10 次。请先撤销不用的终端或稍后重试。" },
  attendance_terminal_not_found: { status: 404, message: "没有找到此终端，请刷新列表核对。" },
  attendance_terminal_denied: { status: 403, message: "终端凭证或配对码不可用，请让负责人核对有效期、地点和撤销状态。" },
  attendance_terminal_already_paired: { status: 409, message: "此浏览器已有终端凭证。请先核对状态；更换设备绑定前请负责人撤销旧终端。" },
  attendance_rate_limited: { status: 429, message: "操作过于频繁，请稍后再试。" },
  attendance_time_reversed: { status: 409, message: "服务器时间异常，请稍后核对，不能视为已完成。" },
};
export function terminalMessage(code: string) {
  if (Object.hasOwn(TERMINAL_ERRORS, code)) return TERMINAL_ERRORS[code].message;
  if (["unauthorized", "enterprise_management_disabled", "forbidden_origin"].includes(code)) return "当前访问身份或入口不可用，请重新登录或联系负责人。";
  return "暂时无法确认结果，请读取原终端状态。不会自动重新配对。";
}
