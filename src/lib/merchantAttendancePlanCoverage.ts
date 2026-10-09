// Read-only geometry of explicitly linked, closed clock-in/out spans. Breaks
// remain inside the spans. This is NOT worked time or an attendance assessment.
import { captureBrowserExact as exact, captureBrowserUuid as uuid } from "./merchantAttendanceRuleCapturesBrowser";
import { attendanceSelfSite } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseShiftCheckResult, validateShiftCheckTree, SHIFT_CHECK_ERRORS, type ShiftCheckData, type ShiftCheckResult } from "./merchantAttendanceShiftCheck";
import type { ShiftRuleBindingWorker } from "./merchantAttendanceShiftRuleBinding";
import type { SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";

export const PLAN_COVERAGE_BYTE_LIMIT = 1048576;
export const PLAN_COVERAGE_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...SHIFT_CHECK_ERRORS,
  attendance_plan_coverage_invalid: 503, attendance_plan_coverage_not_found: 404, attendance_plan_coverage_too_large: 422,
});
export type PlanCoverageQuery = { siteId: string; workerId: string; slotId: string };
export type PlanCoverageData = { protocol: "plan-coverage-v1"; algorithmVersion: "explicit-closed-spans-v1"; readOnly: true; formalReady: false;
  siteId: string; actorId: string; worker: ShiftRuleBindingWorker; slot: SelfScheduleSlot; readStartedAt: string; readCompletedAt: string; sessions: ShiftCheckData[] };
export type PlanCoverageInterval = { startAt: string; endAt: string; durationUs: string };
export type PlanCoverageSegment = PlanCoverageInterval & { startEventIds: string[] };
export type PlanCoverageView = { coverage: PlanCoverageInterval[]; segments: PlanCoverageSegment[]; overlaps: PlanCoverageSegment[];
  coveredUs: string; overlapUs: string; gaps: PlanCoverageInterval[] | null; closedCount: number; openIds: string[]; unverifiedIds: string[];
  zeroIds: string[]; outsideIds: string[] };
export type PlanCoverageResult = Omit<PlanCoverageData, "sessions"> & { sessions: ShiftCheckResult[]; original: PlanCoverageView; selected: PlanCoverageView;
  phase: "future" | "ongoing" | "ended"; gapBlockers: string[]; hasApprovedChanges: boolean };
