// Independent read-only UTC checks. No clock mutation, timezone remapping,
// rounding, payroll calculation, plan allocation or result ledger.
import { captureBrowserExact as exact, captureBrowserUuid as uuid } from "./merchantAttendanceRuleCapturesBrowser";
import { parseShiftRuleViewQuery, parseShiftRuleViewHttpQuery, shiftRuleViewQueryString, parseShiftRuleViewResult,
  SHIFT_RULE_VIEW_ERRORS, type ShiftRuleViewQuery, type ShiftRuleViewResult } from "./merchantAttendanceShiftRuleView";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseCorrectionProposal, type CorrectionProposal } from "./merchantAttendanceCorrection";
import type { AttendanceSessionEvent, AttendanceSessionBreak } from "./merchantAttendanceSession";
import type { AttendanceTimesheetLineage } from "./merchantAttendanceTimesheet";
import type { SelfScheduleAssociation, SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";

export const SHIFT_CHECK_BYTE_LIMIT = 1048576;
export type ShiftCheckQuery = ShiftRuleViewQuery;
export const parseShiftCheckQuery = parseShiftRuleViewQuery, parseShiftCheckHttpQuery = parseShiftRuleViewHttpQuery, shiftCheckQueryString = shiftRuleViewQueryString;
export const SHIFT_CHECK_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...SHIFT_RULE_VIEW_ERRORS,
  attendance_shift_check_invalid: 503, attendance_shift_check_too_large: 422, attendance_session_invalid_records: 422,
  attendance_session_too_large: 422, attendance_session_span_too_long: 422, attendance_report_invalid_data: 503,
  attendance_report_too_large: 422, attendance_self_schedule_invalid: 503,
});
export type ShiftCheckSpan = { status: "completed" | "working" | "break"; startAt: string; endAt: string | null; timeZone: string;
  breaks: AttendanceSessionBreak[]; openBreak: { startAt: string; paid: boolean } | null };
export type ShiftThresholdCheck = { state: "unavailable" | "unconfigured" | "disabled" | "not_applicable" | "triggered" | "not_triggered";
  minutes: number | null; elapsedUs: string | null };
export type ShiftBreakCheck = AttendanceSessionBreak & { durationUs: string; state: ShiftThresholdCheck["state"]; minutes: number | null };
export type ShiftPlanDifference = { startDeltaUs: string; endDeltaUs: string | null };
export type ShiftCheckEffect = { requestId: string; operationId: string; revision: number; policyRevision: number; action: "approve";
  originalLastEventId: string; recordedAt: string; employeeId: string; timeZone: string; proposal: CorrectionProposal;
  calculationVersion: "declaration-v1"; elapsedUs: number; workedUs: number; breakUs: number; paidBreakUs: number; lineage: AttendanceTimesheetLineage };
export type ShiftCheckData = { protocol: "shift-check-v1"; algorithmVersion: "single-shift-thresholds-v1"; readOnly: true; formalReady: false;
  asOf: string; rule: ShiftRuleViewResult; events: AttendanceSessionEvent[]; effect: ShiftCheckEffect | null; relation: SelfScheduleAssociation | null };
export type ShiftCheckResult = ShiftCheckData & { original: ShiftCheckSpan; approved: ShiftCheckSpan | null;
  checks: { open: ShiftThresholdCheck; breakRule: { state: "unavailable" | "unconfigured" | "disabled" | "value"; minutes: number | null };
    originalBreaks: ShiftBreakCheck[]; approvedBreaks: ShiftBreakCheck[] | null };
  plan: { original: ShiftPlanDifference | null; approved: ShiftPlanDifference | null } };
