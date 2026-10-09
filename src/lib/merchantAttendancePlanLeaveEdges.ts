import type { PlanExceptionLeave } from "./merchantAttendancePlanExceptionSourceContract";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, uuid, integer, bool, enumValue, stamp, micros, safeTree, freeze } from "./merchantAttendancePlanExceptionValidation";

export type PlanLeaveInterval = { startAt: string; endAt: string };
export type PlanLeaveRef = { requestId: string; operationId: string; revision: number };
export type PlanLeaveResolvedSource = PlanExceptionLeave & { current: boolean };
export type PlanLeaveResolvedContext = { limited: boolean; resolved: boolean; items: PlanLeaveResolvedSource[] };
export type PlanLeaveWorkRef = { kind: "session" | "missing"; sourceId: string; operationId: string | null };
export type PlanLeaveWork = PlanLeaveWorkRef & { startAt: string | null; endAt: string | null };
export type PlanLeaveEdgesInput = { plan: PlanLeaveInterval; leave: PlanLeaveResolvedContext; work: PlanLeaveWork[] };
export type PlanLeaveCoverage = PlanLeaveInterval & { leaveRefs: PlanLeaveRef[] };
export type PlanLeaveWorkOverlap = PlanLeaveInterval & { work: PlanLeaveWorkRef; leave: PlanLeaveRef };
export const PLAN_LEAVE_EDGES_BLOCKERS = ["leave_context_unknown", "leave_pending", "work_endpoint_missing", "work_zero_duration", "source_outside_plan", "work_leave_overlap"] as const;
export type PlanLeaveEdgesBlocker = typeof PLAN_LEAVE_EDGES_BLOCKERS[number];
export type PlanLeaveEdgesResult = {
  version: "plan-leave-edges-v1"; plan: PlanLeaveInterval; leave: PlanLeaveResolvedContext; work: PlanLeaveWork[];
  approvedCoverage: PlanLeaveCoverage[] | null; remainingRequired: PlanLeaveInterval[] | null;
  fullCoverage: boolean | null; requiredStartAt: string | null; requiredEndAt: string | null;
  workLeaveOverlaps: PlanLeaveWorkOverlap[] | null; pending: PlanLeaveRef[]; unknown: boolean;
  state: "required" | "not_applicable" | "blocked"; blockers: PlanLeaveEdgesBlocker[];
};

