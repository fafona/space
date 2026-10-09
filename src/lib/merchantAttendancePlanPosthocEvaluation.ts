// Browser-safe exact facts validation and independent read-only geometry. SQL
// proves authorization/current heads; this code never infers that from a name,
// current worker binding, or a historical status string alone.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, uuid, site, hash, integer, label, stamp, micros, bool, enumValue, optionalUuid, same, freeze } from "./merchantAttendancePlanExceptionValidation";
import { parseExceptionWorker, parseExceptionSlot, parseExceptionEndpoints, parsePlanExceptionApproval, parsePlanExceptionEvidenceSource } from "./merchantAttendancePlanExceptionSource";
import { calculatePlanLeaveEdges, type PlanLeaveWork, type PlanLeaveResolvedContext } from "./merchantAttendancePlanLeaveEdges";
import { PLAN_POSTHOC_CANDIDATE_BLOCKERS, type PlanPosthocCandidate, type PlanPosthocReference, type PlanPosthocOperation, type PlanPosthocApproval } from "./merchantAttendancePlanPosthocContract";
import { planPosthocReferenceKey } from "./merchantAttendancePlanPosthoc";
import type { PlanExceptionCandidate, PlanExceptionCandidateField, PlanExceptionEndpoints } from "./merchantAttendancePlanExceptionSourceContract";
import { PLAN_POSTHOC_RESOLUTION_BLOCKERS, PLAN_POSTHOC_OBSERVATION_BLOCKERS, PLAN_POSTHOC_EVALUATION_BLOCKERS,
  type PlanPosthocEvaluationQuery, type PlanPosthocEvaluationSource, type PlanPosthocEvaluationFacts, type PlanPosthocEvaluationResult,
  type PlanPosthocEvaluationBlocker, type PlanPosthocObservation } from "./merchantAttendancePlanPosthocEvaluationContract";
export type { PlanPosthocEvaluationQuery, PlanPosthocEvaluationSource, PlanPosthocEvaluationResult } from "./merchantAttendancePlanPosthocEvaluationContract";

