// Compact historical v3 evidence, never a fabricated full source. Geometry and
//selected endpoints can be checked here; original linked endpoints and hidden
//SQL-only completeness guards remain attested by the immutable SQL evidence and
//its full-source fingerprint. Current authorization is not inferred from this.
import type { PlanExceptionLegacyEvidence, PlanExceptionSessionReference } from "./merchantAttendancePlanExceptionContract";
import type { PlanPosthocApproval, PlanPosthocCandidate, PlanPosthocOperation, PlanPosthocReference } from "./merchantAttendancePlanPosthocContract";
import type { PlanPosthocEvaluationSource, PlanPosthocEvaluationBlocker, PlanPosthocObservation } from "./merchantAttendancePlanPosthocEvaluationContract";
import { PLAN_POSTHOC_CANDIDATE_BLOCKERS } from "./merchantAttendancePlanPosthocContract";
import { PLAN_POSTHOC_EVALUATION_BLOCKERS, PLAN_POSTHOC_OBSERVATION_BLOCKERS } from "./merchantAttendancePlanPosthocEvaluationContract";
import { planPosthocReferenceKey } from "./merchantAttendancePlanPosthoc";
import { calculatePlanLeaveEdges, type PlanLeaveEdgesResult } from "./merchantAttendancePlanLeaveEdges";
import { parseExceptionCandidate, parseExceptionEndpoints, parseExceptionSection } from "./merchantAttendancePlanExceptionSource";
import { exact, fail, uuid, hash, integer, bool, label, stamp, micros, enumValue, optionalUuid, safeTree, same, freeze } from "./merchantAttendancePlanExceptionValidation";

