// Browser-safe onsite selection protocol. GET choices describe the current
// default location, NOT a verified QR terminal or proof of physical presence.
import { ONSITE_QR_ERRORS, parseOnsiteClockBody, parseOnsiteClockResult, type OnsiteClockQuery, type OnsiteClockResult,
  type OnsiteCommand } from "./merchantAttendanceOnsiteQr";
import { parseAttendanceSelfCommand } from "./merchantAttendanceSelf";
import { parseSelfScheduleResult, parseSelfScheduleSelection, type SelfScheduleAssociation, type SelfScheduleResult,
  type SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import type { LocationScheduleAdoption, LocationScheduleApprovalReference } from "./merchantAttendanceLocationSchedule";
import { captureBrowserExact as exact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const ONSITE_SCHEDULE_BYTE_LIMIT = 65536;
export const ONSITE_SCHEDULE_BODY_BYTE_LIMIT = 8192;
export type OnsiteScheduleQuery = OnsiteClockQuery;
export type OnsiteScheduleApprovalReference = LocationScheduleApprovalReference;
export type OnsiteScheduleAdoption = Omit<LocationScheduleAdoption, "channel"> & { channel: "onsite" };
export type OnsiteScheduleResult = { protocol: "onsite-schedule-v1"; clock: OnsiteClockResult;
  choices: SelfScheduleResult["choices"]; association: SelfScheduleAssociation | null; adoption: OnsiteScheduleAdoption | null };
export type OnsiteScheduleHttpResult = OnsiteScheduleResult & { ok: true; moduleEnabled: boolean; selectionEnabled: boolean };
export type OnsiteScheduleParseInput = OnsiteScheduleQuery & { command: OnsiteCommand | null; selection?: SelfScheduleSelection | null;
  authUserId?: string; employeeId?: string; expectedWorkerId?: string };
export const ONSITE_SCHEDULE_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...ONSITE_QR_ERRORS,
  attendance_onsite_schedule_disabled: 403, attendance_onsite_schedule_invalid: 503, attendance_self_schedule_invalid: 503,
  attendance_plan_rule_invalid: 503, attendance_plan_rule_identity_changed: 409, attendance_schedule_invalid: 503,
  attendance_worker_not_found: 404, attendance_not_available: 404, attendance_unavailable: 503,
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503, enterprise_entitlement_unavailable: 503,
  employee_password_authentication_required: 403, enterprise_management_disabled: 403, forbidden_origin: 403,
});
const fail = (code = "attendance_onsite_schedule_invalid"): never => { throw new MerchantAttendanceError(code); };
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0)
  && v >= min && v <= 9007199254740990 ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const COMMAND_KEYS = ["expectedWorkerId", "expectedEmployeeId", "operationId", "locationId", "action", "expectedSequence"];