// Caller-owned evidence resolution is mandatory. `resolved/current` are explicit
// inputs, NOT identity/authorization/history proofs produced by this calculator.
// The caller must verify complete current leave heads and work sources first.
// No work durations, policy thresholds, original punches or candidate enums are
// changed here. A work span is conservative: its recorded breaks are not used to
// silently remove a work/leave conflict. Work-vs-work reconciliation is separate.
const MAX_ITEMS = 100, MAX_OVERLAPS = 1000, MAX_BYTES = 1048576;
const invalid = (): never => { throw new MerchantAttendanceError("attendance_plan_leave_edges_invalid"); };
const tooLarge = (): never => { throw new MerchantAttendanceError("attendance_plan_leave_edges_too_large"); };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function instant(raw: unknown): string {
  if (typeof raw !== "string" || raw.length !== 24 && raw.length !== 27) return invalid();
  const value = stamp(raw, raw.length === 24 ? 3 : 6);
  if (value < "2000-01-01" || value >= "2101-01-01") return invalid();
  // Preserve the six-digit microsecond tail exactly; only pad genuine UTC3.
  return value.length === 24 ? value.slice(0, -1) + "000Z" : value;
}
function interval(raw: unknown): PlanLeaveInterval {
  const v = exact(raw, ["startAt", "endAt"]), startAt = instant(v.startAt), endAt = instant(v.endAt);
  if (micros(startAt) >= micros(endAt)) return invalid(); return { startAt, endAt };
}
function list(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return invalid(); if (raw.length > MAX_ITEMS) return tooLarge(); return raw;
}
function source(raw: unknown): PlanLeaveResolvedSource {
  const v = exact(raw, ["requestId", "operationId", "revision", "status", "startAt", "endAt", "recordedAt", "current"]);
  const requestId = uuid(v.requestId), operationId = uuid(v.operationId), revision = integer(v.revision, 1, 3);
  const status = enumValue(v.status, ["submitted", "approved", "rejected", "withdrawn", "cancelled"] as const);
  if (revision === 1 ? status !== "submitted" || operationId !== requestId
    : operationId === requestId || (revision === 3 ? status !== "cancelled" : !["approved", "rejected", "withdrawn"].includes(status))) invalid();
  return { requestId, operationId, revision, status, ...interval({ startAt: v.startAt, endAt: v.endAt }), recordedAt: instant(v.recordedAt), current: bool(v.current) };
}
function workSource(raw: unknown): PlanLeaveWork {
  const v = exact(raw, ["kind", "sourceId", "operationId", "startAt", "endAt"]);
  const kind = enumValue(v.kind, ["session", "missing"] as const), sourceId = uuid(v.sourceId), operationId = v.operationId === null ? null : uuid(v.operationId);
  const startAt = v.startAt === null ? null : instant(v.startAt), endAt = v.endAt === null ? null : instant(v.endAt);
  if (kind === "missing" && (operationId === null || operationId === sourceId)
    || startAt !== null && endAt !== null && micros(endAt) < micros(startAt)) invalid();
  return { kind, sourceId, operationId, startAt, endAt };
}
function parse(raw: unknown): PlanLeaveEdgesInput {
  safeTree(raw, MAX_BYTES);
  const v = exact(raw, ["plan", "leave", "work"]), l = exact(v.leave, ["limited", "resolved", "items"]);
  const plan = interval(v.plan), items = list(l.items).map(source), work = list(v.work).map(workSource);
  const requests = new Set<string>(), operations = new Set<string>(), workIds = new Set<string>(), workOps = new Set<string>();
  for (const item of items) {
    if (requests.has(item.requestId) || operations.has(item.operationId)) invalid();
    requests.add(item.requestId); operations.add(item.operationId);
  }
  for (const item of work) {
    const key = item.kind + ":" + item.sourceId, op = item.kind + ":" + item.operationId;
    if (workIds.has(key) || item.operationId !== null && workOps.has(op)) invalid();
    workIds.add(key); if (item.operationId !== null) workOps.add(op);
  }
  items.sort((a, b) => compare(a.requestId, b.requestId));
  work.sort((a, b) => compare(a.kind, b.kind) || compare(a.sourceId, b.sourceId));
  return { plan, leave: { limited: bool(l.limited), resolved: bool(l.resolved), items }, work };
}
const ref = (s: PlanLeaveResolvedSource): PlanLeaveRef => ({ requestId: s.requestId, operationId: s.operationId, revision: s.revision });
const workRef = (s: PlanLeaveWork): PlanLeaveWorkRef => ({ kind: s.kind, sourceId: s.sourceId, operationId: s.operationId });
function intersection(a: PlanLeaveInterval, b: PlanLeaveInterval): PlanLeaveInterval | null {
  const startAt = micros(a.startAt) > micros(b.startAt) ? a.startAt : b.startAt;
  const endAt = micros(a.endAt) < micros(b.endAt) ? a.endAt : b.endAt;
  return micros(startAt) < micros(endAt) ? { startAt, endAt } : null;
}

/** Calculates only the approved policy's geometric leave coverage. Null arrays
 * and edges mean incomplete/unresolved evidence, never an empty or normal plan.
 * `not_applicable` is an independent result, not the old `cleared` outcome and
 * never authority to save a decision without the caller's remaining guards. */