export type PlanPosthocSavedScope = { slotId: string; employeeId: string; employeeAuthUserId: string };
export type PlanExceptionPosthocEvidence = Omit<PlanExceptionLegacyEvidence, "policy" | "blockers"> & {
  policy: "owner-confirmed-plan-edges-posthoc-v3";
  blockers: PlanPosthocEvaluationBlocker[];
  evaluation: {
    state: "required" | "blocked" | "not_applicable";
    slot: { slotId: string; locationId: string; timeZone: string; startAt: string; endAt: string };
    posthoc: PlanPosthocEvaluationSource["posthoc"];
    observations: PlanPosthocObservation[];
    leaveEdges: PlanLeaveEdgesResult;
  };
};
const invalid = (): never => fail("attendance_plan_exception_review_invalid");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function list(v: unknown, maximum: number): unknown[] { if (!Array.isArray(v) || v.length > maximum) return invalid(); return v; }
function flags<T extends string>(v: unknown, choices: readonly T[], ordered = false): T[] {
  const values = list(v, choices.length).map(item => enumValue(item, choices));
  if (new Set(values).size !== values.length || ordered && !same(values, choices.filter(item => values.includes(item)))) invalid(); return values;
}
function reference(raw: unknown): PlanPosthocReference {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind === "session") {
    const r = exact(raw, ["kind", "startEventId", "lastEventId", "lastSequence", "effectOperationId", "effectRevision"]);
    const effectOperationId = optionalUuid(r.effectOperationId), effectRevision = r.effectRevision === null ? null : integer(r.effectRevision);
    if ((effectOperationId === null) !== (effectRevision === null)) invalid();
    return { kind, startEventId: uuid(r.startEventId), lastEventId: uuid(r.lastEventId), lastSequence: integer(r.lastSequence), effectOperationId, effectRevision };
  }
  const r = exact(raw, ["kind", "requestId", "rootRequestId", "approvalOperationId"]);
  if (kind !== "missing" || r.requestId === r.approvalOperationId) return invalid();
  return { kind, requestId: uuid(r.requestId), rootRequestId: uuid(r.rootRequestId), approvalOperationId: uuid(r.approvalOperationId) };
}
function approval(raw: unknown): PlanPosthocApproval | null {
  if (raw === null) return null; const a = exact(raw, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]);
  return { operationId: uuid(a.operationId), revision: integer(a.revision), sourceId: uuid(a.sourceId), sourceSha256: hash(a.sourceSha256), recordedAt: stamp(a.recordedAt) };
}
function savedOperation(raw: unknown): PlanPosthocOperation {
  const p = exact(raw, ["operationId", "revision", "action", "actorId", "employeeId", "employeeAuthUserId", "reason", "sources", "sourceFingerprint", "recordedAt"]);
  const action = enumValue(p.action, ["apply", "revoke"] as const), revision = integer(p.revision, 1, 100), sources = list(p.sources, 10).map(reference);
  if (new Set(sources.map(planPosthocReferenceKey)).size !== sources.length || action === "revoke" && (sources.length || revision === 1) || action === "apply" && revision === 100) invalid();
  const actorId = uuid(p.actorId), employeeAuthUserId = uuid(p.employeeAuthUserId); if (actorId === employeeAuthUserId) invalid();
  return { operationId: uuid(p.operationId), revision, action, actorId, employeeId: uuid(p.employeeId), employeeAuthUserId,
    reason: label(p.reason, 1000), sources, sourceFingerprint: hash(p.sourceFingerprint), recordedAt: stamp(p.recordedAt) };
}
function snapshot(raw: unknown): PlanPosthocCandidate {
  const c = exact(raw, ["reference", "original", "selected", "locationId", "timeZone", "available", "blockers", "claim"]);
  const ref = reference(c.reference), original = c.original === null ? null : parseExceptionEndpoints(c.original), selected = parseExceptionEndpoints(c.selected);
  const blockers = flags(c.blockers, PLAN_POSTHOC_CANDIDATE_BLOCKERS), available = bool(c.available);
  if (selected.startAt === null || (ref.kind === "missing") !== (original === null) || original !== null && original.startAt === null
    || available !== (blockers.length === 0) || available && (selected.endAt === null || micros(selected.endAt) <= micros(selected.startAt))) invalid();
  if (ref.kind === "session" && (ref.effectOperationId === null ? !same(original, selected) : original?.endAt == null || selected.endAt === null)) invalid();
  let claim = null;
  if (c.claim !== null) { const cl = exact(c.claim, ["slotId", "operationId", "revision"]); claim = { slotId: uuid(cl.slotId), operationId: uuid(cl.operationId), revision: integer(cl.revision, 1, 100) }; }
  return { reference: ref, original, selected, locationId: uuid(c.locationId), timeZone: label(c.timeZone, 100), available, blockers, claim };
}
function head(raw: unknown, expected?: Partial<PlanPosthocSavedScope>): PlanPosthocEvaluationSource["posthoc"] {
  const h = exact(raw, ["revision", "current", "selected", "approval"]), current = savedOperation(h.current), revision = integer(h.revision, 1, 100);
  const selected = list(h.selected, 10).map(snapshot), fixed = approval(h.approval);
  if (revision !== current.revision || expected?.employeeId !== undefined && current.employeeId !== uuid(expected.employeeId)
    || expected?.employeeAuthUserId !== undefined && current.employeeAuthUserId !== uuid(expected.employeeAuthUserId)
    || current.action === "revoke" && (selected.length || fixed !== null) || current.action === "apply" && !same(current.sources, selected.map(s => s.reference))
    || selected.length > 0 && fixed === null) invalid();
  for (const s of selected) {
    if (!s.available || s.blockers.length || s.selected.endAt === null || micros(s.selected.endAt) > micros(current.recordedAt)
      || s.original?.endAt != null && micros(s.original.endAt) > micros(current.recordedAt)
      || expected?.slotId !== undefined && s.claim !== null && s.claim.slotId !== uuid(expected.slotId)) invalid();
  }
  return { revision, current, selected, approval: fixed };
}
// Pure narrow reuse for a period's saved post-hoc context. No fake source or
//fake review envelope is constructed to obtain validation of this shared head.
export function parsePlanPosthocSavedHead(raw: unknown, expected: PlanPosthocSavedScope): PlanPosthocEvaluationSource["posthoc"] {
  try { safeTree(raw, 131072); uuid(expected.slotId); uuid(expected.employeeId); uuid(expected.employeeAuthUserId);
    return freeze(head(JSON.parse(JSON.stringify(raw)), expected)); } catch { return invalid(); }
}
function sessionRef(raw: unknown): PlanExceptionSessionReference {
  const p = exact(raw, ["startEventId", "lastEventId", "lastSequence", "effectOperationId"]);
  return { startEventId: uuid(p.startEventId), lastEventId: uuid(p.lastEventId), lastSequence: integer(p.lastSequence), effectOperationId: optionalUuid(p.effectOperationId) };
}
function requestRef(raw: unknown) { const p = exact(raw, ["requestId", "operationId", "revision"]); return { requestId: uuid(p.requestId), operationId: uuid(p.operationId), revision: integer(p.revision) }; }
const sameSnapshot = (a: PlanPosthocCandidate, b: PlanPosthocCandidate) => same(a.reference, b.reference) && same(a.original, b.original) && same(a.selected, b.selected) && a.locationId === b.locationId && a.timeZone === b.timeZone;

