import { ATTENDANCE_SELF_ERROR_STATUS, attendanceSelfSite, attendanceSelfUuid, parseAttendanceSelfCommand,
  parseAttendanceSelfQuery, parseAttendanceSelfResult, type AttendanceSelfCommand, type AttendanceSelfResult } from "./merchantAttendanceSelf";
import { attendanceInstant, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

export type SelfScheduleSelection = { slotId: string; revision: number };
export type SelfScheduleSlot = { id: string; revision: number; locationId: string; locationName: string; timeZone: string;
  workDate: string; startAt: string; endAt: string; cancelled: boolean; hasPublicationEvidence: boolean };
export type SelfScheduleAssociation = { startEventId: string; operationId: string; selection: SelfScheduleSelection | null;
  status: "linked" | "unselected" | "unverified";
  reason: "publication_missing" | "cancelled" | "location_changed" | "outside_window" | null;
  slot: SelfScheduleSlot | null; observedRevision: number; recordedAt: string; currentCancelled: boolean | null };
export type SelfScheduleResult = { protocol: "self-schedule-v1"; clock: AttendanceSelfResult;
  choices: { timeZone: string | null; fromDate: string | null; throughDate: string | null; revision: number; limited: boolean; entries: SelfScheduleSlot[] };
  association: SelfScheduleAssociation | null };
export type SelfScheduleHttpResult = SelfScheduleResult & { ok: true; moduleEnabled: boolean; selectionEnabled: boolean };
export type SelfScheduleParseInput = { siteId: string; command: AttendanceSelfCommand | null; operationId: string | null;
  selection?: SelfScheduleSelection | null };

export const SELF_SCHEDULE_ERRORS: Readonly<Record<string, number>> = {
  ...ATTENDANCE_SELF_ERROR_STATUS, attendance_self_schedule_disabled: 403, attendance_self_schedule_invalid: 503,
  attendance_not_available: 404, unauthorized: 401, employee_password_authentication_required: 403,
  enterprise_management_disabled: 403, forbidden_origin: 403, attendance_unavailable: 503,
};
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(k => typeof k !== "string" || !keys.includes(k))
    || keys.some(k => !Object.hasOwn(descriptors, k) || !Object.hasOwn(descriptors[k], "value"))) return invalid();
  return value as Record<string, unknown>;
}
function version(value: unknown, min = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : invalid();
}
function bool(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function text(value: unknown, limit = 120): string {
  return typeof value === "string" && value.length > 0 && [...value].length <= limit && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid();
}
function day(value: unknown): string {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value < "2000-01-01" || value > "2100-12-31") return invalid();
  attendanceInstant(`${value}T00:00:00.000Z`); return value;
}
function instant(value: unknown): string { const s = text(value, 24); attendanceInstant(s); return s; }
function recorded(value: unknown): string {
  if (typeof value !== "string" || value.length !== 27 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return invalid();
  attendanceInstant(`${value.slice(0, 23)}Z`); return value;
}
function site(value: unknown): string { const s = attendanceSelfSite(value); if (s.length !== 8) invalid(); return s; }
export function parseSelfScheduleSelection(value: unknown): SelfScheduleSelection | null {
  if (value === null) return null;
  const v = object(value, ["slotId", "revision"]);
  return { slotId: attendanceSelfUuid(v.slotId), revision: version(v.revision, 1) };
}
export function parseSelfScheduleBody(value: unknown): { siteId: string; command: AttendanceSelfCommand; selection: SelfScheduleSelection | null } {
  const v = object(value, ["siteId", "command", "selection"]);
  const c = object(v.command, ["expectedWorkerId", "operationId", "locationId", "action", "expectedSequence"]);
  const parsed = parseAttendanceSelfCommand({ ...c, siteId: site(v.siteId) });
  if (parsed.command.action !== "clock_in") invalid();
  return { ...parsed, selection: parseSelfScheduleSelection(v.selection) };
}
export function parseSelfScheduleQuery(url: string) {
  const result = parseAttendanceSelfQuery(url); site(result.siteId); return result;
}
function slot(value: unknown): SelfScheduleSlot {
  const v = object(value, ["id", "revision", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "cancelled", "hasPublicationEvidence"]);
  const startAt = instant(v.startAt), endAt = instant(v.endAt), start = Date.parse(startAt), end = Date.parse(endAt);
  if (end <= start || end - start > 86400000 || start % 60000 || end % 60000) invalid();
  // The saved workDate/UTC mapping is historical evidence; do not recompute it
  // against a browser's current timezone database.
  return { id: attendanceSelfUuid(v.id), revision: version(v.revision, 1), locationId: attendanceSelfUuid(v.locationId),
    locationName: text(v.locationName), timeZone: attendanceTimeZone(text(v.timeZone, 100)), workDate: day(v.workDate),
    startAt, endAt, cancelled: bool(v.cancelled), hasPublicationEvidence: bool(v.hasPublicationEvidence) };
}

export function parseSelfScheduleResult(value: unknown, input: SelfScheduleParseInput): SelfScheduleResult {
  const v = object(value, ["protocol", "clock", "choices", "association"]);
  site(input.siteId);
  if (v.protocol !== "self-schedule-v1" || (input.command && input.operationId !== null)) invalid();
  if (input.command) parseSelfScheduleBody({ siteId: input.siteId, command: input.command, selection: input.selection ?? null });
  const rawClock = object(v.clock, ["workerId", "locationId", "state", "receipt", "replayed"]);
  const clock = parseAttendanceSelfResult(rawClock, input);
  const c = object(v.choices, ["timeZone", "fromDate", "throughDate", "revision", "limited", "entries"]);
  const revision = version(c.revision), limited = bool(c.limited);
  if (!Array.isArray(c.entries) || c.entries.length > 100 || limited && c.entries.length) invalid();
  const entries = (c.entries as unknown[]).map(slot);
  let timeZone: string | null = null, fromDate: string | null = null, throughDate: string | null = null;
  if (c.timeZone === null) {
    if (c.fromDate !== null || c.throughDate !== null || entries.length || limited) invalid();
  } else {
    timeZone = attendanceTimeZone(text(c.timeZone, 100)); fromDate = day(c.fromDate); throughDate = day(c.throughDate);
    const span = Date.parse(throughDate) - Date.parse(fromDate);
    if (span < 0 || span > 2 * 86400000) invalid();
  }
  if (new Set(entries.map(e => e.id)).size !== entries.length || entries.some(e => e.revision > revision
    || e.workDate < fromDate! || e.workDate > throughDate! || e.locationId !== clock.locationId)) invalid();
  let association: SelfScheduleAssociation | null = null;
  if (v.association !== null) {
    const a = object(v.association, ["startEventId", "operationId", "selection", "status", "reason", "slot", "observedRevision", "recordedAt", "currentCancelled"]);
    const selection = parseSelfScheduleSelection(a.selection), selectedSlot = a.slot === null ? null : slot(a.slot);
    const observedRevision = version(a.observedRevision), currentCancelled = a.currentCancelled === null ? null : bool(a.currentCancelled);
    if (!clock.receipt || clock.receipt.action !== "clock_in" || a.startEventId !== clock.receipt.id || a.operationId !== clock.receipt.operationId
      || observedRevision > revision) invalid();
    if (!["linked", "unselected", "unverified"].includes(a.status as string)) invalid();
    if (a.status === "unselected") {
      if (selection !== null || selectedSlot !== null || a.reason !== null || currentCancelled !== null) invalid();
    } else {
      if (!selection || !selectedSlot || selection.slotId !== selectedSlot.id || selection.revision !== selectedSlot.revision
        || selection.revision > observedRevision || currentCancelled === null) invalid();
      if (a.status === "linked" && (a.reason !== null || selectedSlot.cancelled || !selectedSlot.hasPublicationEvidence
        || selectedSlot.locationId !== clock.receipt.locationId)) invalid();
      if (a.status === "unverified" && !["publication_missing", "cancelled", "location_changed", "outside_window"].includes(a.reason as string)) invalid();
    }
    if ((input.command || input.selection !== undefined)
      && JSON.stringify(selection) !== JSON.stringify(parseSelfScheduleSelection(input.selection ?? null))) invalid();
    association = { startEventId: attendanceSelfUuid(a.startEventId), operationId: attendanceSelfUuid(a.operationId), selection,
      status: a.status as SelfScheduleAssociation["status"], reason: a.reason as SelfScheduleAssociation["reason"], slot: selectedSlot,
      observedRevision, recordedAt: recorded(a.recordedAt), currentCancelled };
  } else if (input.command && !clock.replayed) invalid();
  return { protocol: "self-schedule-v1", clock, choices: { timeZone, fromDate, throughDate, revision, limited, entries }, association };
}

export function parseSelfScheduleHttpResult(value: unknown, input: SelfScheduleParseInput): SelfScheduleHttpResult {
  const v = object(value, ["ok", "moduleEnabled", "selectionEnabled", "protocol", "clock", "choices", "association"]);
  if (v.ok !== true) invalid();
  const moduleEnabled = bool(v.moduleEnabled), selectionEnabled = bool(v.selectionEnabled);
  if (selectionEnabled && !moduleEnabled) invalid();
  const result = parseSelfScheduleResult({ protocol: v.protocol, clock: v.clock, choices: v.choices, association: v.association }, input);
  if (!selectionEnabled && result.choices.entries.length) invalid();
  return { ok: true, ...result, moduleEnabled, selectionEnabled };
}