const CLOCK_KEYS = ["workerId", "employeeId", "locationId", "state", "receipt", "replayed"];
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
function tree(raw: unknown, limit = ONSITE_SCHEDULE_BYTE_LIMIT) {
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
/** HTTP readers use fatal UTF-8 first. Request syntax failures are 400; a bad
 * success response is 503. Neither path silently accepts duplicate JSON names. */
export function parseOnsiteScheduleJson(text: string, kind: "request" | "response" = "response"): unknown {
  try { if (kind !== "request" && kind !== "response") fail();
    const limit = kind === "request" ? ONSITE_SCHEDULE_BODY_BYTE_LIMIT : ONSITE_SCHEDULE_BYTE_LIMIT;
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limit) fail();
    const value = parseCaptureBrowserJson(text); tree(value, limit); return value;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : "attendance_onsite_schedule_invalid"); }
}
function commandData(raw: unknown, siteId: string): OnsiteCommand {
  tree(raw, ONSITE_SCHEDULE_BODY_BYTE_LIMIT); const c = exact(raw, COMMAND_KEYS);
  const base = parseAttendanceSelfCommand({ siteId, expectedWorkerId: uuid(c.expectedWorkerId), operationId: uuid(c.operationId),
    locationId: uuid(c.locationId), action: c.action, expectedSequence: integer(c.expectedSequence) }).command;
  if (base.action !== "clock_in") return fail(); return { ...base, expectedEmployeeId: uuid(c.expectedEmployeeId) };
}
export function parseOnsiteScheduleBody(raw: unknown): { siteId: string; token: string; command: OnsiteCommand; selection: SelfScheduleSelection | null } {
  try { tree(raw, ONSITE_SCHEDULE_BODY_BYTE_LIMIT); const b = exact(raw, ["siteId", "token", "command", "selection"]), siteId = site(b.siteId);
    const command = commandData(b.command, siteId);
    const parsed = parseOnsiteClockBody({ siteId, token: b.token, command });
    if (/\s/.test(parsed.token)) return fail("attendance_qr_invalid");
    return freeze({ ...parsed, selection: parseSelfScheduleSelection(b.selection) });
  } catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_qr_invalid") throw error;
    return fail("attendance_invalid_request");
  }
}
export function parseOnsiteScheduleQuery(url: string): OnsiteScheduleQuery {
  try { const p = new URL(url).searchParams;
    for (const key of p.keys()) if (!["siteId", "operationId"].includes(key) || p.getAll(key).length !== 1) fail();
    return { siteId: site(p.get("siteId")), operationId: p.has("operationId") ? uuid(p.get("operationId")) : null };
  } catch { return fail("attendance_invalid_request"); }
}
export function onsiteScheduleQueryString(input: OnsiteScheduleQuery): string {
  const p = new URLSearchParams({ siteId: site(input.siteId) }); if (input.operationId !== null) p.set("operationId", uuid(input.operationId)); return p.toString();
}
function context(input: OnsiteScheduleParseInput): OnsiteScheduleParseInput {
  const read = (key: string) => { const d = Object.getOwnPropertyDescriptor(input, key); if (d && (!("value" in d) || !d.enumerable)) fail(); return d?.value; };
  const siteId = site(read("siteId")), rawOp = read("operationId"), operationId = rawOp === null ? null : uuid(rawOp);
  const rawCommand = read("command"), command = rawCommand === null ? null : commandData(rawCommand, siteId), rawSelection = read("selection");
  const selection = rawSelection === undefined ? undefined : parseSelfScheduleSelection(rawSelection);
  if (command && (operationId !== null || selection === undefined)) fail();
  const auth = read("authUserId"), employee = read("employeeId"), worker = read("expectedWorkerId");
  return { siteId, operationId, command, ...(selection === undefined ? {} : { selection }),
    ...(auth === undefined ? {} : { authUserId: uuid(auth) }), ...(employee === undefined ? {} : { employeeId: uuid(employee) }),
    ...(worker === undefined ? {} : { expectedWorkerId: uuid(worker) }) };
}
function clockData(raw: unknown, input: OnsiteScheduleParseInput): OnsiteClockResult {
  const c = exact(raw, CLOCK_KEYS), state = exact(c.state, ["sequence", "status", "lastEvent"]); integer(state.sequence);
  for (const rawEvent of [c.receipt, state.lastEvent]) if (rawEvent !== null) {
    const event = exact(rawEvent, EVENT_KEYS); stamp(event.occurredAt, 3); integer(event.sequence, 1);
  }
  const clock = parseOnsiteClockResult(c, input);
  if (input.expectedWorkerId !== undefined && clock.workerId !== input.expectedWorkerId
    || input.employeeId !== undefined && clock.employeeId !== input.employeeId
    || input.command && clock.receipt?.sequence !== input.command.expectedSequence + 1) return fail();
  return clock;
}
function adoptionData(raw: unknown, clock: OnsiteClockResult, association: SelfScheduleAssociation | null, input: OnsiteScheduleParseInput): OnsiteScheduleAdoption | null {
  if (raw === null) { if (input.command) fail(); return null; }
  const a = exact(raw, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
  if (!association || !clock.receipt || clock.receipt.action !== "clock_in" || a.startEventId !== clock.receipt.id || a.operationId !== clock.receipt.operationId
    || a.channel !== "onsite" || a.employeeId !== clock.employeeId || a.recordedAt !== association.recordedAt
    || a.policy !== "explicit-plan-approval-at-clock-in-v1" || input.authUserId !== undefined && a.employeeAuthUserId !== input.authUserId) return fail();
  const employeeAuthUserId = uuid(a.employeeAuthUserId), recordedAt = stamp(a.recordedAt);
  let approval: OnsiteScheduleApprovalReference | null = null;
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
  return { startEventId: uuid(a.startEventId), operationId: uuid(a.operationId), channel: "onsite", employeeId: uuid(a.employeeId), employeeAuthUserId,
    status: a.status, reason: a.reason as OnsiteScheduleAdoption["reason"], approval, recordedAt, policy: "explicit-plan-approval-at-clock-in-v1" };
}
function resultData(raw: unknown, expected: OnsiteScheduleParseInput): OnsiteScheduleResult {
  tree(raw); const v = exact(raw, RESULT_KEYS), input = context(expected);
  if (v.protocol !== "onsite-schedule-v1") fail(); const clock = clockData(v.clock, input);
  // Shared137 grammar receives this actual onsite receipt's five common fields,
  // not a made-up location-clock policy, fence, terminal or authorization claim.
  const shared = parseSelfScheduleResult({ protocol: "self-schedule-v1", clock: { workerId: clock.workerId, locationId: clock.locationId,
    state: clock.state, receipt: clock.receipt, replayed: clock.replayed }, choices: v.choices, association: v.association },
  { siteId: input.siteId, operationId: input.operationId, command: input.command === null ? null : {
    expectedWorkerId: input.command.expectedWorkerId, operationId: input.command.operationId, locationId: input.command.locationId,
    action: input.command.action, expectedSequence: input.command.expectedSequence }, ...(input.selection === undefined ? {} : { selection: input.selection }) });
  if (input.command && shared.association === null) fail();
  if (shared.association) stamp(shared.association.recordedAt);
  const adoption = adoptionData(v.adoption, clock, shared.association, input);
  return freeze({ protocol: "onsite-schedule-v1", clock, choices: shared.choices, association: shared.association, adoption });
}
export function parseOnsiteScheduleResult(raw: unknown, input: OnsiteScheduleParseInput): OnsiteScheduleResult {
  try { return resultData(raw, input); } catch { return fail(); }
}
export function parseOnsiteScheduleHttpResult(raw: unknown, input: OnsiteScheduleParseInput): OnsiteScheduleHttpResult {
  try { tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "selectionEnabled", ...RESULT_KEYS]);
    if (v.ok !== true) fail(); const moduleEnabled = bool(v.moduleEnabled), selectionEnabled = bool(v.selectionEnabled);
    if (selectionEnabled && !moduleEnabled) fail();
    const result = resultData(Object.fromEntries(RESULT_KEYS.map(key => [key, v[key]])), input);
    if (!selectionEnabled && result.choices.entries.length) fail();
    return freeze({ ok: true, moduleEnabled, selectionEnabled, ...result });
  } catch { return fail(); }
}