export const PLAN_POSTHOC_EVALUATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404,
  attendance_worker_not_found: 404, attendance_worker_changed: 409, attendance_settings_required: 409,
  attendance_unavailable: 503, attendance_plan_posthoc_adoption_invalid: 503,
  attendance_plan_posthoc_adoption_changed: 409, attendance_plan_posthoc_adoption_too_large: 422,
  attendance_plan_posthoc_evaluation_invalid: 503, attendance_plan_posthoc_evaluation_too_large: 422,
  attendance_period_source_identity_changed: 409, attendance_period_source_identity_unproven: 409,
  attendance_plan_exception_source_invalid: 503, attendance_plan_exception_source_too_large: 422,
});
const invalid = (): never => { throw new MerchantAttendanceError("attendance_plan_posthoc_evaluation_invalid"); };
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const normalized = (v: string) => v.length === 24 ? v.slice(0, -1) + "000Z" : v;
function array(raw: unknown, max: number): unknown[] { if (!Array.isArray(raw) || raw.length > max) return invalid(); return raw; }
function flags<T extends string>(raw: unknown, choices: readonly T[]): T[] {
  const values = array(raw, choices.length).map(v => enumValue(v, choices));
  if (new Set(values).size !== values.length) invalid(); return values;
}
function ref(raw: unknown): PlanPosthocReference {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind === "session") {
    const r = exact(raw, ["kind", "startEventId", "lastEventId", "lastSequence", "effectOperationId", "effectRevision"]);
    const effectOperationId = optionalUuid(r.effectOperationId), effectRevision = r.effectRevision === null ? null : integer(r.effectRevision);
    if ((effectOperationId === null) !== (effectRevision === null)) invalid();
    return { kind, startEventId: uuid(r.startEventId), lastEventId: uuid(r.lastEventId), lastSequence: integer(r.lastSequence), effectOperationId, effectRevision };
  }
  const r = exact(raw, ["kind", "requestId", "rootRequestId", "approvalOperationId"]);
  if (kind !== "missing" || r.requestId === r.approvalOperationId) invalid();
  return { kind: "missing", requestId: uuid(r.requestId), rootRequestId: uuid(r.rootRequestId), approvalOperationId: uuid(r.approvalOperationId) };
}
function compactApproval(raw: unknown): PlanPosthocApproval | null {
  if (raw === null) return null; const a = exact(raw, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]);
  return { operationId: uuid(a.operationId), revision: integer(a.revision), sourceId: uuid(a.sourceId), sourceSha256: hash(a.sourceSha256), recordedAt: stamp(a.recordedAt) };
}
function operation(raw: unknown): PlanPosthocOperation | null {
  if (raw === null) return null;
  const p = exact(raw, ["operationId", "revision", "action", "actorId", "employeeId", "employeeAuthUserId", "reason", "sources", "sourceFingerprint", "recordedAt"]);
  const action = enumValue(p.action, ["apply", "revoke"] as const), revision = integer(p.revision, 1, 100), sources = array(p.sources, 10).map(ref);
  if (new Set(sources.map(planPosthocReferenceKey)).size !== sources.length || action === "revoke" && (sources.length || revision === 1) || action === "apply" && revision === 100) invalid();
  const actorId = uuid(p.actorId), employeeAuthUserId = uuid(p.employeeAuthUserId); if (actorId === employeeAuthUserId) invalid();
  return { operationId: uuid(p.operationId), revision, action, actorId, employeeId: uuid(p.employeeId), employeeAuthUserId,
    reason: label(p.reason, 1000), sources, sourceFingerprint: hash(p.sourceFingerprint), recordedAt: stamp(p.recordedAt) };
}
function candidate(raw: unknown, observed: string): PlanPosthocCandidate {
  const c = exact(raw, ["reference", "original", "selected", "locationId", "timeZone", "available", "blockers", "claim"]);
  const reference = ref(c.reference), original = c.original === null ? null : parseExceptionEndpoints(c.original), selected = parseExceptionEndpoints(c.selected);
  const blockers = flags(c.blockers, PLAN_POSTHOC_CANDIDATE_BLOCKERS), available = bool(c.available);
  if (selected.startAt === null || (reference.kind === "missing") !== (original === null) || original !== null && original.startAt === null
    || available !== (blockers.length === 0) || available && (selected.endAt === null || micros(selected.endAt) <= micros(selected.startAt))) invalid();
  if (reference.kind === "session" && (reference.effectOperationId === null ? !same(original, selected) : original?.endAt == null || selected.endAt === null)) invalid();
  for (const e of [original, selected]) if (e && (e.startAt !== null && micros(e.startAt) > micros(observed) || e.endAt !== null && micros(e.endAt) > micros(observed))) invalid();
  let claim = null;
  if (c.claim !== null) { const cl = exact(c.claim, ["slotId", "operationId", "revision"]); claim = { slotId: uuid(cl.slotId), operationId: uuid(cl.operationId), revision: integer(cl.revision, 1, 100) }; }
  return { reference, original, selected, locationId: uuid(c.locationId), timeZone: label(c.timeZone, 100), available, blockers, claim };
}
const compact = (a: NonNullable<PlanPosthocEvaluationSource["approval"]>): PlanPosthocApproval => ({ operationId: a.operationId, revision: a.revision, sourceId: a.sourceId, sourceSha256: a.sourceSha256, recordedAt: a.recordedAt });
const sameSaved = (a: PlanPosthocCandidate, b: PlanPosthocCandidate) => same(a.reference, b.reference) && same(a.original, b.original) && same(a.selected, b.selected) && a.locationId === b.locationId && a.timeZone === b.timeZone;

