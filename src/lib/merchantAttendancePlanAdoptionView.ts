// Browser-safe owner projection of immutable actual plan-approval references.
// This does not adopt today's approval, resolve rules or change old calculations.
import { captureBrowserExact as exact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseShiftCheckQuery, shiftCheckQueryString, parseShiftCheckResult, validateShiftCheckTree,
  type ShiftCheckQuery, type ShiftCheckData, type ShiftCheckResult } from "./merchantAttendanceShiftCheck";
import { PLAN_COVERAGE_ERRORS, parsePlanCoverageQuery, planCoverageQueryString, parsePlanCoverageResult,
  type PlanCoverageQuery, type PlanCoverageData, type PlanCoverageResult } from "./merchantAttendancePlanCoverage";
import type { LocationScheduleAdoption } from "./merchantAttendanceLocationSchedule";

export const PLAN_ADOPTION_VIEW_BYTE_LIMIT = 1048576;
export const SHIFT_CHECK_ADOPTION_API = "/api/merchant-enterprise/attendance/shift-check-adoption";
export const PLAN_COVERAGE_ADOPTIONS_API = "/api/merchant-enterprise/attendance/plan-coverage-adoptions";
export const PLAN_ADOPTION_VIEW_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...PLAN_COVERAGE_ERRORS,
  attendance_plan_adoption_view_invalid: 503, attendance_plan_adoption_view_too_large: 422,
  attendance_location_schedule_invalid: 503, attendance_onsite_schedule_invalid: 503, attendance_pin_schedule_invalid: 503,
  attendance_self_schedule_adoption_invalid: 503, attendance_plan_rule_invalid: 503, attendance_plan_rule_identity_changed: 409,
  attendance_schedule_invalid: 503, attendance_operation_conflict: 409,
});
export type PlanAdoption = Omit<LocationScheduleAdoption, "channel"> & { channel: "self" | "location" | "onsite" | "pin" };
export type PlanAdoptionEntry = { startEventId: string; adoption: PlanAdoption | null };
export type ShiftCheckAdoptionQuery = ShiftCheckQuery;
export type ShiftCheckAdoptionData = { protocol: "shift-check-adoption-v1"; check: ShiftCheckData; adoption: PlanAdoption | null };
export type ShiftCheckAdoptionResult = Omit<ShiftCheckAdoptionData, "check"> & { check: ShiftCheckResult };
export type ShiftCheckAdoptionResponse = ShiftCheckAdoptionResult & { moduleEnabled: boolean };
export type PlanCoverageAdoptionsQuery = PlanCoverageQuery;
export type PlanCoverageAdoptionsData = { protocol: "plan-coverage-adoptions-v1"; coverage: PlanCoverageData; adoptions: PlanAdoptionEntry[] };
export type PlanCoverageAdoptionsResult = Omit<PlanCoverageAdoptionsData, "coverage"> & { coverage: PlanCoverageResult };
export type PlanCoverageAdoptionsResponse = PlanCoverageAdoptionsResult & { moduleEnabled: boolean };
const invalid = (): never => { throw new MerchantAttendanceError("attendance_plan_adoption_view_invalid"); };
const tooLarge = (): never => { throw new MerchantAttendanceError("attendance_plan_adoption_view_too_large"); };
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : invalid();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : invalid();
function integer(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= 1 && v <= 9007199254740990 ? v : invalid();
}
function stamp(v: unknown): string {
  if (typeof v !== "string" || v.length !== 27 || v.startsWith("0000-") || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) return invalid();
  const short = v.slice(0, 23) + "Z", value = Date.parse(short);
  if (!Number.isFinite(value) || new Date(value).toISOString() !== short) return invalid(); return v;
}
function failure(error: unknown): never {
  if (error instanceof MerchantAttendanceError && ["attendance_plan_adoption_view_too_large", "attendance_plan_coverage_too_large", "attendance_shift_check_too_large"].includes(error.code)) return tooLarge();
  return invalid();
}
function tree(raw: unknown) {
  // Original safety checker validates descriptors before traversing values. The
  // new whole envelope shares its 1 MiB budget; metadata never permits overflow.
  validateShiftCheckTree(raw);
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > PLAN_ADOPTION_VIEW_BYTE_LIMIT) tooLarge();
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function parsePlanAdoptionViewJson(text: string): unknown {
  try {
    if (typeof text !== "string") invalid();
    if (new TextEncoder().encode(text).byteLength > PLAN_ADOPTION_VIEW_BYTE_LIMIT) tooLarge();
    const result = parseCaptureBrowserJson(text); tree(result); return result;
  } catch (error) { return failure(error); }
}
function queryData(raw: unknown, target: "startEventId" | "slotId") {
  const q = exact(raw, ["siteId", "workerId", target]);
  if (typeof q.siteId !== "string" || q.siteId.length !== 8 || !/^\d{8}$/.test(q.siteId)) invalid();
  return { siteId: q.siteId, workerId: uuid(q.workerId), [target]: uuid(q[target]) };
}
export function parseShiftCheckAdoptionQuery(raw: unknown): ShiftCheckAdoptionQuery {
  try { return parseShiftCheckQuery(queryData(raw, "startEventId")); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parsePlanCoverageAdoptionsQuery(raw: unknown): PlanCoverageAdoptionsQuery {
  try { return parsePlanCoverageQuery(queryData(raw, "slotId")); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
function httpQuery(url: string, target: "startEventId" | "slotId") {
  // WHATWG URL parsing removes literal TAB/CR/LF and trailing spaces before
  // exposing searchParams. Reject them first, then validate decoded values
  // directly; never let a prior parser normalize away malformed input.
  if (typeof url !== "string" || /\s|[\u0000-\u001f\u007f-\u009f]/.test(url)) invalid();
  const values = Object.create(null) as Record<string, string>, params = new URL(url).searchParams;
  for (const [key, value] of params) {
    if (!["siteId", "workerId", target].includes(key) || params.getAll(key).length !== 1) invalid();
    values[key] = value;
  }
  return values;
}
export function parseShiftCheckAdoptionHttpQuery(url: string): ShiftCheckAdoptionQuery {
  try { return parseShiftCheckAdoptionQuery(httpQuery(url, "startEventId")); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parsePlanCoverageAdoptionsHttpQuery(url: string): PlanCoverageAdoptionsQuery {
  try { return parsePlanCoverageAdoptionsQuery(httpQuery(url, "slotId")); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export const shiftCheckAdoptionQueryString = (query: ShiftCheckAdoptionQuery) => shiftCheckQueryString(parseShiftCheckAdoptionQuery(query));
export const planCoverageAdoptionsQueryString = (query: PlanCoverageAdoptionsQuery) => planCoverageQueryString(parsePlanCoverageAdoptionsQuery(query));

function adoptionData(raw: unknown, check: ShiftCheckResult): PlanAdoption | null {
  // Null means no saved adoption. It is not equivalent to a saved not_approved
  // decision, and a legacy137 relation is explicitly allowed alongside null.
  if (raw === null) return null;
  const a = exact(raw, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
  const { event, worker, binding } = check.rule, relation = check.relation;
  if (!relation || a.startEventId !== event.startEventId || a.operationId !== event.operationId
    || a.employeeId !== worker.employeeId || a.employeeAuthUserId !== worker.employeeAuthUserId
    || a.recordedAt !== relation.recordedAt || a.policy !== "explicit-plan-approval-at-clock-in-v1"
    || !["self", "location", "onsite", "pin"].includes(a.channel as string)
    || (a.channel === "pin" ? event.source !== "kiosk" : event.source !== "web")
    || binding !== null && binding.channel !== a.channel) return invalid();
  let approval: PlanAdoption["approval"] = null;
  if (a.approval !== null) {
    const p = exact(a.approval, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]);
    if (typeof p.sourceSha256 !== "string" || p.sourceSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(p.sourceSha256)) return invalid();
    approval = { operationId: uuid(p.operationId), revision: integer(p.revision), sourceId: uuid(p.sourceId), sourceSha256: p.sourceSha256, recordedAt: stamp(p.recordedAt) };
  }
  if (a.status === "adopted") { if (relation.status !== "linked" || a.reason !== null || !approval) invalid(); }
  else if (a.status === "not_approved") { if (relation.status !== "linked" || a.reason !== "approval_missing" || approval) invalid(); }
  else if (a.status === "unselected") { if (relation.status !== "unselected" || a.reason !== null || approval) invalid(); }
  else if (a.status === "unverified") { if (relation.status !== "unverified" || a.reason !== relation.reason || approval) invalid(); }
  else return invalid();
  // UUID and time metadata are checked, not browser-verified source bytes or a
  // claim that an approval author equals today's owner. No cross-entity clock
  // ordering or timezone reconstruction is introduced here.
  return { startEventId: uuid(a.startEventId), operationId: uuid(a.operationId), channel: a.channel as PlanAdoption["channel"],
    employeeId: uuid(a.employeeId), employeeAuthUserId: uuid(a.employeeAuthUserId), status: a.status,
    reason: a.reason as PlanAdoption["reason"], approval, recordedAt: stamp(a.recordedAt), policy: "explicit-plan-approval-at-clock-in-v1" };
}
function checkData(check: ShiftCheckResult): ShiftCheckData {
  return { protocol: check.protocol, algorithmVersion: check.algorithmVersion, readOnly: true, formalReady: false,
    asOf: check.asOf, rule: check.rule, events: check.events, effect: check.effect, relation: check.relation };
}
function coverageData(coverage: PlanCoverageResult): PlanCoverageData {
  return { protocol: coverage.protocol, algorithmVersion: coverage.algorithmVersion, readOnly: true, formalReady: false,
    siteId: coverage.siteId, actorId: coverage.actorId, worker: coverage.worker, slot: coverage.slot,
    readStartedAt: coverage.readStartedAt, readCompletedAt: coverage.readCompletedAt, sessions: coverage.sessions.map(checkData) };
}
export function parseShiftCheckAdoptionResult(raw: unknown, input: ShiftCheckAdoptionQuery, actorId: string): ShiftCheckAdoptionResult {
  const query = parseShiftCheckAdoptionQuery(input);
  try {
    tree(raw); const v = exact(raw, ["protocol", "check", "adoption"]);
    if (v.protocol !== "shift-check-adoption-v1") invalid();
    const check = parseShiftCheckResult(v.check, query, uuid(actorId)), adoption = adoptionData(v.adoption, check);
    return freeze({ protocol: "shift-check-adoption-v1", check, adoption });
  } catch (error) { return failure(error); }
}
export function parseShiftCheckAdoptionData(raw: unknown, query: ShiftCheckAdoptionQuery, actorId: string): ShiftCheckAdoptionData {
  const result = parseShiftCheckAdoptionResult(raw, query, actorId);
  return freeze({ protocol: result.protocol, check: checkData(result.check), adoption: result.adoption });
}
export function parseShiftCheckAdoptionResponse(raw: unknown, query: ShiftCheckAdoptionQuery, actorId: string): ShiftCheckAdoptionResponse {
  try {
    tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) invalid();
    return freeze({ ...parseShiftCheckAdoptionResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) });
  } catch (error) { return failure(error); }
}
export function parsePlanCoverageAdoptionsResult(raw: unknown, input: PlanCoverageAdoptionsQuery, actorId: string): PlanCoverageAdoptionsResult {
  const query = parsePlanCoverageAdoptionsQuery(input);
  try {
    tree(raw); const v = exact(raw, ["protocol", "coverage", "adoptions"]);
    if (v.protocol !== "plan-coverage-adoptions-v1") invalid();
    const coverage = parsePlanCoverageResult(v.coverage, query, uuid(actorId));
    if (!Array.isArray(v.adoptions) || v.adoptions.length !== coverage.sessions.length || v.adoptions.length > 10) invalid();
    const entries = v.adoptions as unknown[];
    const adoptions = entries.map((entry, index) => {
      const a = exact(entry, ["startEventId", "adoption"]), check = coverage.sessions[index];
      if (a.startEventId !== check.rule.event.startEventId) invalid();
      return { startEventId: uuid(a.startEventId), adoption: adoptionData(a.adoption, check) };
    });
    return freeze({ protocol: "plan-coverage-adoptions-v1", coverage, adoptions });
  } catch (error) { return failure(error); }
}
export function parsePlanCoverageAdoptionsData(raw: unknown, query: PlanCoverageAdoptionsQuery, actorId: string): PlanCoverageAdoptionsData {
  const result = parsePlanCoverageAdoptionsResult(raw, query, actorId);
  return freeze({ protocol: result.protocol, coverage: coverageData(result.coverage), adoptions: result.adoptions });
}
export function parsePlanCoverageAdoptionsResponse(raw: unknown, query: PlanCoverageAdoptionsQuery, actorId: string): PlanCoverageAdoptionsResponse {
  try {
    tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) invalid();
    return freeze({ ...parsePlanCoverageAdoptionsResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) });
  } catch (error) { return failure(error); }
}
