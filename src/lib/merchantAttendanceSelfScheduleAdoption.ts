// Browser-safe extension for ordinary self clock-in. Old137 wire remains exact
// and unchanged; a legacy association can exist without any adoption evidence.
import { parseAttendanceSelfCommand, type AttendanceSelfCommand } from "./merchantAttendanceSelf";
import { SELF_SCHEDULE_ERRORS, parseSelfScheduleResult, parseSelfScheduleSelection,
  type SelfScheduleParseInput, type SelfScheduleResult, type SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import type { LocationScheduleAdoption, LocationScheduleApprovalReference } from "./merchantAttendanceLocationSchedule";
import { captureBrowserExact as exact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const SELF_SCHEDULE_ADOPTION_API = "/api/merchant-enterprise/attendance/self-schedule-adoption";
export const SELF_SCHEDULE_ADOPTION_BYTE_LIMIT = 65536;
export const SELF_SCHEDULE_ADOPTION_BODY_BYTE_LIMIT = 8192;
export type SelfScheduleAdoptionQuery = { siteId: string; operationId: string | null };
export type SelfScheduleAdoptionSelection = SelfScheduleSelection;
export type SelfScheduleAdoptionApprovalReference = LocationScheduleApprovalReference;
export type SelfScheduleAdoption = Omit<LocationScheduleAdoption, "channel"> & { channel: "self" };
export type SelfScheduleAdoptionResult = { protocol: "self-schedule-adoption-v1"; clock: SelfScheduleResult["clock"];
  choices: SelfScheduleResult["choices"]; association: SelfScheduleResult["association"]; adoption: SelfScheduleAdoption | null };
export type SelfScheduleAdoptionHttpResult = SelfScheduleAdoptionResult & { ok: true; moduleEnabled: boolean; selectionEnabled: boolean };
export type SelfScheduleAdoptionParseInput = SelfScheduleParseInput & { authUserId?: string; expectedEmployeeId?: string };
export const SELF_SCHEDULE_ADOPTION_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...SELF_SCHEDULE_ERRORS,
  attendance_self_schedule_adoption_disabled: 403, attendance_self_schedule_adoption_invalid: 503, attendance_plan_rule_invalid: 503, attendance_plan_rule_identity_changed: 409,
  attendance_schedule_invalid: 503, attendance_shift_rule_binding_invalid: 503, attendance_worker_not_found: 404,
  authentication_required: 401, enterprise_auth_unavailable: 503, enterprise_entitlement_unavailable: 503,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, rate_limited: 429,
});
const fail = (code = "attendance_self_schedule_adoption_invalid"): never => { throw new MerchantAttendanceError(code); };
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0)
  && v >= min && v <= 9007199254740990 ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const COMMAND_KEYS = ["expectedWorkerId", "operationId", "locationId", "action", "expectedSequence"];