export function parsePlanPosthocEvaluationQuery(raw: unknown): PlanPosthocEvaluationQuery {
  try { safeTree(raw, 4096); const q = exact(raw, ["siteId", "workerId", "slotId"]); return { siteId: site(q.siteId), workerId: uuid(q.workerId), slotId: uuid(q.slotId) }; }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
function source(raw: unknown, q: PlanPosthocEvaluationQuery, readAt: string): PlanPosthocEvaluationSource {
  safeTree(raw, 1048576);
  const s = exact(raw, ["protocol", "basis", "posthoc", "observations", "approval", "leave", "resolutionBlockers"]);
  if (s.protocol !== "posthoc-evaluation-evidence-v1") invalid();
  const basis = parsePlanExceptionEvidenceSource(s.basis, q), h = exact(s.posthoc, ["revision", "current", "selected", "approval"]);
  const revision = integer(h.revision, 0, 100), current = operation(h.current), selected = array(h.selected, 10).map(c => candidate(c, readAt)), savedApproval = compactApproval(h.approval);
  if (current === null ? revision !== 0 : revision !== current.revision || current.employeeId !== basis.worker.employeeId || current.employeeAuthUserId !== basis.worker.employeeAuthUserId || micros(current.recordedAt) > micros(readAt)) invalid();
  if (current?.action !== "apply" && (selected.length || savedApproval !== null) || current?.action === "apply" && !same(current.sources, selected.map(c => c.reference))) invalid();
  for (const c of selected) if (!c.available || c.blockers.length || c.locationId !== basis.slot.locationId || micros(c.selected.startAt!) >= micros(basis.slot.endAt) || micros(c.selected.endAt!) <= micros(basis.slot.startAt)
    || current && (micros(c.selected.endAt!) > micros(current.recordedAt) || c.original?.endAt != null && micros(c.original.endAt) > micros(current.recordedAt))
    || c.claim !== null && c.claim.slotId !== q.slotId) invalid();
  if (selected.length && savedApproval === null || savedApproval && micros(savedApproval.recordedAt) >= micros(basis.slot.startAt)) invalid();
  const resolutionBlockers = flags(s.resolutionBlockers, PLAN_POSTHOC_RESOLUTION_BLOCKERS);
  if (resolutionBlockers.includes("posthoc_inactive") !== (current?.action !== "apply")) invalid();
  const observations: PlanPosthocObservation[] = array(s.observations, 10).map((raw, i) => {
    const o = exact(raw, ["reference", "current", "blockers"]), reference = ref(o.reference), now = o.current === null ? null : candidate(o.current, readAt), blockers = flags(o.blockers, PLAN_POSTHOC_OBSERVATION_BLOCKERS);
    if (!selected[i] || !same(reference, selected[i].reference) || now !== null && planPosthocReferenceKey(now.reference) !== planPosthocReferenceKey(reference)) invalid();
    if (now === null && !blockers.includes("source_unavailable") || now !== null && !sameSaved(selected[i], now) && !blockers.includes("source_changed")) invalid();
    if (now !== null && (now.claim === null || now.claim.slotId !== q.slotId || now.claim.operationId !== current?.operationId || now.claim.revision !== revision)) invalid();
    if (now?.reference.kind === "session") {
      const r = now.reference, fact = [...basis.sessions, ...basis.context.unassociated.items].find(v => v.startEventId === r.startEventId);
      if (fact && (fact.lastEventId !== r.lastEventId || fact.lastSequence !== r.lastSequence || (fact.effect?.operationId ?? null) !== r.effectOperationId
        || (fact.effect?.revision ?? null) !== r.effectRevision || !same(fact.original, now.original) || !same(fact.selected, now.selected))) invalid();
    } else if (now?.reference.kind === "missing") {
      const r = now.reference, fact = basis.context.missing.items.find(v => v.rootRequestId === r.rootRequestId && v.isCurrentApproved);
      if (fact && (fact.requestId !== r.requestId || fact.operationId !== r.approvalOperationId || !same({ startAt: fact.startAt, endAt: fact.endAt }, now.selected))) invalid();
    }
    for (const b of blockers) if (!resolutionBlockers.includes(b)) invalid();
    return { reference, current: now, blockers };
  });
  if (observations.length !== selected.length) invalid();
  const approval = parsePlanExceptionApproval(s.approval, { siteId: q.siteId, worker: basis.worker, slot: basis.slot });
  if (savedApproval !== null && (approval === null || !same(savedApproval, compact(approval)))) invalid();
  const leaveRaw = exact(s.leave, ["limited", "resolved", "items"]);
  const checkedLeave = calculatePlanLeaveEdges({ plan: { startAt: basis.slot.startAt, endAt: basis.slot.endAt }, leave: leaveRaw, work: [] }).leave;
  if (checkedLeave.limited && checkedLeave.items.length) invalid();
  const leave = { limited: bool(leaveRaw.limited), resolved: bool(leaveRaw.resolved), items: leaveRaw.items } as PlanLeaveResolvedContext;
  if (basis.context.leave.limited !== leave.limited) invalid();
  if (!leave.limited && (leave.items.length !== basis.context.leave.items.length || leave.items.some((item, i) => {
    const old = basis.context.leave.items[i]; if (!old || old.requestId !== item.requestId) return true;
    const { current: _current, ...fields } = item; void _current;
    return !same({ ...fields, startAt: normalized(fields.startAt), endAt: normalized(fields.endAt) }, { ...old, startAt: normalized(old.startAt), endAt: normalized(old.endAt) });
  }))) invalid();
  if ((leave.limited || !leave.resolved || Object.values(basis.context).some(c => c?.limited)) && !resolutionBlockers.includes("context_unknown")) invalid();
  for (const item of leave.items) if (micros(item.recordedAt) > micros(readAt)) invalid();
  const phase = micros(readAt) < micros(basis.slot.startAt) ? "future" : micros(readAt) < micros(basis.slot.endAt) ? "ongoing" : "ended";
  if (basis.phase !== phase) invalid();
  for (const item of [...basis.sessions, ...basis.context.unassociated.items]) {
    if (micros(item.original.startAt!) > micros(readAt) || item.original.endAt !== null && micros(item.original.endAt) > micros(readAt)
      || item.selected.endAt !== null && micros(item.selected.endAt) > micros(readAt) || item.effect && micros(item.effect.recordedAt) > micros(readAt)) invalid();
  }
  for (const section of [basis.context.missing, basis.context.calendar, basis.context.pendingCorrections]) for (const item of section.items) if (micros(item.recordedAt) > micros(readAt)) invalid();
  for (const item of basis.context.workArrangements?.items ?? []) for (const entry of item.history) if (micros(entry.recordedAt) > micros(readAt)) invalid();
  return { protocol: "posthoc-evaluation-evidence-v1", basis, posthoc: { revision, current, selected, approval: savedApproval }, observations, approval, leave, resolutionBlockers };
}

function derive(facts: PlanPosthocEvaluationFacts): PlanPosthocEvaluationResult {
  const { source: s } = facts, { basis, posthoc } = s, { slot, worker, context } = basis;
  const active = posthoc.current?.action === "apply", found = new Set<PlanPosthocEvaluationBlocker>(s.resolutionBlockers);
  const add = (condition: unknown, code: PlanPosthocEvaluationBlocker) => { if (condition) found.add(code); };
  add(basis.phase !== "ended", "plan_not_ended"); add(slot.cancelled, "slot_cancelled"); add(!slot.hasPublicationEvidence, "publication_missing");
  add(!worker.active || !worker.employeeActive, "worker_inactive"); add(Object.values(context).some(c => c?.limited), "context_unknown");
  add(context.pendingCorrections.items.length, "pending_correction"); add(context.calendar.items.some(c => c.status === "created"), "calendar_entry");
  add(context.leave.items.some(c => c.status === "submitted"), "leave_pending");
  add(context.workArrangements?.items.some(c => c.status === "submitted"), "work_arrangement_pending");
  const adoptedKeys = new Set(active ? posthoc.selected.map(c => planPosthocReferenceKey(c.reference)) : []);
  add(context.unassociated.items.some(c => !adoptedKeys.has("session:" + c.startEventId)), "unassociated_session");
  add(context.missing.items.some(c => c.status === "submitted" || c.isCurrentApproved && !adoptedKeys.has("missing:" + c.rootRequestId)), "missing_request");
  const fullCompact = s.approval ? compact(s.approval) : null;
  for (const session of basis.sessions) {
    add(session.relation.status !== "linked", "association_unverified"); add(session.adoption === null, "adoption_missing");
    add(session.adoption !== null && session.adoption.status !== "adopted", "adoption_unverified");
    add(session.adoption?.status === "adopted" && !same(session.adoption.approval, fullCompact), "approval_mismatch");
  }
  for (const o of s.observations) {
    for (const b of o.blockers) found.add(b);
    for (const b of o.current?.blockers ?? []) {
      const mapped = b === "already_associated" ? "source_changed" : b === "source_open" ? "session_open" : b === "source_zero_duration" ? "session_zero_duration"
        : b === "location_mismatch" ? "session_location_mismatch" : b;
      found.add(mapped);
    }
  }
  const admitted = [...basis.sessions.map(v => ({ original: v.original, selected: v.selected })), ...(active ? posthoc.selected.map(v => ({ original: v.original, selected: v.selected })) : [])];
  for (const item of admitted) {
    const a = item.selected.startAt, b = item.selected.endAt;
    add(a === null || b === null, "session_open"); add(a !== null && b !== null && micros(a) === micros(b), "session_zero_duration");
    add(a !== null && b !== null && micros(b) > micros(a) && (micros(a) >= micros(slot.endAt) || micros(b) <= micros(slot.startAt)), "session_outside_plan");
  }
  let prior: bigint | null = null;
  for (const item of [...admitted].sort((a, b) => cmp(a.selected.startAt ?? "", b.selected.startAt ?? ""))) {
    if (item.selected.startAt !== null) add(prior !== null && micros(item.selected.startAt) < prior, "session_overlap");
    if (item.selected.endAt !== null) { const e = micros(item.selected.endAt); if (prior === null || e > prior) prior = e; }
  }
  // Include every current actual-work span, including unselected facts, when
  // checking work/leave conflicts. Selection cannot hide contradictory work.
  const work: PlanLeaveWork[] = [...basis.sessions, ...context.unassociated.items].map(c => ({ kind: "session", sourceId: c.startEventId, operationId: c.effect?.operationId ?? null, ...c.selected }));
  for (const c of context.missing.items.filter(c => c.isCurrentApproved)) work.push({ kind: "missing", sourceId: c.rootRequestId, operationId: c.operationId, startAt: c.startAt, endAt: c.endAt });
  for (const o of s.observations) if (o.current !== null) {
    const c = o.current, key = planPosthocReferenceKey(c.reference);
    if (!work.some(w => w.kind + ":" + w.sourceId === key)) work.push({ kind: c.reference.kind, sourceId: c.reference.kind === "session" ? c.reference.startEventId : c.reference.rootRequestId,
      operationId: c.reference.kind === "session" ? c.reference.effectOperationId : c.reference.approvalOperationId, ...c.selected });
  }
  const leaveEdges = calculatePlanLeaveEdges({ plan: { startAt: slot.startAt, endAt: slot.endAt }, leave: s.leave, work });
  for (const b of leaveEdges.blockers) found.add(b);
  add(leaveEdges.state !== "not_applicable" && s.approval === null, "approval_missing");
  const blockers = PLAN_POSTHOC_EVALUATION_BLOCKERS.filter(b => found.has(b));
  const state = !active ? "not_active" : blockers.length ? "blocked" : leaveEdges.state === "not_applicable" ? "not_applicable" : "required";
  const eligible = state === "required" || state === "not_applicable";
  const endpoints = (key: "original" | "selected"): PlanExceptionEndpoints => {
    const values = admitted.map(c => c[key]).filter((e): e is PlanExceptionEndpoints => e !== null);
    const starts = values.map(c => c.startAt).filter((v): v is string => v !== null).sort(cmp), ends = values.map(c => c.endAt).filter((v): v is string => v !== null).sort(cmp);
    return { startAt: starts[0] ?? null, endAt: values.some(c => c.endAt === null) ? null : ends.at(-1) ?? null };
  };
  const original = endpoints("original"), selected = endpoints("selected");
  const field = (kind: "late" | "early"): PlanExceptionCandidateField => {
    const rule = s.approval?.source.fields[kind === "late" ? "lateGraceMinutes" : "earlyGraceMinutes"];
    if (state !== "required") return { state: "blocked", minutes: null, rawDeltaUs: null, excessUs: null };
    if (!rule) return { state: "unconfigured", minutes: null, rawDeltaUs: null, excessUs: null };
    if (rule.state !== "value") return { state: rule.state, minutes: null, rawDeltaUs: null, excessUs: null };
    if (rule.minutes === null || selected.startAt === null || selected.endAt === null || leaveEdges.requiredStartAt === null || leaveEdges.requiredEndAt === null) return invalid();
    const delta = kind === "late" ? micros(selected.startAt) - micros(leaveEdges.requiredStartAt) : micros(leaveEdges.requiredEndAt) - micros(selected.endAt);
    const excess = delta - BigInt(rule.minutes) * BigInt(60000000);
    return { state: excess > BigInt(0) ? "triggered" : "not_triggered", minutes: rule.minutes, rawDeltaUs: delta.toString(), excessUs: (excess > BigInt(0) ? excess : BigInt(0)).toString() };
  };
  const candidate: PlanExceptionCandidate = { late: field("late"), early: field("early"), original, selected };
  return { ...facts, state, eligible, blockers, leaveEdges, candidate };
}

export function parsePlanPosthocEvaluation(raw: unknown, query: PlanPosthocEvaluationQuery, expectedActorId: string): PlanPosthocEvaluationResult {
  try {
    safeTree(raw, 2097152); const q = parsePlanPosthocEvaluationQuery(query), actorId = uuid(expectedActorId), v = exact(JSON.parse(JSON.stringify(raw)), ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "fingerprint"]);
    if (v.protocol !== "plan-posthoc-evaluation-v1" || v.siteId !== q.siteId || v.actorId !== actorId) invalid();
    const readAt = stamp(v.readAt), worker = parseExceptionWorker(v.worker), slot = parseExceptionSlot(v.slot), evidence = source(v.source, q, readAt);
    if (!same(worker, evidence.basis.worker) || !same(slot, evidence.basis.slot)) invalid();
    const result = derive({ protocol: "plan-posthoc-evaluation-v1", siteId: q.siteId, actorId, worker, slot, readAt, source: evidence, fingerprint: hash(v.fingerprint) });
    safeTree(result, 3145728); return freeze(result);
  } catch { return invalid(); }
}
