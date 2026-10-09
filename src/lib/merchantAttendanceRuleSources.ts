// Independent current rule-source evidence. No attendance facts, applications,
// calculation or historical policy pinning are implied by this protocol.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceInstant, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { groupDate, parseGroupAssignmentDetail, parseGroupItem, type GroupItem } from "./merchantAttendanceGroups";
import { parseRulesItem } from "./merchantAttendanceRules";
import { parsePersonalRulesItem, type PersonalRulesItem, type PersonalRulesWorker } from "./merchantAttendancePersonalRules";
import type { SourcesAssignment, SourcesRules, SourcesSection } from "./merchantAttendanceSources";

export type RuleSourcesQuery = { siteId: string; workerId: string; fromDate: string; throughDate: string };
export type RuleSourcesPersonalItem = { approval: Extract<PersonalRulesItem, { action: "approve" }>; withdrawal: Extract<PersonalRulesItem, { action: "withdraw" }> | null };
export type RuleSourcesPersonal = SourcesSection<RuleSourcesPersonalItem> & { revision: number };
export type RuleSourcesResult = {
  protocol: "rule-sources-v1"; siteId: string; actorId: string; fromDate: string; throughDate: string; worker: PersonalRulesWorker;
  settingsVersion: number; timeZone: string; fromAt: string; toAt: string; readAt: string;
  assignments: SourcesSection<SourcesAssignment>; rules: SourcesSection<SourcesRules>; personal: RuleSourcesPersonal; warnings: string[];
};
export type RuleSourcesResponse = RuleSourcesResult & { moduleEnabled: boolean };
export const RULE_SOURCES_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404,
  attendance_settings_required: 409, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_rule_sources_invalid: 503, attendance_rule_sources_too_large: 422, attendance_group_invalid: 503,
  attendance_rule_invalid: 503, attendance_personal_rule_invalid: 503, attendance_personal_rule_identity_changed: 409,
});