const CLOCK_KEYS = ["workerId", "locationId", "state", "receipt", "replayed"];
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
function tree(raw: unknown, limit = SELF_SCHEDULE_ADOPTION_BYTE_LIMIT) {
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
/** Transport performs fatal UTF-8 decoding first. Duplicate names are rejected
 * before JSON construction; this parser never stores credentials or source text. */
export function parseSelfScheduleAdoptionJson(text: string, kind: "request" | "response" = "response"): unknown {
  try { if (kind !== "request" && kind !== "response") fail();
    const limit = kind === "request" ? SELF_SCHEDULE_ADOPTION_BODY_BYTE_LIMIT : SELF_SCHEDULE_ADOPTION_BYTE_LIMIT;
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limit) fail();
    const value = parseCaptureBrowserJson(text); tree(value, limit); return value;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : "attendance_self_schedule_adoption_invalid"); }
}
function commandData(raw: unknown, siteId: string): AttendanceSelfCommand {
  tree(raw, SELF_SCHEDULE_ADOPTION_BODY_BYTE_LIMIT); const c = exact(raw, COMMAND_KEYS);
  const command = parseAttendanceSelfCommand({ siteId, expectedWorkerId: uuid(c.expectedWorkerId), operationId: uuid(c.operationId),
    locationId: uuid(c.locationId), action: c.action, expectedSequence: integer(c.expectedSequence) }).command;
  if (command.action !== "clock_in") return fail(); return command;
}
export function parseSelfScheduleAdoptionBody(raw: unknown): { siteId: string; command: AttendanceSelfCommand; selection: SelfScheduleSelection | null } {
  try { tree(raw, SELF_SCHEDULE_ADOPTION_BODY_BYTE_LIMIT); const b = exact(raw, ["siteId", "command", "selection"]), siteId = site(b.siteId);
    return freeze({ siteId, command: commandData(b.command, siteId), selection: parseSelfScheduleSelection(b.selection) });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseSelfScheduleAdoptionQuery(url: string): SelfScheduleAdoptionQuery {
  try { const p = new URL(url).searchParams;
    for (const key of p.keys()) if (!["siteId", "operationId"].includes(key) || p.getAll(key).length !== 1) fail();
    return { siteId: site(p.get("siteId")), operationId: p.has("operationId") ? uuid(p.get("operationId")) : null };
  } catch { return fail("attendance_invalid_request"); }
}
export function selfScheduleAdoptionQueryString(input: SelfScheduleAdoptionQuery): string {
  const p = new URLSearchParams({ siteId: site(input.siteId) }); if (input.operationId !== null) p.set("operationId", uuid(input.operationId)); return p.toString();
}
function context(input: SelfScheduleAdoptionParseInput): SelfScheduleAdoptionParseInput {
  const read = (key: string) => { const d = Object.getOwnPropertyDescriptor(input, key); if (d && (!("value" in d) || !d.enumerable)) fail(); return d?.value; };
  const siteId = site(read("siteId")), rawOp = read("operationId"), operationId = rawOp === null ? null : uuid(rawOp);
  const rawCommand = read("command"), command = rawCommand === null ? null : commandData(rawCommand, siteId), rawSelection = read("selection");
  const selection = rawSelection === undefined ? undefined : parseSelfScheduleSelection(rawSelection);
  if (command && (operationId !== null || selection === undefined)) fail();
  const auth = read("authUserId"), employee = read("expectedEmployeeId");
  return { siteId, operationId, command, ...(selection === undefined ? {} : { selection }),
    ...(auth === undefined ? {} : { authUserId: uuid(auth) }), ...(employee === undefined ? {} : { expectedEmployeeId: uuid(employee) }) };
}
function adoptionData(raw: unknown, shared: SelfScheduleResult, input: SelfScheduleAdoptionParseInput): SelfScheduleAdoption | null {
  // Old ordinary137 relations have no adoption ledger entry. GET preserves that
  // lack of proof; POST, including replay, may never backfill or accept it.
  if (raw === null) { if (input.command) fail(); return null; }
  const a = exact(raw, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
  const { clock, association } = shared;
  if (!association || !clock.receipt || clock.receipt.action !== "clock_in" || a.startEventId !== clock.receipt.id || a.operationId !== clock.receipt.operationId
    || a.channel !== "self" || a.recordedAt !== association.recordedAt || a.policy !== "explicit-plan-approval-at-clock-in-v1"
    || input.authUserId !== undefined && a.employeeAuthUserId !== input.authUserId
    || input.expectedEmployeeId !== undefined && a.employeeId !== input.expectedEmployeeId) return fail();
  const employeeId = uuid(a.employeeId), employeeAuthUserId = uuid(a.employeeAuthUserId), recordedAt = stamp(a.recordedAt);
  let approval: SelfScheduleAdoptionApprovalReference | null = null;
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
  return { startEventId: uuid(a.startEventId), operationId: uuid(a.operationId), channel: "self", employeeId, employeeAuthUserId,
    status: a.status, reason: a.reason as SelfScheduleAdoption["reason"], approval, recordedAt, policy: "explicit-plan-approval-at-clock-in-v1" };
}
function resultData(raw: unknown, expected: SelfScheduleAdoptionParseInput): SelfScheduleAdoptionResult {
  tree(raw); const v = exact(raw, RESULT_KEYS), input = context(expected);
  if (v.protocol !== "self-schedule-adoption-v1") fail();
  const clock = exact(v.clock, CLOCK_KEYS), state = exact(clock.state, ["sequence", "status", "lastEvent"]); integer(state.sequence);
  for (const rawEvent of [clock.receipt, state.lastEvent]) if (rawEvent !== null) {
    const event = exact(rawEvent, EVENT_KEYS); stamp(event.occurredAt, 3); integer(event.sequence, 1);
  }
  // These are the actual original five self-clock fields. Do not invent an
  // employee field or infer an authenticated identity from an operation UUID.
  const shared = parseSelfScheduleResult({ protocol: "self-schedule-v1", clock, choices: v.choices, association: v.association }, input);
  if (input.command && (!shared.association || shared.clock.receipt?.sequence !== input.command.expectedSequence + 1)) fail();
  if (shared.association) stamp(shared.association.recordedAt);
  const adoption = adoptionData(v.adoption, shared, input);
  return freeze({ protocol: "self-schedule-adoption-v1", clock: shared.clock, choices: shared.choices, association: shared.association, adoption });
}
export function parseSelfScheduleAdoptionResult(raw: unknown, input: SelfScheduleAdoptionParseInput): SelfScheduleAdoptionResult {
  try { return resultData(raw, input); } catch { return fail(); }
}
export function parseSelfScheduleAdoptionHttpResult(raw: unknown, input: SelfScheduleAdoptionParseInput): SelfScheduleAdoptionHttpResult {
  try { tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "selectionEnabled", ...RESULT_KEYS]);
    if (v.ok !== true) fail(); const moduleEnabled = bool(v.moduleEnabled), selectionEnabled = bool(v.selectionEnabled);
    if (selectionEnabled && !moduleEnabled) fail();
    const result = resultData(Object.fromEntries(RESULT_KEYS.map(key => [key, v[key]])), input);
    if (!selectionEnabled && result.choices.entries.length) fail();
    return freeze({ ok: true, moduleEnabled, selectionEnabled, ...result });
  } catch { return fail(); }
}