export type PlanCoverageResponse = PlanCoverageResult & { moduleEnabled: boolean };
const fail = (): never => { throw new MerchantAttendanceError("attendance_plan_coverage_invalid"); };
const tooLarge = (): never => { throw new MerchantAttendanceError("attendance_plan_coverage_too_large"); };
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const integer = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 9007199254740990 ? v : fail();
function label(v: unknown, max: number): string {
  return typeof v === "string" && !!v && v === v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
function stamp(v: unknown, precision: 3 | 6 = 6): string {
  if (typeof v !== "string" || !(precision === 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(v)
    || v < "2000-01-01" || v >= "2101-01-01") return fail();
  const short = v.slice(0, 23) + "Z", n = Date.parse(short); if (!Number.isFinite(n) || new Date(n).toISOString() !== short) fail(); return v;
}
const us = (v: string) => BigInt(Date.parse(v.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(v.length === 27 ? v.slice(23, 26) : "0");
const utc = (v: bigint) => new Date(Number(v / BigInt(1000))).toISOString().slice(0, 23) + String(v % BigInt(1000)).padStart(3, "0") + "Z";
const interval = (a: bigint, b: bigint): PlanCoverageInterval => ({ startAt: utc(a), endAt: utc(b), durationUs: String(b - a) });
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const keys = ["siteId", "workerId", "slotId"];
export function parsePlanCoverageQuery(raw: unknown): PlanCoverageQuery {
  try { const q = exact(raw, keys); return { siteId: attendanceSelfSite(q.siteId), workerId: uuid(q.workerId), slotId: uuid(q.slotId) }; }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parsePlanCoverageHttpQuery(url: string): PlanCoverageQuery {
  try {
    const q = Object.create(null) as Record<string, unknown>, params = new URL(url).searchParams;
    for (const [key, value] of params) { if (!keys.includes(key) || params.getAll(key).length !== 1) fail(); q[key] = value; }
    return parsePlanCoverageQuery(q);
  } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export const planCoverageQueryString = (q: PlanCoverageQuery) => new URLSearchParams(parsePlanCoverageQuery(q)).toString();

function slotData(raw: unknown): SelfScheduleSlot {
  const s = exact(raw, ["id", "revision", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "cancelled", "hasPublicationEvidence"]);
  const startAt = stamp(s.startAt, 3), endAt = stamp(s.endAt, 3), workDate = label(s.workDate, 10), start = us(startAt), end = us(endAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) fail(); stamp(workDate + "T00:00:00.000Z", 3);
  if (end <= start || end - start > BigInt(86400000000) || start % BigInt(60000000) || end % BigInt(60000000)) fail();
  return { id: uuid(s.id), revision: integer(s.revision), locationId: uuid(s.locationId), locationName: label(s.locationName, 120), timeZone: label(s.timeZone, 100),
    workDate, startAt, endAt, cancelled: bool(s.cancelled), hasPublicationEvidence: bool(s.hasPublicationEvidence) };
}
function view(sessions: ShiftCheckResult[], slot: SelfScheduleSlot, kind: "original" | "selected", gapsAvailable: boolean): PlanCoverageView {
  const start = us(slot.startAt), end = us(slot.endAt), entries: { id: string; start: bigint; end: bigint }[] = [];
  const openIds: string[] = [], unverifiedIds: string[] = [], zeroIds: string[] = [], outsideIds: string[] = []; let closedCount = 0;
  for (const session of sessions) {
    const id = session.rule.event.startEventId, span = kind === "original" ? session.original : session.approved ?? session.original;
    if (session.relation!.status !== "linked") { unverifiedIds.push(id); continue; }
    if (span.endAt === null) { openIds.push(id); continue; }
    closedCount++; const a = us(span.startAt), b = us(span.endAt);
    if (a === b) { zeroIds.push(id); continue; }
    const clippedStart = a > start ? a : start, clippedEnd = b < end ? b : end;
    if (clippedStart >= clippedEnd) { outsideIds.push(id); continue; }
    entries.push({ id, start: clippedStart, end: clippedEnd });
  }
  const points = [...new Set(entries.flatMap(e => [e.start, e.end]))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const segments: PlanCoverageSegment[] = [], coverage: PlanCoverageInterval[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], ids = entries.filter(e => e.start <= a && e.end >= b).map(e => e.id).sort();
    if (a === b || !ids.length) continue;
    segments.push({ ...interval(a, b), startEventIds: ids });
    const previous = coverage.at(-1);
    if (previous && us(previous.endAt) === a) coverage[coverage.length - 1] = interval(us(previous.startAt), b);
    else coverage.push(interval(a, b));
  }
  const overlaps = segments.filter(s => s.startEventIds.length > 1), gaps: PlanCoverageInterval[] | null = gapsAvailable ? [] : null;
  if (gaps) {
    let cursor = start;
    for (const part of coverage) { const a = us(part.startAt), b = us(part.endAt); if (cursor < a) gaps.push(interval(cursor, a)); cursor = b; }
    if (cursor < end) gaps.push(interval(cursor, end));
  }
  const sum = (list: PlanCoverageInterval[]) => String(list.reduce((n, i) => n + BigInt(i.durationUs), BigInt(0)));
  return { coverage, segments, overlaps, coveredUs: sum(coverage), overlapUs: sum(overlaps), gaps, closedCount, openIds, unverifiedIds, zeroIds, outsideIds };
}

export function parsePlanCoverageResult(raw: unknown, input: PlanCoverageQuery, actorId: string): PlanCoverageResult {
  const query = parsePlanCoverageQuery(input);
  try {
    validateShiftCheckTree(raw);
    const v = exact(raw, ["protocol", "algorithmVersion", "readOnly", "formalReady", "siteId", "actorId", "worker", "slot", "readStartedAt", "readCompletedAt", "sessions"]);
    if (v.protocol !== "plan-coverage-v1" || v.algorithmVersion !== "explicit-closed-spans-v1" || v.readOnly !== true || v.formalReady !== false
      || v.siteId !== query.siteId || v.actorId !== uuid(actorId)) fail();
    const w = exact(v.worker, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
    const worker: ShiftRuleBindingWorker = { workerId: uuid(w.workerId), workerName: label(w.workerName, 120), workerNo: label(w.workerNo, 40), employeeId: uuid(w.employeeId),
      employeeAuthUserId: uuid(w.employeeAuthUserId), version: integer(w.version), active: bool(w.active), employeeActive: bool(w.employeeActive) };
    const slot = slotData(v.slot), readStartedAt = stamp(v.readStartedAt), readCompletedAt = stamp(v.readCompletedAt);
    if (worker.workerId !== query.workerId || slot.id !== query.slotId || readCompletedAt < readStartedAt || !Array.isArray(v.sessions)) fail();
    const items = v.sessions as unknown[]; if (items.length > 10) tooLarge();
    const ids = new Set<string>(), eventIds = new Set<string>(); let eventCount = 0, previousId = "";
    const sessions = items.map(rawSession => {
      const data = exact(rawSession, ["protocol", "algorithmVersion", "readOnly", "formalReady", "asOf", "rule", "events", "effect", "relation"]);
      // Descriptors/size of the entire tree were checked above before accessing.
      const id = uuid((data.rule as ShiftCheckData["rule"])?.event?.startEventId);
      const session = parseShiftCheckResult(data, { siteId: query.siteId, workerId: query.workerId, startEventId: id }, actorId);
      if (ids.has(id) || id <= previousId) fail(); ids.add(id); previousId = id;
      if (Object.entries(worker).some(([key, value]) => session.rule.worker[key as keyof ShiftRuleBindingWorker] !== value)
        || session.rule.readAt < readStartedAt || session.asOf > readCompletedAt) fail();
      const relation = session.relation;
      if (!relation || relation.status === "unselected" || !relation.slot || !relation.selection
        || relation.selection.slotId !== slot.id || relation.selection.revision !== slot.revision || relation.currentCancelled !== slot.cancelled
        || Object.entries(slot).some(([key, value]) => key !== "cancelled" && relation.slot![key as keyof SelfScheduleSlot] !== value)) fail();
      for (const event of session.events) { if (eventIds.has(event.id)) fail(); eventIds.add(event.id); }
      eventCount += session.events.length; if (eventCount > 2002) tooLarge(); return session;
    });
    // One worker's original sequence is linear, even if corrected spans overlap.
    const ordered = [...sessions].sort((a, b) => a.events[0].sequence - b.events[0].sequence);
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1], next = ordered[i];
      if (previous.original.endAt === null || previous.events.at(-1)!.sequence >= next.events[0].sequence
        || previous.original.endAt > next.original.startAt) fail();
    }
    const phase = us(readStartedAt) < us(slot.startAt) ? "future" : us(readStartedAt) < us(slot.endAt) ? "ongoing" : "ended";
    const gapBlockers = [
      ...(!sessions.length ? ["no_explicit_relations"] : []), ...(!slot.hasPublicationEvidence ? ["publication_missing"] : []),
      ...(slot.cancelled ? ["cancelled"] : []), ...(phase !== "ended" ? ["plan_not_ended"] : []),
      ...(sessions.some(s => s.relation!.status !== "linked") ? ["unverified_relations"] : []),
      ...(sessions.some(s => s.original.endAt === null) ? ["open_sessions"] : []),
    ];
    return freeze({ protocol: "plan-coverage-v1", algorithmVersion: "explicit-closed-spans-v1", readOnly: true, formalReady: false, siteId: query.siteId,
      actorId, worker, slot, readStartedAt, readCompletedAt, sessions, phase, gapBlockers, hasApprovedChanges: sessions.some(s => s.effect !== null),
      original: view(sessions, slot, "original", !gapBlockers.length), selected: view(sessions, slot, "selected", !gapBlockers.length) });
  } catch (error) {
    if (error instanceof MerchantAttendanceError && ["attendance_plan_coverage_too_large", "attendance_shift_check_too_large"].includes(error.code)) return tooLarge();
    return fail();
  }
}
export function parsePlanCoverageData(raw: unknown, query: PlanCoverageQuery, actorId: string): PlanCoverageData {
  const r = parsePlanCoverageResult(raw, query, actorId);
  return freeze({ protocol: r.protocol, algorithmVersion: r.algorithmVersion, readOnly: true, formalReady: false, siteId: r.siteId, actorId: r.actorId,
    worker: r.worker, slot: r.slot, readStartedAt: r.readStartedAt, readCompletedAt: r.readCompletedAt,
    sessions: r.sessions.map(s => ({ protocol: s.protocol, algorithmVersion: s.algorithmVersion, readOnly: true, formalReady: false,
      asOf: s.asOf, rule: s.rule, events: s.events, effect: s.effect, relation: s.relation })) });
}
export function parsePlanCoverageResponse(raw: unknown, query: PlanCoverageQuery, actorId: string): PlanCoverageResponse {
  try { validateShiftCheckTree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail();
    return freeze({ ...parsePlanCoverageResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) });
  } catch (error) {
    if (error instanceof MerchantAttendanceError && ["attendance_plan_coverage_too_large", "attendance_shift_check_too_large"].includes(error.code)) return tooLarge();
    return fail();
  }
}