export type ShiftCheckResponse = ShiftCheckResult & { moduleEnabled: boolean };
const fail = (): never => { throw new MerchantAttendanceError("attendance_shift_check_invalid"); };
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
function label(v: unknown, max = 120): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  return v;
}
function stamp(v: unknown, digits: 3 | 6 = 6): string {
  if (typeof v !== "string" || !(digits === 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(v)
    || v < "2000-01-01" || v >= "2101-01-01") return fail();
  const shortened = v.slice(0, 23) + "Z", ms = Date.parse(shortened);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== shortened) fail(); return v;
}
const us = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.length === 27 ? s.slice(23, 26) : "0");
const duration = (a: string, b: string) => us(b) - us(a);
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
// Validate data descriptors before reading any source graph/property. Sparse
// arrays, accessors, aliases with cycles and lossy JSON values fail closed.
export function validateShiftCheckTree(raw: unknown): void {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 50000 || depth > 24) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") {
      if (v.length > SHIFT_CHECK_BYTE_LIMIT) fail();
      for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
        else if (c >= 0xdc00 && c <= 0xdfff) fail(); }
      return;
    }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail();
    ancestors.add(v); const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 2002 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    }
    ancestors.delete(v);
  };
  visit(raw, 0);
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > SHIFT_CHECK_BYTE_LIMIT) throw new MerchantAttendanceError("attendance_shift_check_too_large");
}
function originalEvents(raw: unknown, rule: ShiftRuleViewResult, asOf: string): { events: AttendanceSessionEvent[]; original: ShiftCheckSpan } {
  if (!Array.isArray(raw) || !raw.length || raw.length > 2002) return fail();
  const ids = new Set<string>(), events: AttendanceSessionEvent[] = [], first = rule.event;
  const original: ShiftCheckSpan = { status: "working", startAt: first.occurredAt, endAt: null, timeZone: first.timeZone, breaks: [], openBreak: null };
  for (const item of raw) {
    const e = exact(item, ["id", "locationId", "sequence", "action", "occurredAt", "timeZone", "breakPaid", "source"]);
    if (!["clock_in", "break_start", "break_end", "clock_out"].includes(e.action as string) || !["web", "kiosk"].includes(e.source as string)
      || (e.action === "break_start" ? typeof e.breakPaid !== "boolean" : e.breakPaid !== null)) fail();
    const event: AttendanceSessionEvent = { id: uuid(e.id), locationId: uuid(e.locationId), sequence: integer(e.sequence, 1),
      action: e.action as AttendanceSessionEvent["action"], occurredAt: stamp(e.occurredAt), timeZone: label(e.timeZone, 100), breakPaid: e.breakPaid as boolean | null, source: e.source as "web" | "kiosk" };
    if (ids.has(event.id) || event.occurredAt > asOf) fail(); ids.add(event.id);
    const previous = events.at(-1);
    if (!previous) {
      if (event.id !== first.startEventId || event.action !== "clock_in" || event.sequence !== first.sequence || event.occurredAt !== first.occurredAt
        || event.timeZone !== first.timeZone || event.locationId !== first.locationId || event.source !== first.source) fail();
    } else {
      if (event.sequence !== previous.sequence + 1 || event.occurredAt < previous.occurredAt || original.status === "completed") fail();
      if (event.action === "break_start" && original.status === "working") {
        if (original.breaks.length >= 1000) fail(); original.openBreak = { startAt: event.occurredAt, paid: event.breakPaid! }; original.status = "break";
      } else if (event.action === "break_end" && original.status === "break" && original.openBreak) {
        original.breaks.push({ ...original.openBreak, endAt: event.occurredAt }); original.openBreak = null; original.status = "working";
      } else if (event.action === "clock_out" && original.status === "working") { original.endAt = event.occurredAt; original.status = "completed"; }
      else fail();
    }
    events.push(event);
  }
  if (original.endAt !== null && duration(original.startAt, original.endAt) > BigInt(2678400000000)) fail();
  return { events, original };
}
function approvedEffect(raw: unknown, original: ShiftCheckSpan, events: AttendanceSessionEvent[], rule: ShiftRuleViewResult, asOf: string): { effect: ShiftCheckEffect | null; approved: ShiftCheckSpan | null } {
  if (raw === null) return { effect: null, approved: null };
  const e = exact(raw, ["requestId", "operationId", "revision", "policyRevision", "action", "originalLastEventId", "recordedAt", "employeeId", "timeZone", "proposal", "calculationVersion", "elapsedUs", "workedUs", "breakUs", "paidBreakUs", "lineage"]);
  const requestId = uuid(e.requestId), operationId = uuid(e.operationId), recordedAt = stamp(e.recordedAt), revision = integer(e.revision, 1, 2147483647), policyRevision = integer(e.policyRevision, 1, 9007199254740989);
  if (original.status !== "completed" || e.action !== "approve" || e.calculationVersion !== "declaration-v1" || e.originalLastEventId !== events.at(-1)!.id
    || e.employeeId !== rule.worker.employeeId || e.timeZone !== original.timeZone || recordedAt > asOf || recordedAt < original.endAt!) fail();
  const p = exact(e.proposal, ["startAt", "endAt", "breaks"]); stamp(p.startAt); stamp(p.endAt);
  if (!Array.isArray(p.breaks) || p.breaks.length > 32) fail();
  for (const rawBreak of p.breaks as unknown[]) { const b = exact(rawBreak, ["startAt", "endAt", "paid"]); stamp(b.startAt); stamp(b.endAt); bool(b.paid); }
  const proposal = parseCorrectionProposal(p, recordedAt);
  const elapsedUs = Number(duration(proposal.startAt, proposal.endAt)), breakUs = proposal.breaks.reduce((n, b) => n + Number(duration(b.startAt, b.endAt)), 0),
    paidBreakUs = proposal.breaks.reduce((n, b) => n + (b.paid ? Number(duration(b.startAt, b.endAt)) : 0), 0), workedUs = elapsedUs - breakUs;
  if (integer(e.elapsedUs) !== elapsedUs || integer(e.workedUs) !== workedUs || integer(e.breakUs) !== breakUs || integer(e.paidBreakUs) !== paidBreakUs) fail();
  const l = exact(e.lineage, ["rootRequestId", "rootOperationId", "rootRecordedAt", "previousOperationId"]);
  const lineage: AttendanceTimesheetLineage = { rootRequestId: uuid(l.rootRequestId), rootOperationId: uuid(l.rootOperationId), rootRecordedAt: stamp(l.rootRecordedAt), previousOperationId: l.previousOperationId === null ? null : uuid(l.previousOperationId) };
  if (lineage.rootRecordedAt < original.endAt! || lineage.rootRecordedAt > recordedAt || (revision === 1
    ? lineage.rootRequestId !== requestId || lineage.rootOperationId !== operationId || lineage.rootRecordedAt !== recordedAt || lineage.previousOperationId !== null
    : lineage.rootRequestId === requestId || lineage.rootOperationId === operationId || lineage.rootRecordedAt >= recordedAt || lineage.previousOperationId === null || lineage.previousOperationId === operationId
      || (revision === 2 ? lineage.previousOperationId !== lineage.rootOperationId : lineage.previousOperationId === lineage.rootOperationId))) fail();
  return { effect: { requestId, operationId, revision, policyRevision, action: "approve", originalLastEventId: events.at(-1)!.id, recordedAt,
    employeeId: rule.worker.employeeId, timeZone: original.timeZone, proposal, calculationVersion: "declaration-v1", elapsedUs, workedUs, breakUs, paidBreakUs, lineage },
    approved: { status: "completed", ...proposal, timeZone: original.timeZone, openBreak: null } };
}
function association(raw: unknown, rule: ShiftRuleViewResult, asOf: string): SelfScheduleAssociation | null {
  if (raw === null) return null;
  const a = exact(raw, ["startEventId", "operationId", "selection", "status", "reason", "slot", "observedRevision", "recordedAt", "currentCancelled"]), recordedAt = stamp(a.recordedAt);
  if (a.startEventId !== rule.event.startEventId || a.operationId !== rule.event.operationId || recordedAt > asOf
    || !["linked", "unselected", "unverified"].includes(a.status as string)) fail();
  const observedRevision = integer(a.observedRevision), currentCancelled = a.currentCancelled === null ? null : bool(a.currentCancelled);
  let selection: SelfScheduleAssociation["selection"] = null, slot: SelfScheduleSlot | null = null;
  if (a.status === "unselected") { if (a.selection !== null || a.slot !== null || a.reason !== null || currentCancelled !== null) fail(); }
  else {
    const s = exact(a.selection, ["slotId", "revision"]), b = exact(a.slot, ["id", "revision", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "cancelled", "hasPublicationEvidence"]);
    selection = { slotId: uuid(s.slotId), revision: integer(s.revision, 1) };
    const startAt = stamp(b.startAt, 3), endAt = stamp(b.endAt, 3), workDate = label(b.workDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) fail(); stamp(workDate + "T00:00:00.000Z", 3);
    slot = { id: uuid(b.id), revision: integer(b.revision, 1), locationId: uuid(b.locationId), locationName: label(b.locationName), timeZone: label(b.timeZone, 100),
      workDate, startAt, endAt, cancelled: bool(b.cancelled), hasPublicationEvidence: bool(b.hasPublicationEvidence) };
    if (slot.id !== selection.slotId || slot.revision !== selection.revision || slot.revision > observedRevision || currentCancelled === null
      || duration(startAt, endAt) <= BigInt(0) || duration(startAt, endAt) > BigInt(86400000000) || us(startAt) % BigInt(60000000) || us(endAt) % BigInt(60000000) || slot.cancelled && !currentCancelled) fail();
    if (a.status === "linked" && (a.reason !== null || slot.cancelled || !slot.hasPublicationEvidence || slot.locationId !== rule.event.locationId)) fail();
    if (a.status === "unverified") {
      // Preserve137's original priority and saved outside-window decision;
      // today's timezone database cannot reinterpret that historical window.
      const expected = slot.cancelled ? "cancelled" : slot.locationId !== rule.event.locationId ? "location_changed"
        : a.reason === "outside_window" ? "outside_window" : !slot.hasPublicationEvidence ? "publication_missing" : null;
      if (expected === null || a.reason !== expected) fail();
    }
  }
  return { startEventId: rule.event.startEventId, operationId: rule.event.operationId, selection, status: a.status as SelfScheduleAssociation["status"],
    reason: a.reason as SelfScheduleAssociation["reason"], slot, observedRevision, recordedAt, currentCancelled };
}
export function parseShiftCheckResult(raw: unknown, query: ShiftCheckQuery, actorId: string): ShiftCheckResult {
  try {
    validateShiftCheckTree(raw);
    const v = exact(raw, ["protocol", "algorithmVersion", "readOnly", "formalReady", "asOf", "rule", "events", "effect", "relation"]);
    if (v.protocol !== "shift-check-v1" || v.algorithmVersion !== "single-shift-thresholds-v1" || v.readOnly !== true || v.formalReady !== false) fail();
    const asOf = stamp(v.asOf), rule = parseShiftRuleViewResult(v.rule, query, actorId);
    if (rule.readAt > asOf) fail();
    const { events, original } = originalEvents(v.events, rule, asOf), { effect, approved } = approvedEffect(v.effect, original, events, rule, asOf), relation = association(v.relation, rule, asOf);
    const field = (key: "openSpanWarningMinutes" | "completedBreakMinimumMinutes"): ShiftCheckResult["checks"]["breakRule"] => {
      const item = rule.evidence?.fields[key]; return item ? { state: item.state, minutes: item.minutes } : { state: "unavailable", minutes: null };
    };
    const openRule = field("openSpanWarningMinutes"), breakRule = field("completedBreakMinimumMinutes"), elapsedUs = original.endAt === null ? duration(original.startAt, asOf) : null;
    const open: ShiftThresholdCheck = { state: original.endAt !== null ? "not_applicable" : openRule.state === "value"
      ? elapsedUs! >= BigInt(openRule.minutes!) * BigInt(60000000) ? "triggered" : "not_triggered" : openRule.state, minutes: openRule.minutes, elapsedUs: elapsedUs?.toString() ?? null };
    const breaks = (span: ShiftCheckSpan): ShiftBreakCheck[] => span.breaks.map(b => { const durationUs = duration(b.startAt, b.endAt); return { ...b, durationUs: durationUs.toString(), minutes: breakRule.minutes,
      state: breakRule.state === "value" ? durationUs < BigInt(breakRule.minutes!) * BigInt(60000000) ? "triggered" : "not_triggered" : breakRule.state }; });
    const difference = (span: ShiftCheckSpan | null): ShiftPlanDifference | null => span && relation?.status === "linked" && relation.slot
      ? { startDeltaUs: (us(span.startAt) - us(relation.slot.startAt)).toString(), endDeltaUs: span.endAt === null ? null : (us(span.endAt) - us(relation.slot.endAt)).toString() } : null;
    return freeze({ protocol: "shift-check-v1", algorithmVersion: "single-shift-thresholds-v1", readOnly: true, formalReady: false, asOf, rule, events, effect, relation,
      original, approved, checks: { open, breakRule, originalBreaks: breaks(original), approvedBreaks: approved ? breaks(approved) : null }, plan: { original: difference(original), approved: difference(approved) } });
  } catch (error) { if (error instanceof MerchantAttendanceError && error.code === "attendance_shift_check_too_large") throw error; return fail(); }
}
export function parseShiftCheckData(raw: unknown, query: ShiftCheckQuery, actorId: string): ShiftCheckData {
  const r = parseShiftCheckResult(raw, query, actorId);
  return freeze({ protocol: r.protocol, algorithmVersion: r.algorithmVersion, readOnly: true, formalReady: false, asOf: r.asOf, rule: r.rule, events: r.events, effect: r.effect, relation: r.relation });
}
export function parseShiftCheckResponse(raw: unknown, query: ShiftCheckQuery, actorId: string): ShiftCheckResponse {
  try { validateShiftCheckTree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail();
    return freeze({ ...parseShiftCheckResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) });
  } catch (error) { if (error instanceof MerchantAttendanceError && error.code === "attendance_shift_check_too_large") throw error; return fail(); }
}
export function formatShiftCheckDuration(value: string): string {
  if (!/^-?(0|[1-9]\d{0,15})$/.test(value) || value === "-0") return fail();
  const number = BigInt(value), absolute = number < BigInt(0) ? -number : number, seconds = absolute / BigInt(1000000), fraction = String(absolute % BigInt(1000000)).padStart(6, "0").replace(/0+$/, "");
  return `${number < BigInt(0) ? "−" : ""}${seconds / BigInt(3600)} 小时 ${(seconds / BigInt(60)) % BigInt(60)} 分 ${seconds % BigInt(60)}${fraction ? "." + fraction : ""} 秒`;
}