export function calculatePlanLeaveEdges(raw: unknown): PlanLeaveEdgesResult {
  try {
    const input = parse(raw), { plan, leave, work } = input, flags = new Set<PlanLeaveEdgesBlocker>();
    const unknown = leave.limited || !leave.resolved;
    if (unknown) flags.add("leave_context_unknown");
    const current = leave.resolved ? leave.items.filter(s => s.current && intersection(s, plan) !== null) : [];
    const pending = current.filter(s => s.status === "submitted").map(ref);
    if (pending.length) flags.add("leave_pending");
    for (const w of work) {
      if (w.startAt === null || w.endAt === null) flags.add("work_endpoint_missing");
      else if (micros(w.startAt) === micros(w.endAt)) flags.add("work_zero_duration");
      else if (intersection({ startAt: w.startAt, endAt: w.endAt }, plan) === null) flags.add("source_outside_plan");
    }
    let approvedCoverage: PlanLeaveCoverage[] | null = null, remainingRequired: PlanLeaveInterval[] | null = null;
    let workLeaveOverlaps: PlanLeaveWorkOverlap[] | null = null, fullCoverage: boolean | null = null;
    let requiredStartAt: string | null = null, requiredEndAt: string | null = null;
    if (!unknown) {
      const pieces = current.filter(s => s.status === "approved").map(s => ({ ...intersection(s, plan)!, leave: ref(s) }))
        .sort((a, b) => compare(a.startAt, b.startAt) || compare(a.endAt, b.endAt) || compare(a.leave.requestId, b.leave.requestId));
      approvedCoverage = [];
      for (const piece of pieces) {
        const prior = approvedCoverage.at(-1);
        // Half-open touching work/leave is not overlap, but touching leave
        // pieces form one continuous coverage component without a gap.
        if (prior && micros(piece.startAt) <= micros(prior.endAt)) {
          if (micros(piece.endAt) > micros(prior.endAt)) prior.endAt = piece.endAt;
          prior.leaveRefs.push(piece.leave);
        } else approvedCoverage.push({ startAt: piece.startAt, endAt: piece.endAt, leaveRefs: [piece.leave] });
      }
      for (const component of approvedCoverage) component.leaveRefs.sort((a, b) => compare(a.requestId, b.requestId));
      remainingRequired = []; let cursor = plan.startAt;
      for (const component of approvedCoverage) {
        if (micros(cursor) < micros(component.startAt)) remainingRequired.push({ startAt: cursor, endAt: component.startAt });
        cursor = component.endAt;
      }
      if (micros(cursor) < micros(plan.endAt)) remainingRequired.push({ startAt: cursor, endAt: plan.endAt });
      fullCoverage = remainingRequired.length === 0;
      requiredStartAt = remainingRequired[0]?.startAt ?? null; requiredEndAt = remainingRequired.at(-1)?.endAt ?? null;
      if (!fullCoverage && work.length === 0) flags.add("work_endpoint_missing");
      workLeaveOverlaps = [];
      for (const w of work) {
        // Unknown/open endpoints are blocked above, not extrapolated to a
        // guessed end time. This list covers only complete positive spans.
        if (w.startAt === null || w.endAt === null || micros(w.startAt) === micros(w.endAt)) continue;
        // Per-source intersections retain exactly the contributing approval.
        // A merged component's other refs must not be attributed to this span.
        for (const piece of pieces) {
          const part = intersection({ startAt: w.startAt, endAt: w.endAt }, piece);
          if (!part) continue;
          if (workLeaveOverlaps.length >= MAX_OVERLAPS) tooLarge();
          workLeaveOverlaps.push({ ...part, work: workRef(w), leave: piece.leave });
        }
      }
      if (workLeaveOverlaps.length) flags.add("work_leave_overlap");
    }
    const blockers = PLAN_LEAVE_EDGES_BLOCKERS.filter(code => flags.has(code));
    const result: PlanLeaveEdgesResult = { version: "plan-leave-edges-v1", ...input, approvedCoverage, remainingRequired, fullCoverage,
      requiredStartAt, requiredEndAt, workLeaveOverlaps, pending, unknown,
      state: blockers.length ? "blocked" : fullCoverage ? "not_applicable" : "required", blockers };
    safeTree(result, MAX_BYTES); return freeze(result);
  } catch (error) {
    if (error instanceof MerchantAttendanceError && ["attendance_plan_leave_edges_too_large", "attendance_plan_exception_too_large"].includes(error.code)) return tooLarge();
    return invalid();
  }
}