export function parsePlanPosthocEvidence(raw: unknown, expected: Partial<PlanPosthocSavedScope> = {}): PlanExceptionPosthocEvidence {
  try {
    safeTree(raw, 131072);
    const e = exact(JSON.parse(JSON.stringify(raw)), ["policy", "fingerprint", "observedAt", "eligible", "blockers", "candidate", "approval", "sessions", "contextRefs", "evaluation"]);
    if (e.policy !== "owner-confirmed-plan-edges-posthoc-v3") invalid();
    const observedAt = stamp(e.observedAt), eligible = bool(e.eligible), blockers = flags(e.blockers, PLAN_POSTHOC_EVALUATION_BLOCKERS, true), candidate = parseExceptionCandidate(e.candidate), fixed = approval(e.approval);
    const sessions = list(e.sessions, 10).map(sessionRef); if (new Set(sessions.map(s => s.startEventId)).size !== sessions.length) invalid();
    const v = exact(e.evaluation, ["state", "slot", "posthoc", "observations", "leaveEdges"]), s = exact(v.slot, ["slotId", "locationId", "timeZone", "startAt", "endAt"]);
    const slot = { slotId: uuid(s.slotId), locationId: uuid(s.locationId), timeZone: label(s.timeZone, 100), startAt: stamp(s.startAt, 3), endAt: stamp(s.endAt, 3) };
    if (micros(slot.endAt) <= micros(slot.startAt) || micros(slot.endAt) - micros(slot.startAt) > BigInt(86400000000)
      || Date.parse(slot.startAt) % 60000 || Date.parse(slot.endAt) % 60000 || expected.slotId !== undefined && slot.slotId !== uuid(expected.slotId)) invalid();
    const state = enumValue(v.state, ["required", "blocked", "not_applicable"] as const), posthoc = head(v.posthoc, { ...expected, slotId: slot.slotId });
    const current = posthoc.current!;
    if (micros(current.recordedAt) > micros(observedAt) || (current.action !== "apply") !== blockers.includes("posthoc_inactive")
      || posthoc.approval !== null && !same(posthoc.approval, fixed) || fixed !== null && micros(fixed.recordedAt) >= micros(slot.startAt)) invalid();
    for (const selected of posthoc.selected) if (selected.locationId !== slot.locationId || micros(selected.selected.startAt!) >= micros(slot.endAt) || micros(selected.selected.endAt!) <= micros(slot.startAt)) invalid();
    const observations: PlanPosthocObservation[] = list(v.observations, 10).map((rawItem, i) => {
      const o = exact(rawItem, ["reference", "current", "blockers"]), ref = reference(o.reference), now = o.current === null ? null : snapshot(o.current);
      const reasons = flags(o.blockers, PLAN_POSTHOC_OBSERVATION_BLOCKERS), saved = posthoc.selected[i];
      if (!saved || !same(ref, saved.reference) || now !== null && planPosthocReferenceKey(now.reference) !== planPosthocReferenceKey(ref)
        || now === null && !reasons.includes("source_unavailable") || now !== null && !sameSnapshot(saved, now) && !reasons.includes("source_changed")
        || reasons.some(reason => !blockers.includes(reason))) invalid();
      if (now !== null && (now.claim === null || now.claim.slotId !== slot.slotId || now.claim.operationId !== current.operationId || now.claim.revision !== posthoc.revision || now.blockers.includes("sealed"))) invalid();
      for (const endpoints of now ? [now.original, now.selected] : []) if (endpoints && (endpoints.startAt !== null && micros(endpoints.startAt) > micros(observedAt) || endpoints.endAt !== null && micros(endpoints.endAt) > micros(observedAt))) invalid();
      for (const b of now?.blockers ?? []) {
        const mapped = b === "already_associated" ? "source_changed" : b === "source_open" ? "session_open" : b === "source_zero_duration" ? "session_zero_duration" : b === "location_mismatch" ? "session_location_mismatch" : b;
        if (!blockers.includes(mapped)) invalid();
      }
      return { reference: ref, current: now, blockers: reasons };
    });
    if (observations.length !== posthoc.selected.length) invalid();
    const edgesRaw = exact(v.leaveEdges, ["version", "plan", "leave", "work", "approvedCoverage", "remainingRequired", "fullCoverage", "requiredStartAt", "requiredEndAt", "workLeaveOverlaps", "pending", "unknown", "state", "blockers"]);
    const leaveEdges = calculatePlanLeaveEdges({ plan: { startAt: slot.startAt, endAt: slot.endAt }, leave: edgesRaw.leave, work: edgesRaw.work });
    if (!same(leaveEdges, v.leaveEdges) || leaveEdges.blockers.some(b => !blockers.includes(b))) invalid();
    for (const item of leaveEdges.leave.items) if (micros(item.recordedAt) > micros(observedAt)) invalid();
    for (const work of leaveEdges.work) if (work.startAt !== null && micros(work.startAt) > micros(observedAt) || work.endAt !== null && micros(work.endAt) > micros(observedAt)) invalid();
    const c0 = e.contextRefs as Record<string, unknown>, hasWork = Object.hasOwn(c0, "workArrangements");
    const c = exact(c0, ["unassociated", "leave", "calendar", "missing", "pendingCorrections", ...(hasWork ? ["workArrangements"] : [])]);
    const contextRefs = { unassociated: parseExceptionSection(c.unassociated, sessionRef, p => p.startEventId), leave: parseExceptionSection(c.leave, requestRef, p => p.requestId),
      missing: parseExceptionSection(c.missing, requestRef, p => p.requestId), calendar: parseExceptionSection(c.calendar, rawItem => { const p = exact(rawItem, ["entryId", "operationId", "revision"]); return { entryId: uuid(p.entryId), operationId: uuid(p.operationId), revision: integer(p.revision) }; }, p => p.entryId),
      pendingCorrections: parseExceptionSection(c.pendingCorrections, rawItem => { const p = exact(rawItem, ["kind", "requestId", "operationId", "revision", "startEventId"]); return { kind: enumValue(p.kind, ["correction", "revision"] as const), requestId: uuid(p.requestId), operationId: uuid(p.operationId), revision: integer(p.revision), startEventId: uuid(p.startEventId) }; }, p => p.kind + p.requestId),
      ...(hasWork ? { workArrangements: parseExceptionSection(c.workArrangements, requestRef, p => p.requestId) } : {}) };
    if (contextRefs.workArrangements && (contextRefs.workArrangements.limited || !contextRefs.workArrangements.items.length)
      || contextRefs.leave.limited !== leaveEdges.leave.limited
      || !same(contextRefs.leave.items, leaveEdges.leave.items.map(item => ({ requestId: item.requestId, operationId: item.operationId, revision: item.revision })))
      || Object.values(contextRefs).some(part => part.limited) && !blockers.includes("context_unknown")) invalid();
    const admitted = sessions.map(ref => {
      const work = leaveEdges.work.find(w => w.kind === "session" && w.sourceId === ref.startEventId);
      if (!work || work.operationId !== ref.effectOperationId) return invalid(); return { startAt: work.startAt, endAt: work.endAt };
    });
    if (current.action === "apply") admitted.push(...posthoc.selected.map(item => item.selected));
    for (const o of observations) if (o.current !== null) {
      const r = o.current.reference, key = planPosthocReferenceKey(r), work = leaveEdges.work.find(w => w.kind + ":" + w.sourceId === key);
      if (!work || work.operationId !== (r.kind === "session" ? r.effectOperationId : r.approvalOperationId) || !same({ startAt: work.startAt, endAt: work.endAt }, o.current.selected)) invalid();
    }
    const starts = admitted.map(item => item.startAt).filter((x): x is string => x !== null).sort(compare), ends = admitted.map(item => item.endAt).filter((x): x is string => x !== null).sort(compare);
    const selected = { startAt: starts[0] ?? null, endAt: admitted.some(item => item.endAt === null) ? null : ends.at(-1) ?? null };
    if (!same(candidate.selected, selected) || eligible !== (blockers.length === 0) || eligible !== (state !== "blocked")
      || state !== (blockers.length ? "blocked" : leaveEdges.state === "not_applicable" ? "not_applicable" : "required")) invalid();
    if (state === "required" && (fixed === null || candidate.selected.startAt === null || candidate.selected.endAt === null || leaveEdges.requiredStartAt === null || leaveEdges.requiredEndAt === null)) invalid();
    if (state === "not_applicable" && (leaveEdges.fullCoverage !== true || leaveEdges.work.length || sessions.length || posthoc.selected.length
      || candidate.original.startAt !== null || candidate.original.endAt !== null)) invalid();
    for (const kind of ["late", "early"] as const) {
      const field = candidate[kind]; if ((field.state === "blocked") !== (state !== "required")) invalid();
      if (field.state === "triggered" || field.state === "not_triggered") {
        const delta = kind === "late" ? micros(candidate.selected.startAt!) - micros(leaveEdges.requiredStartAt!) : micros(leaveEdges.requiredEndAt!) - micros(candidate.selected.endAt!);
        if (field.rawDeltaUs !== delta.toString()) invalid();
      }
    }
    return freeze({ policy: "owner-confirmed-plan-edges-posthoc-v3", fingerprint: hash(e.fingerprint), observedAt, eligible, blockers, candidate,
      approval: fixed, sessions, contextRefs, evaluation: { state, slot, posthoc, observations, leaveEdges } });
  } catch { return invalid(); }
}
