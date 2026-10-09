import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type ShiftTemplate = { name: string; segments: { start: string; end: string; nextDay: boolean }[] };
export type ShiftTemplateItem = { templateId: string; revision: number; template: ShiftTemplate; archived: boolean; updatedAt: string };
export type ShiftTemplatesQuery = { siteId: string; view: "active" | "archived"; cursorId: string | null; operationId: string | null };
export type ShiftTemplateCommand = { operationId: string; templateId: string; expectedRevision: number } &
  ({ action: "save"; template: ShiftTemplate } | { action: "archive"; template: null });
export type ShiftTemplatesResult = { siteId: string; view: "active" | "archived"; items: ShiftTemplateItem[]; nextCursor: string | null;
  receipt: null | { command: ShiftTemplateCommand; item: ShiftTemplateItem } };
export const SHIFT_TEMPLATE_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_platform_paused: 403,
  attendance_template_archived: 409, attendance_template_limit: 409, attendance_rate_limited: 429,
  attendance_not_available: 404, attendance_unavailable: 503, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const exact = (raw: unknown, keys: string[]) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  return v;
};
const revision = (raw: unknown, min: number, max = 9007199254740989) => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max ? raw : fail();
const minutes = (raw: unknown) => {
  if (typeof raw !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return fail();
  return Number(raw.slice(0, 2)) * 60 + Number(raw.slice(3));
};
export function parseShiftTemplate(raw: unknown): ShiftTemplate {
  const v = exact(raw, ["name", "segments"]);
  if (typeof v.name !== "string" || v.name !== v.name.trim() || !v.name || [...v.name].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(v.name)
    || !Array.isArray(v.segments) || !v.segments.length || v.segments.length > 4) return fail();
  let previousEnd = -1;
  const segments = v.segments.map(rawSegment => {
    const s = exact(rawSegment, ["start", "end", "nextDay"]);
    if (typeof s.nextDay !== "boolean") return fail();
    const start = minutes(s.start), end = minutes(s.end) + (s.nextDay ? 1440 : 0);
    if (end <= start || end - start > 1440 || start < previousEnd) fail();
    previousEnd = end;
    return { start: s.start as string, end: s.end as string, nextDay: s.nextDay };
  });
  return { name: v.name, segments };
}
export const templateDaySlots = (template: ShiftTemplate) => parseShiftTemplate(template).segments;
export const templateNominalMinutes = (template: ShiftTemplate) => templateDaySlots(template)
  .reduce((sum, s) => sum + minutes(s.end) + (s.nextDay ? 1440 : 0) - minutes(s.start), 0);
export function parseShiftTemplatesQuery(raw: unknown): ShiftTemplatesQuery {
  const q = exact(raw, ["siteId", "view", "cursorId", "operationId"]);
  if (q.view !== "active" && q.view !== "archived" || q.cursorId !== null && q.operationId !== null) return fail();
  return { siteId: attendanceSelfSite(q.siteId), view: q.view,
    cursorId: q.cursorId === null ? null : attendanceSelfUuid(q.cursorId), operationId: q.operationId === null ? null : attendanceSelfUuid(q.operationId) };
}
export function parseShiftTemplatesHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { cursorId: null, operationId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); q[key] = value; }
  return parseShiftTemplatesQuery(q);
}
export const shiftTemplatesQueryString = (q: ShiftTemplatesQuery) => new URLSearchParams(Object.entries(q)
  .filter((entry): entry is [string, string] => entry[1] !== null)).toString();
export function parseShiftTemplateCommand(raw: unknown): ShiftTemplateCommand {
  const c = exact(raw, ["operationId", "templateId", "expectedRevision", "action", "template"]);
  const base = { operationId: attendanceSelfUuid(c.operationId), templateId: attendanceSelfUuid(c.templateId), expectedRevision: revision(c.expectedRevision, 0) };
  if (c.action === "save") {
    if (base.expectedRevision === 0 && base.operationId !== base.templateId) fail();
    return { ...base, action: "save", template: parseShiftTemplate(c.template) };
  }
  if (c.action !== "archive" || c.template !== null || base.expectedRevision < 1) return fail();
  return { ...base, action: "archive", template: null };
}
export function parseShiftTemplatesBody(raw: unknown) {
  const body = exact(raw, ["query", "command"]), query = parseShiftTemplatesQuery(body.query), command = parseShiftTemplateCommand(body.command);
  if (query.cursorId !== null || query.operationId !== null) fail();
  return { query, command };
}
export function parseShiftTemplateItem(raw: unknown): ShiftTemplateItem {
  const item = exact(raw, ["templateId", "revision", "template", "archived", "updatedAt"]), updatedAt = attendanceRecordInstant(item.updatedAt);
  if (typeof item.archived !== "boolean" || updatedAt !== item.updatedAt) return fail();
  return { templateId: attendanceSelfUuid(item.templateId), revision: revision(item.revision, 1, 9007199254740990), template: parseShiftTemplate(item.template), archived: item.archived, updatedAt };
}
export function sameShiftTemplateCommand(a: ShiftTemplateCommand, b: ShiftTemplateCommand) {
  return JSON.stringify(parseShiftTemplateCommand(a)) === JSON.stringify(parseShiftTemplateCommand(b));
}
export function parseShiftTemplatesResult(raw: unknown, input: ShiftTemplatesQuery, command: ShiftTemplateCommand | null = null): ShiftTemplatesResult {
  const q = parseShiftTemplatesQuery(input), v = exact(raw, ["siteId", "view", "items", "nextCursor", "receipt"]);
  if (v.siteId !== q.siteId || v.view !== q.view || !Array.isArray(v.items) || v.items.length > 20) return fail();
  let previous = q.cursorId;
  const items = v.items.map(rawItem => {
    const item = parseShiftTemplateItem(rawItem);
    if (item.archived !== (q.view === "archived") || previous && item.templateId >= previous) fail();
    previous = item.templateId; return item;
  });
  const nextCursor = v.nextCursor === null ? null : attendanceSelfUuid(v.nextCursor);
  if (nextCursor && (items.length !== 20 || nextCursor !== previous)) fail();
  let receipt: ShiftTemplatesResult["receipt"] = null;
  if (v.receipt !== null) {
    const r = exact(v.receipt, ["command", "item"]), c = parseShiftTemplateCommand(r.command), item = parseShiftTemplateItem(r.item);
    if (c.operationId !== (command?.operationId ?? q.operationId) || c.templateId !== item.templateId || c.expectedRevision + 1 !== item.revision
      || item.archived !== (c.action === "archive") || c.action === "save" && JSON.stringify(item.template) !== JSON.stringify(c.template)
      || command && !sameShiftTemplateCommand(c, command)) fail();
    receipt = { command: c, item };
  }
  if (command && !receipt) fail();
  return { siteId: q.siteId, view: q.view, items, nextCursor, receipt };
}
export function parseShiftTemplatesResponse(raw: unknown, q: ShiftTemplatesQuery, command: ShiftTemplateCommand | null = null) {
  const v = exact(raw, ["ok", "moduleEnabled", "siteId", "view", "items", "nextCursor", "receipt"]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
  const { ok, moduleEnabled, ...rest } = v; void ok;
  return { ...parseShiftTemplatesResult(rest, q, command), moduleEnabled };
}
