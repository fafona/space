// Browser-safe PIN selection protocol. All reads are PIN-authenticated POSTs;
// no PIN, terminal secret, verifier or lease is ever a response field.
import { PIN_CLOCK_ERRORS, parsePinClockBody, parsePinClockResult, type PinClockCommand, type PinClockResult } from "./merchantAttendancePinClock";
import { pinWorkerNo } from "./merchantAttendancePin";
import { parseSelfScheduleResult, parseSelfScheduleSelection, type SelfScheduleAssociation, type SelfScheduleResult,
  type SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import type { LocationScheduleAdoption, LocationScheduleApprovalReference } from "./merchantAttendanceLocationSchedule";
import { captureBrowserExact as exact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const PIN_SCHEDULE_API = "/api/merchant-enterprise/attendance/terminal-schedule";
export const PIN_SCHEDULE_BYTE_LIMIT = 65536;
export const PIN_SCHEDULE_BODY_BYTE_LIMIT = 8192;
export type PinScheduleSelection = SelfScheduleSelection;
export type PinScheduleBody = { workerNo: string; pin: string; command: PinClockCommand | null; operationId: string | null; selection: SelfScheduleSelection | null };
export type PinScheduleApprovalReference = LocationScheduleApprovalReference;
export type PinScheduleAdoption = Omit<LocationScheduleAdoption, "channel"> & { channel: "pin" };
export type PinScheduleResult = { protocol: "pin-schedule-v1"; clock: PinClockResult; choices: SelfScheduleResult["choices"];
  association: SelfScheduleAssociation | null; adoption: PinScheduleAdoption | null };
export type PinScheduleHttpResult = PinScheduleResult & { ok: true; moduleEnabled: boolean; selectionEnabled: boolean };
export type PinScheduleParseInput = { siteId: string; terminalId: string; workerNo: string; command: PinClockCommand | null;
  operationId: string | null; selection: SelfScheduleSelection | null; expectedSelection?: SelfScheduleSelection | null;
  expectedWorkerId?: string; expectedEmployeeId?: string; expectedEmployeeAuthUserId?: string };
export const PIN_SCHEDULE_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...PIN_CLOCK_ERRORS,
  attendance_pin_schedule_disabled: 403, attendance_pin_schedule_invalid: 503, attendance_self_schedule_invalid: 503,
  attendance_plan_rule_invalid: 503, attendance_plan_rule_identity_changed: 409, attendance_schedule_invalid: 503,
  attendance_shift_rule_binding_invalid: 503,
  attendance_worker_not_found: 404, attendance_not_available: 404, attendance_unavailable: 503,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, attendance_rate_limited: 429,
  forbidden_origin: 403, enterprise_entitlement_unavailable: 503,
});
const fail = (code = "attendance_pin_schedule_invalid"): never => { throw new MerchantAttendanceError(code); };
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0)
  && v >= min && v <= 9007199254740990 ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const COMMAND_KEYS = ["expectedWorkerId", "expectedEmployeeId", "operationId", "locationId", "action", "expectedSequence"];
const CLOCK_KEYS = ["siteId", "terminalId", "workerNo", "workerName", "employeeId", "workerId", "locationId", "state", "receipt", "replayed", "canStart", "canFinish", "blockReason"];
const RESULT_KEYS = ["protocol", "clock", "choices", "association", "adoption"];
const EVENT_KEYS = ["id", "siteId", "workerId", "locationId", "operationId", "action", "breakPaid", "sequence", "occurredAt", "timeZone"];
function stamp(v: unknown, precision: 3 | 6 = 6): string {
  if (typeof v !== "string" || v.length !== (precision === 3 ? 24 : 27) || v.startsWith("0000-")
    || !(precision === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v)) return fail();
  const short = v.slice(0, 23) + "Z", ms = Date.parse(short);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== short) return fail(); return v;
}
function wellFormed(value: string) {
  for (let i = 0; i < value.length; i++) { const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
    else if (n >= 0xdc00 && n <= 0xdfff) fail(); }
}
function tree(raw: unknown, limit = PIN_SCHEDULE_BYTE_LIMIT) {
  let count = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++count > 6000 || depth > 18) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > limit) fail(); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail();
    ancestors.add(v); const keys = Reflect.ownKeys(v), descriptors = Object.getOwnPropertyDescriptors(v), proto = Object.getPrototypeOf(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 100 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    }
    ancestors.delete(v);
  };
  visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail();
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
/** Callers decode UTF-8 fatally before JSON parsing. This decoder rejects duplicate
 * names and dangerous trees; request failures are 400, malformed success is 503. */
