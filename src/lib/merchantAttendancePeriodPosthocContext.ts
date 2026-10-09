//207 immutable period evidence. This never fetches current heads, impersonates
//an owner, recalculates timesheets or interprets saved civil dates with Intl.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parsePlanPosthocEvidence, parsePlanPosthocSavedHead } from "./merchantAttendancePlanPosthocEvidence";
import { exact, safeTree, safePeriodSourceTree, uuid, integer, stamp, micros, same, label, enumValue } from "./merchantAttendancePlanExceptionValidation";
import type { PeriodClosureWorker, PeriodClosureRange } from "./merchantAttendancePeriodClosure";
import type { PlanPosthocEvaluationSource } from "./merchantAttendancePlanPosthocEvaluationContract";

export type PeriodPosthocContextEntry = PlanPosthocEvaluationSource["posthoc"] & { slotId: string };
const policy = "owner-confirmed-plan-edges-posthoc-v3";
const invalid = (): never => { throw new MerchantAttendanceError("attendance_period_closure_invalid"); };
function object(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid(); return raw as Record<string, unknown>;
}
function array(raw: unknown, max: number): unknown[] { if (!Array.isArray(raw) || raw.length > max) return invalid(); return raw; }
const entryKeys = ["operationId", "revision", "actorId", "kind", "outcome", "note", "decisionOperationId", "recordedAt", "evidence"];

