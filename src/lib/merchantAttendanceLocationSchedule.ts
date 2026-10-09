// Explicit location-clock selection. Public parsing never exposes the private
// fence or assertion fingerprint, nor treats an adopted policy as attendance.
import { ATTENDANCE_LOCATION_CLOCK_ERRORS, parseAttendanceLocationClockCommand, parseAttendanceLocationClockResult,
  type AttendanceLocationClockCommand, type AttendanceLocationClockQuery, type AttendanceLocationClockResult } from "./merchantAttendanceLocationClock";
import { parseSelfScheduleResult, parseSelfScheduleSelection, type SelfScheduleAssociation, type SelfScheduleResult,
  type SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import { captureBrowserExact as exact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const LOCATION_SCHEDULE_BYTE_LIMIT = 65536;
export const LOCATION_SCHEDULE_BODY_BYTE_LIMIT = 8192;
export type LocationScheduleQuery = AttendanceLocationClockQuery;
export type LocationScheduleApprovalReference = { operationId: string; revision: number; sourceId: string; sourceSha256: string; recordedAt: string };
export type LocationScheduleAdoption = { startEventId: string; operationId: string; channel: "location"; employeeId: string; employeeAuthUserId: string;
  status: "adopted" | "not_approved" | "unselected" | "unverified"; reason: "approval_missing" | SelfScheduleAssociation["reason"];
  approval: LocationScheduleApprovalReference | null; recordedAt: string; policy: "explicit-plan-approval-at-clock-in-v1" };
export type LocationScheduleResult = { protocol: "location-schedule-v1"; clock: AttendanceLocationClockResult;
  choices: SelfScheduleResult["choices"]; association: SelfScheduleAssociation | null; adoption: LocationScheduleAdoption | null };
export type LocationScheduleHttpResult = LocationScheduleResult & { ok: true; moduleEnabled: boolean; selectionEnabled: boolean };
export type LocationScheduleParseInput = LocationScheduleQuery & { command: AttendanceLocationClockCommand | null;
  selection?: SelfScheduleSelection | null; authUserId?: string; employeeId?: string };
export const LOCATION_SCHEDULE_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...ATTENDANCE_LOCATION_CLOCK_ERRORS,
  attendance_location_schedule_disabled: 403, attendance_location_schedule_invalid: 503, attendance_self_schedule_invalid: 503,
  attendance_plan_rule_invalid: 503, attendance_plan_rule_identity_changed: 409, attendance_schedule_invalid: 503,
  attendance_worker_not_found: 404, attendance_settings_required: 409, attendance_not_available: 404,
  unauthorized: 401, employee_password_authentication_required: 403, enterprise_management_disabled: 403,
  forbidden_origin: 403, attendance_unavailable: 503,
});
const fail = (code = "attendance_location_schedule_invalid"): never => { throw new MerchantAttendanceError(code); };
const uuid = (v: unknown) => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const site = (v: unknown) => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0) => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0)
  && v >= min && v <= 9007199254740990 ? v : fail();
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
const CLOCK_KEYS = ["workerId", "locationId", "state", "receipt", "replayed", "siteId", "employeeId", "channelEnabled", "policy", "locationResult", "noticeGate", "finish", "receiptGate"];
const RESULT_KEYS = ["protocol", "clock", "choices", "association", "adoption"];
const EVENT_KEYS = ["id", "siteId", "workerId", "locationId", "operationId", "action", "breakPaid", "sequence", "occurredAt", "timeZone"];
const INTENT_KEYS = ["expectedWorkerId", "operationId", "locationId", "action", "expectedSequence", "settingsVersion", "workerVersion", "locationVersion", "noticeRevision", "safeFinish"];
const VERSIONS = ["settingsVersion", "workerVersion", "locationVersion"];
function stamp(v: unknown, digits: 3 | 6 = 6): string {
  if (typeof v !== "string" || v.length !== (digits === 3 ? 24 : 27)
    || !(digits === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v)
    || v.startsWith("0000-")) return fail();
  const short = v.slice(0, 23) + "Z", ms = Date.parse(short);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== short) fail(); return v;
}
function wellFormed(v: string) {
  for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
    else if (n >= 0xdc00 && n <= 0xdfff) fail(); }
}
function tree(raw: unknown, limit = LOCATION_SCHEDULE_BYTE_LIMIT) {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 6000 || depth > 18) fail();
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
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function parseLocationScheduleJson(text: string): unknown {
  try { if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > LOCATION_SCHEDULE_BYTE_LIMIT) fail();
    const raw = parseCaptureBrowserJson(text); tree(raw); return raw;
  } catch { return fail(); }
}
export function parseLocationScheduleBody(raw: unknown): { siteId: string; command: AttendanceLocationClockCommand; selection: SelfScheduleSelection | null } {
  try { tree(raw, LOCATION_SCHEDULE_BODY_BYTE_LIMIT); const b = exact(raw, ["siteId", "command", "selection"]);
    const command = exact(b.command, [...INTENT_KEYS, "position", "positionFailure"]);
    const parsed = parseAttendanceLocationClockCommand({ siteId: site(b.siteId), ...command });
    if (parsed.command.action !== "clock_in" || parsed.command.safeFinish) fail();
    return freeze({ ...parsed, selection: parseSelfScheduleSelection(b.selection) });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseLocationScheduleQuery(url: string): LocationScheduleQuery {
  try { const p = new URL(url).searchParams;
    for (const key of p.keys()) if (!["siteId", "expectedWorkerId", "operationId"].includes(key) || p.getAll(key).length !== 1) fail();
    return { siteId: site(p.get("siteId")), expectedWorkerId: uuid(p.get("expectedWorkerId")), operationId: p.has("operationId") ? uuid(p.get("operationId")) : null };
  } catch { return fail("attendance_invalid_request"); }
}
export const locationScheduleQueryString = (q: LocationScheduleQuery) => {
  const query = new URLSearchParams({ siteId: site(q.siteId), expectedWorkerId: uuid(q.expectedWorkerId) });
  if (q.operationId !== null) query.set("operationId", uuid(q.operationId)); return query.toString();
};
function expected(input: LocationScheduleParseInput): LocationScheduleParseInput {
  // Callers may carry transport options beside these fields; never invoke an
  // accessor to obtain a trusted scope or pending selection.
  const read = (key: string) => { const d = Object.getOwnPropertyDescriptor(input, key); if (d && (!("value" in d) || !d.enumerable)) fail(); return d?.value; };
  const siteId = site(read("siteId")), expectedWorkerId = uuid(read("expectedWorkerId")), rawOperation = read("operationId");
  const operationId = rawOperation === null ? null : uuid(rawOperation), rawCommand = read("command"), rawSelection = read("selection");
  const selection = rawSelection === undefined ? undefined : parseSelfScheduleSelection(rawSelection);
  const command = rawCommand === null ? null : parseLocationScheduleBody({ siteId, command: rawCommand, selection: selection ?? null }).command;
  if (command && (operationId !== null || command.expectedWorkerId !== expectedWorkerId || selection === undefined)) fail();
  const actor = read("authUserId"), employee = read("employeeId");
  return { siteId, expectedWorkerId, operationId, command, ...(selection === undefined ? {} : { selection }),
    ...(actor === undefined ? {} : { authUserId: uuid(actor) }), ...(employee === undefined ? {} : { employeeId: uuid(employee) }) };
}
function strictClock(raw: unknown, input: LocationScheduleParseInput, serverRaw: boolean): AttendanceLocationClockResult {
  const hasPrivate = serverRaw && !!raw && typeof raw === "object" && (Object.hasOwn(raw, "internalFence") || Object.hasOwn(raw, "internalPolicyFingerprint"));
  const c = exact(raw, hasPrivate ? [...CLOCK_KEYS, "internalFence", "internalPolicyFingerprint"] : CLOCK_KEYS);
  const state = exact(c.state, ["sequence", "status", "lastEvent", ...(c.state && typeof c.state === "object" && Object.hasOwn(c.state, "administrativeBoundary") ? ["administrativeBoundary"] : [])]); integer(state.sequence);
  for (const rawEvent of [state.lastEvent, c.receipt]) if (rawEvent !== null) { const event = exact(rawEvent, EVENT_KEYS); stamp(event.occurredAt, 3); integer(event.sequence, 1); }
  if (c.policy !== null) { const p = exact(c.policy, [...VERSIONS, "mode", "maxAgeMs", "algorithmVersion"]); VERSIONS.forEach(k => integer(p[k], 1)); }
  if (c.locationResult !== null) { const r = exact(c.locationResult, ["eventId", ...VERSIONS, "algorithmVersion", "reason", "needsReview", "capturedAt", "accuracyMeters", "distanceMeters",
    ...(Object.hasOwn(c.locationResult as object, "disposal") ? ["disposal"] : [])]);
    VERSIONS.forEach(k => integer(r[k], 1)); if (r.capturedAt !== null) stamp(r.capturedAt, 3); }
  exact(c.noticeGate, ["ready", "reason", "revision"]);
  if (c.finish !== null) { const f = exact(c.finish, ["locationId", ...VERSIONS]); VERSIONS.forEach(k => integer(f[k], 1)); }
  if (c.receiptGate !== null) { const g = exact(c.receiptGate, ["noticeRevision", "safeFinish", "command"]); exact(g.command, INTENT_KEYS.filter(k => k !== "expectedWorkerId")); }
  if (hasPrivate) {
    if (c.internalPolicyFingerprint !== null && (typeof c.internalPolicyFingerprint !== "string" || c.internalPolicyFingerprint.length !== 32 || !/^[a-f0-9]{32}$/.test(c.internalPolicyFingerprint))) fail();
    if (c.internalFence !== null) {
      const f = exact(c.internalFence, ["latitude", "longitude", "radiusMeters", "maxAgeMs"]);
      if (typeof f.latitude !== "number" || Math.abs(f.latitude) > 90 || typeof f.longitude !== "number" || Math.abs(f.longitude) > 180
        || typeof f.radiusMeters !== "number" || f.radiusMeters < 1 || f.radiusMeters > 100000 || f.maxAgeMs !== 60000) fail();
    }
  }
  const clock = parseAttendanceLocationClockResult(Object.fromEntries(CLOCK_KEYS.map(k => [k, c[k]])), input);
  if (input.employeeId !== undefined && clock.employeeId !== input.employeeId) fail();
  return clock;
}
function adoptionData(raw: unknown, clock: AttendanceLocationClockResult, association: SelfScheduleAssociation | null, input: LocationScheduleParseInput): LocationScheduleAdoption | null {
  if (raw === null) { if (input.command) fail(); return null; }
  const a = exact(raw, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
  // The ten saved fields bind this sidecar to the same actual clock receipt.
  if (!association || !clock.receipt || clock.receipt.action !== "clock_in" || a.startEventId !== clock.receipt.id
    || a.operationId !== clock.receipt.operationId || a.channel !== "location" || a.employeeId !== clock.employeeId
    || a.recordedAt !== association.recordedAt || a.policy !== "explicit-plan-approval-at-clock-in-v1"
    || input.authUserId !== undefined && a.employeeAuthUserId !== input.authUserId) return fail();
  const employeeAuthUserId = uuid(a.employeeAuthUserId), recordedAt = stamp(a.recordedAt);
  let approval: LocationScheduleApprovalReference | null = null;
  if (a.approval !== null) { const p = exact(a.approval, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]);
    if (typeof p.sourceSha256 !== "string" || p.sourceSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(p.sourceSha256)) return fail();
    approval = { operationId: uuid(p.operationId), revision: integer(p.revision, 1), sourceId: uuid(p.sourceId), sourceSha256: p.sourceSha256, recordedAt: stamp(p.recordedAt) }; }
  if (a.status === "adopted") { if (association.status !== "linked" || a.reason !== null || !approval) fail(); }
  else if (a.status === "not_approved") { if (association.status !== "linked" || a.reason !== "approval_missing" || approval) fail(); }
  else if (a.status === "unselected") { if (association.status !== "unselected" || a.reason !== null || approval) fail(); }
  else if (a.status === "unverified") { if (association.status !== "unverified" || a.reason !== association.reason || approval) fail(); }
  else fail();
  // Locks, not cross-entity wall-clock inequalities, establish which immutable
  // approval was adopted. Do not compare approval revisions to schedule heads.
  return { startEventId: uuid(a.startEventId), operationId: uuid(a.operationId), channel: "location", employeeId: uuid(a.employeeId), employeeAuthUserId,
    status: a.status as LocationScheduleAdoption["status"], reason: a.reason as LocationScheduleAdoption["reason"], approval, recordedAt, policy: "explicit-plan-approval-at-clock-in-v1" };
}
function resultData(raw: unknown, input: LocationScheduleParseInput, serverRaw: boolean): LocationScheduleResult {
  tree(raw); const v = exact(raw, RESULT_KEYS), context = expected(input);
  if (v.protocol !== "location-schedule-v1") fail();
  const clock = strictClock(v.clock, context, serverRaw);
  // 137's shared selection grammar only needs the *actual same* five clock
  // fields. No synthetic actor, worker, receipt or source ownership is invented.
  const common = parseSelfScheduleResult({ protocol: "self-schedule-v1", clock: { workerId: clock.workerId, locationId: clock.locationId,
    state: clock.state, receipt: clock.receipt, replayed: clock.replayed }, choices: v.choices, association: v.association },
  { siteId: context.siteId, operationId: context.operationId, command: context.command === null ? null : {
    expectedWorkerId: context.command.expectedWorkerId, operationId: context.command.operationId, locationId: context.command.locationId,
    action: context.command.action, expectedSequence: context.command.expectedSequence }, ...(context.selection === undefined ? {} : { selection: context.selection }) });
  if (context.command && common.association === null) fail();
  if (common.association) stamp(common.association.recordedAt);
  const adoption = adoptionData(v.adoption, clock, common.association, context);
  return freeze({ protocol: "location-schedule-v1", clock, choices: common.choices, association: common.association, adoption });
}
export function parseLocationScheduleResult(raw: unknown, input: LocationScheduleParseInput): LocationScheduleResult {
  try { return resultData(raw, input, false); } catch { return fail(); }
}
export function parseLocationScheduleServerResult(raw: unknown, input: LocationScheduleParseInput): LocationScheduleResult {
  try { return resultData(raw, input, true); } catch { return fail(); }
}
export function parseLocationScheduleHttpResult(raw: unknown, input: LocationScheduleParseInput): LocationScheduleHttpResult {
  try { tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "selectionEnabled", ...RESULT_KEYS]);
    if (v.ok !== true) fail(); const moduleEnabled = bool(v.moduleEnabled), selectionEnabled = bool(v.selectionEnabled);
    if (selectionEnabled && !moduleEnabled) fail();
    const result = resultData(Object.fromEntries(RESULT_KEYS.map(k => [k, v[k]])), input, false);
    if (!selectionEnabled && result.choices.entries.length) fail();
    return freeze({ ok: true, moduleEnabled, selectionEnabled, ...result });
  } catch { return fail(); }
}