export function parsePinScheduleJson(text: string, kind: "request" | "response" = "response"): unknown {
  try { if (kind !== "request" && kind !== "response") fail();
    const limit = kind === "request" ? PIN_SCHEDULE_BODY_BYTE_LIMIT : PIN_SCHEDULE_BYTE_LIMIT;
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limit) fail();
    const value = parseCaptureBrowserJson(text); tree(value, limit); return value;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : "attendance_pin_schedule_invalid"); }
}
function commandData(raw: unknown): PinClockCommand {
  tree(raw, PIN_SCHEDULE_BODY_BYTE_LIMIT); const c = exact(raw, COMMAND_KEYS);
  if (c.action !== "clock_in") return fail();
  return { expectedWorkerId: uuid(c.expectedWorkerId), expectedEmployeeId: uuid(c.expectedEmployeeId), operationId: uuid(c.operationId),
    locationId: uuid(c.locationId), action: "clock_in", expectedSequence: integer(c.expectedSequence) };
}
function selected(raw: unknown): SelfScheduleSelection | null {
  if (raw === null) return null; tree(raw, PIN_SCHEDULE_BODY_BYTE_LIMIT); const s = exact(raw, ["slotId", "revision"]);
  return { slotId: uuid(s.slotId), revision: integer(s.revision, 1) };
}
export function parsePinScheduleBody(raw: unknown): PinScheduleBody {
  try { tree(raw, PIN_SCHEDULE_BODY_BYTE_LIMIT); const b = exact(raw, ["workerNo", "pin", "command", "operationId", "selection"]);
    // The old grammar remains untouched; reject a trailing newline explicitly
    // here rather than relying on JavaScript's dollar-anchor behavior.
    if (typeof b.pin !== "string" || b.pin.length < 8 || b.pin.length > 12 || /[^0-9]/.test(b.pin)) fail();
    const command = b.command === null ? null : commandData(b.command), operationId = b.operationId === null ? null : uuid(b.operationId), selection = selected(b.selection);
    if (command && operationId !== null || !command && selection !== null) fail();
    const parsed = parsePinClockBody({ workerNo: b.workerNo, pin: b.pin, command, operationId });
    return freeze({ ...parsed, selection });
  } catch { return fail("attendance_invalid_request"); }
}
function context(input: PinScheduleParseInput): PinScheduleParseInput {
  const read = (key: string) => { const d = Object.getOwnPropertyDescriptor(input, key); if (d && (!("value" in d) || !d.enumerable)) fail(); return d?.value; };
  const siteId = site(read("siteId")), terminalId = uuid(read("terminalId")), workerNo = pinWorkerNo(read("workerNo"));
  const rawOp = read("operationId"), operationId = rawOp === null ? null : uuid(rawOp), rawCommand = read("command");
  const command = rawCommand === null ? null : commandData(rawCommand), selection = selected(read("selection")), expected = read("expectedSelection");
  if (command && operationId !== null || !command && selection !== null) fail();
  const worker = read("expectedWorkerId"), employee = read("expectedEmployeeId"), memberAuth = read("expectedEmployeeAuthUserId");
  return { siteId, terminalId, workerNo, operationId, command, selection,
    ...(expected === undefined ? {} : { expectedSelection: selected(expected) }),
    ...(worker === undefined ? {} : { expectedWorkerId: uuid(worker) }), ...(employee === undefined ? {} : { expectedEmployeeId: uuid(employee) }),
    ...(memberAuth === undefined ? {} : { expectedEmployeeAuthUserId: uuid(memberAuth) }) };
}
function clockData(raw: unknown, input: PinScheduleParseInput): PinClockResult {
  const c = exact(raw, CLOCK_KEYS), state = exact(c.state, ["sequence", "status", "lastEvent"]); integer(state.sequence);
  for (const rawEvent of [c.receipt, state.lastEvent]) if (rawEvent !== null) {
    const event = exact(rawEvent, EVENT_KEYS); stamp(event.occurredAt, 3); integer(event.sequence, 1);
  }
  const clock = parsePinClockResult(c, input);
  if (input.expectedWorkerId !== undefined && clock.workerId !== input.expectedWorkerId
    || input.expectedEmployeeId !== undefined && clock.employeeId !== input.expectedEmployeeId) return fail();
  return clock;
}
function adoptionData(raw: unknown, clock: PinClockResult, association: SelfScheduleAssociation | null, input: PinScheduleParseInput): PinScheduleAdoption | null {
  if (raw === null) { if (association || input.command) fail(); return null; }
  const a = exact(raw, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
  if (!association || !clock.receipt || clock.receipt.action !== "clock_in" || a.startEventId !== clock.receipt.id || a.operationId !== clock.receipt.operationId
    || a.channel !== "pin" || a.employeeId !== clock.employeeId || a.recordedAt !== association.recordedAt
    || a.policy !== "explicit-plan-approval-at-clock-in-v1"
    || input.expectedEmployeeAuthUserId !== undefined && a.employeeAuthUserId !== input.expectedEmployeeAuthUserId) return fail();
  // This is the PIN-authenticated member's saved binding, not a request login
  // actor. Only SQL establishes kiosk origin and verifies current membership.
  const employeeAuthUserId = uuid(a.employeeAuthUserId), recordedAt = stamp(a.recordedAt);
  let approval: PinScheduleApprovalReference | null = null;
  if (a.approval !== null) {
    const p = exact(a.approval, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]);
    if (typeof p.sourceSha256 !== "string" || p.sourceSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(p.sourceSha256)) return fail();
    approval = { operationId: uuid(p.operationId), revision: integer(p.revision, 1), sourceId: uuid(p.sourceId), sourceSha256: p.sourceSha256, recordedAt: stamp(p.recordedAt) };
  }
  if (a.status === "adopted") { if (association.status !== "linked" || a.reason !== null || !approval) fail(); }
  else if (a.status === "not_approved") { if (association.status !== "linked" || a.reason !== "approval_missing" || approval) fail(); }
  else if (a.status === "unselected") { if (association.status !== "unselected" || a.reason !== null || approval) fail(); }
  else if (a.status === "unverified") { if (association.status !== "unverified" || a.reason !== association.reason || approval) fail(); }
  else return fail();
  return { startEventId: uuid(a.startEventId), operationId: uuid(a.operationId), channel: "pin", employeeId: uuid(a.employeeId), employeeAuthUserId,
    status: a.status, reason: a.reason as PinScheduleAdoption["reason"], approval, recordedAt, policy: "explicit-plan-approval-at-clock-in-v1" };
}
function resultData(raw: unknown, expected: PinScheduleParseInput): PinScheduleResult {
  tree(raw); const v = exact(raw, RESULT_KEYS), input = context(expected);
  if (v.protocol !== "pin-schedule-v1") fail(); const clock = clockData(v.clock, input);
  const expectedSelection = input.command ? input.selection : input.expectedSelection;
  // The shared137 grammar receives only the five common fields of this genuine
  // PIN clock, not a made-up web/location/onsite login or source claim.
  const shared = parseSelfScheduleResult({ protocol: "self-schedule-v1", clock: { workerId: clock.workerId, locationId: clock.locationId,
    state: clock.state, receipt: clock.receipt, replayed: clock.replayed }, choices: v.choices, association: v.association },
  { siteId: input.siteId, operationId: input.operationId, command: input.command === null ? null : {
    expectedWorkerId: input.command.expectedWorkerId, operationId: input.command.operationId, locationId: input.command.locationId,
    action: input.command.action, expectedSequence: input.command.expectedSequence }, ...(expectedSelection === undefined ? {} : { selection: expectedSelection }) });
  if (input.command && shared.association === null) fail();
  if (shared.association) stamp(shared.association.recordedAt);
  const adoption = adoptionData(v.adoption, clock, shared.association, input);
  if (input.command && input.expectedSelection !== undefined
    && JSON.stringify(parseSelfScheduleSelection(input.expectedSelection)) !== JSON.stringify(input.selection)) fail();
  return freeze({ protocol: "pin-schedule-v1", clock, choices: shared.choices, association: shared.association, adoption });
}
export function parsePinScheduleResult(raw: unknown, input: PinScheduleParseInput): PinScheduleResult {
  try { return resultData(raw, input); } catch { return fail(); }
}
export function parsePinScheduleHttpResult(raw: unknown, input: PinScheduleParseInput): PinScheduleHttpResult {
  try { tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "selectionEnabled", ...RESULT_KEYS]);
    if (v.ok !== true) fail(); const moduleEnabled = bool(v.moduleEnabled), selectionEnabled = bool(v.selectionEnabled);
    if (selectionEnabled && !moduleEnabled) fail();
    const result = resultData(Object.fromEntries(RESULT_KEYS.map(key => [key, v[key]])), input);
    if (!selectionEnabled && result.choices.entries.length || !moduleEnabled && result.clock.canStart) fail();
    return freeze({ ok: true, moduleEnabled, selectionEnabled, ...result });
  } catch { return fail(); }
}