const MAX = 9007199254740990;
function fail(code = "attendance_rule_sources_invalid"): never { throw new MerchantAttendanceError(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (prototype !== null && prototype !== Object.prototype || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)) fail();
  return value as Record<string, unknown>;
}
// Before invoking older nested parsers, require a complete plain JSON tree.
// This prevents ignored symbols, getters, holes, inherited fields and toJSON.
function jsonTree(value: unknown) {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 20) fail("attendance_rule_sources_too_large");
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) fail();
    seen.add(v);
    const prototype = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      if (prototype !== Array.prototype || v.length > 4000 || keys.length !== v.length + 1) fail();
      for (let index = 0; index < v.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail();
        visit(descriptor.value, depth + 1);
      }
    } else {
      if (prototype !== null && prototype !== Object.prototype) fail();
      for (const key of keys) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) fail();
        const descriptor = descriptors[key];
        if (!("value" in descriptor) || !descriptor.enumerable) fail();
        visit(descriptor.value, depth + 1);
      }
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1048576) fail("attendance_rule_sources_too_large");
}
const integer = (v: unknown, minimum = 1): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= MAX ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const uuid = (v: unknown) => attendanceSelfUuid(v);
const optionalUuid = (v: unknown) => v === null ? null : uuid(v);
const micros = (v: string) => attendanceRecordInstant(v);
function zone(v: unknown) { if (typeof v !== "string") return fail(); return attendanceTimeZone(v); }
function instant(v: unknown) { if (typeof v !== "string") return fail(); attendanceInstant(v); return v; }
function recordAt(v: unknown) { const parsed = attendanceRecordInstant(v); return parsed === v ? parsed : fail(); }
function label(v: unknown, maximum: number) {
  return typeof v === "string" && !!v && v === v.trim() && [...v].length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
const overlap = (start: string, end: string | null, from: string, to: string) => micros(start) < micros(to) && (end === null || micros(end) > micros(from));
function section<T>(raw: unknown, parse: (item: unknown) => T): SourcesSection<T> {
  const v = exact(raw, ["limited", "items"]), limited = bool(v.limited);
  if (!Array.isArray(v.items) || v.items.length > 100 || limited && v.items.length !== 0) return fail();
  return { limited, items: v.items.map(parse) };
}
function ordered<T>(items: T[], key: (item: T) => string) {
  for (let index = 1; index < items.length; index++) if (key(items[index]) <= key(items[index - 1])) fail();
}
function unique<T>(items: T[], key: (item: T) => string | number) {
  if (new Set(items.map(key)).size !== items.length) fail();
}
function worker(raw: unknown): PersonalRulesWorker {
  const v = exact(raw, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
  const employeeId = optionalUuid(v.employeeId), employeeAuthUserId = optionalUuid(v.employeeAuthUserId), employeeActive = bool(v.employeeActive);
  if (employeeId === null && (employeeAuthUserId !== null || employeeActive)) fail();
  return { workerId: uuid(v.workerId), workerName: label(v.workerName, 120), workerNo: label(v.workerNo, 40), employeeId, employeeAuthUserId,
    version: integer(v.version), active: bool(v.active), employeeActive };
}

const queryKeys = ["siteId", "workerId", "fromDate", "throughDate"];
export function parseRuleSourcesQuery(raw: unknown): RuleSourcesQuery {
  try {
    const q = exact(raw, queryKeys), fromDate = groupDate(q.fromDate), throughDate = groupDate(q.throughDate);
    const dates = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
    if (!Number.isInteger(dates) || dates < 1 || dates > 7) fail();
    return { siteId: attendanceSelfSite(q.siteId), workerId: uuid(q.workerId), fromDate, throughDate };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseRuleSourcesHttpQuery(url: string): RuleSourcesQuery {
  try {
    const params = new URL(url).searchParams, query = Object.create(null) as Record<string, string>;
    for (const [key, value] of params) { if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail(); query[key] = value; }
    return parseRuleSourcesQuery(query);
  } catch { return fail("attendance_invalid_request"); }
}
export const ruleSourcesQueryString = (query: RuleSourcesQuery) => new URLSearchParams(parseRuleSourcesQuery(query)).toString();

const resultKeys = ["protocol", "siteId", "actorId", "fromDate", "throughDate", "worker", "settingsVersion", "timeZone", "fromAt", "toAt", "readAt", "assignments", "rules", "personal"];
const personalContext = ["employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules"] as const;
export function parseRuleSourcesResult(raw: unknown, input: RuleSourcesQuery, expectedActorId: string): RuleSourcesResult {
  const query = parseRuleSourcesQuery(input);
  try {
    jsonTree(raw);
    const v = exact(raw, resultKeys), actorId = uuid(v.actorId), currentWorker = worker(v.worker), settingsVersion = integer(v.settingsVersion);
    const timeZone = zone(v.timeZone), fromAt = instant(v.fromAt), toAt = instant(v.toAt), readAt = recordAt(v.readAt);
    if (v.protocol !== "rule-sources-v1" || v.siteId !== query.siteId || actorId !== uuid(expectedActorId) || currentWorker.workerId !== query.workerId
      || v.fromDate !== query.fromDate || v.throughDate !== query.throughDate || fromAt >= toAt
      || fromAt !== attendanceDayUtcRange(query.fromDate, timeZone).startAt || toAt !== attendanceDayUtcRange(query.throughDate, timeZone).endAt
      || readAt < "2000-01-01" || readAt >= "2101-01-01") fail();
    const warnings = new Set(["candidate_rules_not_applied", "historical_context_not_pinned"]);
    if (!currentWorker.active) warnings.add("inactive_worker");
    if (!currentWorker.employeeActive) warnings.add("inactive_employee");
    if (!currentWorker.employeeId || !currentWorker.employeeAuthUserId) warnings.add("unbound_employee");
    const assignments = section(v.assignments, rawItem => {
      const a = exact(rawItem, ["detail", "currentGroup"]), detail = parseGroupAssignmentDetail(a.detail), currentGroup = parseGroupItem(a.currentGroup);
      if (detail.workerId !== currentWorker.workerId || detail.groupId !== currentGroup.groupId || detail.updatedAt > readAt || currentGroup.updatedAt > readAt) fail();
      const original = detail.history[0].command;
      if (original.action !== "assign" || original.expectedGroupRevision > currentGroup.revision || original.expectedSettingsVersion > settingsVersion
        || original.expectedWorkerVersion > currentWorker.version || currentGroup.createdAt > detail.createdAt) fail();
      const start = attendanceDayUtcRange(detail.startsOn, detail.timeZone).startAt;
      const end = detail.endsOn === null ? null : attendanceDayUtcRange(detail.endsOn, detail.timeZone).endAt;
      const originalItem = detail.history[0].item;
      const originalEnd = originalItem.endsOn === null ? null : attendanceDayUtcRange(originalItem.endsOn, originalItem.timeZone).endAt;
      if (!overlap(start, originalEnd, fromAt, toAt)) fail();
      if (detail.employeeId !== currentWorker.employeeId) warnings.add("identity_changed");
      return { detail, currentGroup, fromAt: start, toAt: end, inPeriod: detail.status !== "cancelled" && overlap(start, end, fromAt, toAt), originalInPeriod: true };
    });
    ordered(assignments.items, item => item.detail.assignmentId);
    unique(assignments.items.flatMap(item => item.detail.history), item => item.command.operationId);
    const groups = new Map<string, GroupItem>();
    for (const assignment of assignments.items) {
      const prior = groups.get(assignment.currentGroup.groupId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(assignment.currentGroup)) fail();
      groups.set(assignment.currentGroup.groupId, assignment.currentGroup);
    }
    const liveAssignments = assignments.items.filter(item => item.inPeriod);
    for (let i = 0; i < liveAssignments.length; i++) for (let j = i + 1; j < liveAssignments.length; j++) {
      const a = liveAssignments[i], b = liveAssignments[j];
      if ((a.toAt === null || b.fromAt < a.toAt) && (b.toAt === null || a.fromAt < b.toAt)) warnings.add("assignment_utc_overlap");
    }
    let publicationsSeen = 0;
    const rules = section(v.rules, rawItem => {
      const r = exact(rawItem, ["groupId", "revision", "publications"]), groupId = r.groupId === null ? null : uuid(r.groupId), revision = integer(r.revision, 0);
      if (groupId !== null && !groups.has(groupId) || !Array.isArray(r.publications) || (publicationsSeen += r.publications.length) > 100) return fail();
      const publications = r.publications.map(rawPublication => {
        const p = parseRulesItem(rawPublication, groupId);
        if (p.action !== "publish" || p.revision > revision || p.settingsVersion! > settingsVersion || p.effectiveAt! >= toAt || p.recordedAt > readAt
          || groupId !== null && p.groupRevision! > groups.get(groupId)!.revision) fail();
        return p;
      });
      if (publications.filter(p => p.effectiveAt! <= fromAt).length > 1) fail();
      for (let n = 1; n < publications.length; n++) if (publications[n].revision <= publications[n - 1].revision || publications[n].effectiveAt! <= publications[n - 1].effectiveAt!
        || publications[n].recordedAt < publications[n - 1].recordedAt) fail();
      return { groupId, revision, publications };
    });
    ordered(rules.items, item => item.groupId ?? "");
    unique(rules.items.flatMap(item => item.publications), item => item.operationId);
    if (!rules.limited && (rules.items.length !== groups.size + 1 || rules.items[0]?.groupId !== null) || assignments.limited && !rules.limited) fail();

    const personalRaw = exact(v.personal, ["revision", "limited", "items"]), revision = integer(personalRaw.revision, 0);
    if (revision > 0 && (!currentWorker.employeeId || !currentWorker.employeeAuthUserId)) fail();
    const personalPart = section({ limited: personalRaw.limited, items: personalRaw.items }, rawItem => {
      const pair = exact(rawItem, ["approval", "withdrawal"]), approval = parsePersonalRulesItem(pair.approval), withdrawal = pair.withdrawal === null ? null : parsePersonalRulesItem(pair.withdrawal);
      if (approval.action !== "approve" || !overlap(approval.fromAt, approval.toAt, fromAt, toAt) || withdrawal !== null && withdrawal.action !== "withdraw") return fail();
      for (const item of [approval, ...(withdrawal ? [withdrawal] : [])]) {
        if (item.revision > revision || item.recordedAt > readAt || item.employeeId !== currentWorker.employeeId || item.employeeAuthUserId !== currentWorker.employeeAuthUserId
          || item.workerVersion > currentWorker.version || item.settingsVersion > settingsVersion) fail();
      }
      if (withdrawal && (withdrawal.approvedRevision !== approval.revision || withdrawal.revision <= approval.revision || withdrawal.recordedAt < approval.recordedAt
        || personalContext.some(key => JSON.stringify(withdrawal[key]) !== JSON.stringify(approval[key])))) fail();
      return { approval, withdrawal };
    });
    const personal: RuleSourcesPersonal = { revision, ...personalPart };
    for (let n = 1; n < personal.items.length; n++) if (personal.items[n].approval.revision <= personal.items[n - 1].approval.revision) fail();
    const operations = personal.items.flatMap(pair => pair.withdrawal ? [pair.approval, pair.withdrawal] : [pair.approval]);
    unique(operations, item => item.operationId); unique(operations, item => item.revision);
    const chronological = [...operations].sort((a, b) => a.revision - b.revision);
    for (let n = 1; n < chronological.length; n++) if (chronological[n].recordedAt < chronological[n - 1].recordedAt) fail();
    const active = personal.items.filter(pair => pair.withdrawal === null).map(pair => pair.approval).sort((a, b) => a.fromAt.localeCompare(b.fromAt));
    for (let n = 1; n < active.length; n++) if (active[n].fromAt < active[n - 1].toAt) fail();
    for (const [name, part] of Object.entries({ assignments, rules, personal })) if (part.limited) warnings.add(`${name}_truncated`);
    return { protocol: "rule-sources-v1", siteId: query.siteId, actorId, fromDate: query.fromDate, throughDate: query.throughDate,
      worker: currentWorker, settingsVersion, timeZone, fromAt, toAt, readAt, assignments, rules, personal, warnings: [...warnings] };
  } catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_rule_sources_too_large") throw error;
    return fail();
  }
}
export function parseRuleSourcesResponse(raw: unknown, query: RuleSourcesQuery, actorId: string): RuleSourcesResponse {
  try {
    jsonTree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]);
    if (v.ok !== true) fail();
    return { ...parseRuleSourcesResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) };
  } catch (error) {
    if (error instanceof MerchantAttendanceError && (error.code === "attendance_rule_sources_too_large" || error.code === "attendance_invalid_request")) throw error;
    return fail();
  }
}