export function validatePeriodPosthocContext(raw: unknown, worker: PeriodClosureWorker, period: PeriodClosureRange, completeSource = false): PeriodPosthocContextEntry[] {
  try {
    const tree = completeSource ? safePeriodSourceTree : safeTree;
    tree(raw, 2097152); const source = object(raw), context = source.context == null ? null : object(source.context);
    if (source.sourceVersion !== "attendance-period-source-v3") {
      //No synthesized empty section for old archives, nor a v3 ledger disguised
      //as legacy bytes. Original v1/v2 validation otherwise remains unchanged.
      if (context && (Object.hasOwn(context, "posthoc") || Array.isArray(context.reviews) && context.reviews.some(r => {
        const row = r !== null && typeof r === "object" && !Array.isArray(r) ? r as Record<string, unknown> : null;
        const decision = row?.latestDecision; return decision !== null && typeof decision === "object" && !Array.isArray(decision)
          && (decision as { evidence?: { policy?: unknown } }).evidence?.policy === policy;
      }))) invalid();
      return [];
    }
    tree(source, 1048576);
    if (!context) return invalid();
    if (source.workerId !== worker.workerId || source.employeeId !== worker.employeeId || source.employeeAuthUserId !== worker.employeeAuthUserId
      || source.fromDate !== period.fromDate || source.throughDate !== period.throughDate || source.timeZone !== period.timeZone
      || source.fromAt !== period.startAt || source.toAt !== period.endAt) invalid();
    exact(context, ["pendingCorrections", "missing", "leave", "calendar", "plans", "reviews", "posthoc", ...(Object.hasOwn(context, "workArrangements") ? ["workArrangements"] : [])]);
    const plans = exact(context.plans, ["items", "sessions"]), slots = new Map<string, Record<string, unknown>>();
    const addSlot = (rawSlot: unknown) => {
      const s = object(rawSlot), id = uuid(s.id); uuid(s.locationId); label(s.timeZone, 100); stamp(s.startAt, 3); stamp(s.endAt, 3);
      if (micros(s.startAt as string) >= micros(s.endAt as string)) invalid();
      const previous = slots.get(id);
      if (previous && ["locationId", "timeZone", "startAt", "endAt"].some(k => previous[k] !== s[k])) invalid(); slots.set(id, s);
    };
    for (const item of array(plans.items, 100)) addSlot(object(item).slot);
    for (const item of array(plans.sessions, 100)) { const relation = object(item).relation; if (relation !== null && relation !== undefined && object(relation).slot != null) addSlot(object(relation).slot); }
    const heads = new Map<string, PeriodPosthocContextEntry>(), values = array(context.posthoc, 100); if (!values.length) invalid();
    let previousSlot = "";
    for (const rawHead of values) {
      const h = exact(rawHead, ["slotId", "revision", "current", "selected", "approval"]), slotId = uuid(h.slotId), slot = slots.get(slotId);
      if (!slot) return invalid();
      if (slotId <= previousSlot) invalid(); previousSlot = slotId;
      const parsed = parsePlanPosthocSavedHead({ revision: h.revision, current: h.current, selected: h.selected, approval: h.approval }, { slotId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId });
      if (!parsed.current || parsed.approval && micros(parsed.approval.recordedAt) >= micros(slot.startAt as string)) invalid();
      for (const candidate of parsed.selected) if (candidate.locationId !== slot.locationId
        || micros(candidate.selected.startAt!) >= micros(slot.endAt as string) || micros(candidate.selected.endAt!) <= micros(slot.startAt as string)) invalid();
      heads.set(slotId, { slotId, ...parsed });
    }
    const reviewSlots = new Set<string>(); let previousCase = "";
    for (const rawReview of array(context.reviews, 100)) {
      const r = exact(rawReview, ["caseId", "slotId", "revision", "latestDecision", "latestNote", "read"]), caseId = uuid(r.caseId), slotId = uuid(r.slotId), revision = integer(r.revision);
      if (caseId <= previousCase || reviewSlots.has(slotId) || !slots.has(slotId)) invalid(); previousCase = caseId; reviewSlots.add(slotId);
      const d = exact(r.latestDecision, entryKeys), decisionId = uuid(d.operationId), decisionRevision = integer(d.revision, 1, revision), recordedAt = stamp(d.recordedAt);
      if (d.kind !== "decision" || d.decisionOperationId !== null || uuid(d.actorId) === worker.employeeAuthUserId) invalid(); label(d.note, 1000);
      const outcome = enumValue(d.outcome, ["confirmed", "excused", "follow_up", "cleared", "not_applicable"] as const);
      const evidence = object(d.evidence);
      if (evidence.policy === policy) {
        const head = heads.get(slotId), checked = parsePlanPosthocEvidence(evidence, { slotId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId });
        const slot = slots.get(slotId)!;
        if (!head || checked.evaluation.posthoc.revision > head.revision || micros(checked.observedAt) > micros(recordedAt)
          || ["locationId", "timeZone", "startAt", "endAt"].some(k => checked.evaluation.slot[k as "locationId" | "timeZone" | "startAt" | "endAt"] !== slot[k])
          || checked.evaluation.posthoc.revision === head.revision && !same(checked.evaluation.posthoc, { revision: head.revision, current: head.current, selected: head.selected, approval: head.approval })) invalid();
        if (outcome === "not_applicable" && (decisionRevision < 2 || !checked.eligible || checked.evaluation.state !== "not_applicable")
          || outcome === "cleared" && (decisionRevision < 2 || !checked.eligible || checked.candidate.late.state !== "not_triggered" || checked.candidate.early.state !== "not_triggered")
          || (outcome === "confirmed" || outcome === "excused") && (!checked.eligible || checked.evaluation.state !== "required" || checked.candidate.late.state !== "triggered" && checked.candidate.early.state !== "triggered")) invalid();
      } else if (!["owner-confirmed-plan-edges-v1", "owner-confirmed-plan-edges-work-v2"].includes(String(evidence.policy)) || outcome === "not_applicable") invalid();
      let noteRevision = 0;
      if (r.latestNote !== null) {
        const n = exact(r.latestNote, entryKeys); uuid(n.operationId); uuid(n.decisionOperationId); label(n.note, 1000);
        noteRevision = integer(n.revision, 2, revision); const noteAt = stamp(n.recordedAt);
        if (n.kind !== "note" || n.outcome !== null || n.evidence !== null || n.actorId !== worker.employeeAuthUserId || noteRevision === decisionRevision
          || noteRevision > decisionRevision && (n.decisionOperationId !== decisionId || micros(noteAt) < micros(recordedAt))
          || noteRevision < decisionRevision && micros(noteAt) > micros(recordedAt)) invalid();
      }
      if (revision !== Math.max(decisionRevision, noteRevision)) invalid();
      if (r.read !== null) { const read = exact(r.read, ["operationId", "decisionOperationId", "readAt"]); uuid(read.operationId);
        if (read.decisionOperationId !== decisionId || micros(stamp(read.readAt)) < micros(recordedAt)) invalid(); }
    }
    if ([...heads.keys()].some(id => !reviewSlots.has(id))) invalid();
    return [...heads.values()];
  } catch { return invalid(); }
}
