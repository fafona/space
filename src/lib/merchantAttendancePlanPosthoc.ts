import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, uuid, site, hash, integer, label, stamp, micros, bool, enumValue, optionalUuid, same, freeze } from "./merchantAttendancePlanExceptionValidation";
import { parseExceptionWorker, parseExceptionSlot, parsePlanExceptionEvidenceSource } from "./merchantAttendancePlanExceptionSource";
import { PLAN_POSTHOC_BLOCKERS, PLAN_POSTHOC_CANDIDATE_BLOCKERS,
  type PlanPosthocQuery, type PlanPosthocCommand, type PlanPosthocReference, type PlanPosthocOperation,
  type PlanPosthocApproval, type PlanPosthocCandidate, type PlanPosthocPreview, type PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";

export const PLAN_POSTHOC_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404,
  attendance_worker_not_found: 404, attendance_settings_required: 409, attendance_unavailable: 503,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_period_sealed: 409,
  attendance_platform_paused: 403, attendance_worker_changed: 409, attendance_module_disabled: 403,
  attendance_plan_posthoc_adoption_disabled: 403, attendance_plan_posthoc_adoption_invalid: 503,
  attendance_plan_posthoc_adoption_too_large: 422, attendance_plan_posthoc_adoption_changed: 409,
  attendance_plan_posthoc_adoption_blocked: 409, attendance_plan_posthoc_adoption_not_found: 404,
  attendance_plan_posthoc_adoption_limit: 422,
});
const fail = (code = "attendance_plan_posthoc_adoption_invalid"): never => { throw new MerchantAttendanceError(code); };
export const planPosthocReferenceKey = (r: PlanPosthocReference): string => r.kind + ":" + (r.kind === "session" ? r.startEventId : r.rootRequestId);
function reference(raw: unknown): PlanPosthocReference {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind === "session") {
    const r = exact(raw, ["kind", "startEventId", "lastEventId", "lastSequence", "effectOperationId", "effectRevision"]);
    const effectOperationId = optionalUuid(r.effectOperationId), effectRevision = r.effectRevision === null ? null : integer(r.effectRevision);
    if ((effectOperationId === null) !== (effectRevision === null)) fail();
    return { kind, startEventId: uuid(r.startEventId), lastEventId: uuid(r.lastEventId), lastSequence: integer(r.lastSequence), effectOperationId, effectRevision };
  }
  const r = exact(raw, ["kind", "requestId", "rootRequestId", "approvalOperationId"]);
  if (kind !== "missing") fail();
  const requestId = uuid(r.requestId), approvalOperationId = uuid(r.approvalOperationId);
  if (requestId === approvalOperationId) fail();
  return { kind: "missing", requestId, rootRequestId: uuid(r.rootRequestId), approvalOperationId };
}
function references(raw: unknown): PlanPosthocReference[] {
  if (!Array.isArray(raw) || raw.length > 10) return fail();
  const seen = new Set<string>();
  return raw.map(v => { const r = reference(v), key = planPosthocReferenceKey(r); if (seen.has(key)) fail(); seen.add(key); return r; });
}
function blockers<T extends string>(raw: unknown, choices: readonly T[]): T[] {
  if (!Array.isArray(raw) || raw.length > choices.length || new Set(raw).size !== raw.length) return fail();
  return raw.map(v => enumValue(v, choices));
}
function approval(raw: unknown): PlanPosthocApproval | null {
  if (raw === null) return null; const a = exact(raw, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]);
  return { operationId: uuid(a.operationId), revision: integer(a.revision), sourceId: uuid(a.sourceId), sourceSha256: hash(a.sourceSha256), recordedAt: stamp(a.recordedAt) };
}
function endpoints(raw: unknown) {
  const e = exact(raw, ["startAt", "endAt"]), startAt = e.startAt === null ? null : stamp(e.startAt), endAt = e.endAt === null ? null : stamp(e.endAt);
  if (startAt === null || endAt !== null && micros(endAt) < micros(startAt)) fail(); return { startAt, endAt };
}
function candidate(raw: unknown, q: PlanPosthocQuery): PlanPosthocCandidate {
  const c = exact(raw, ["reference", "original", "selected", "locationId", "timeZone", "available", "blockers", "claim"]);
  const ref = reference(c.reference), original = c.original === null ? null : endpoints(c.original), selected = endpoints(c.selected);
  const result: PlanPosthocCandidate = { reference: ref, original, selected, locationId: uuid(c.locationId), timeZone: label(c.timeZone, 100), available: bool(c.available), blockers: blockers(c.blockers, PLAN_POSTHOC_CANDIDATE_BLOCKERS), claim: null };
  if ((ref.kind === "missing") !== (original === null) || result.available !== (result.blockers.length === 0)) fail();
  if (c.claim !== null) { const cl = exact(c.claim, ["slotId", "operationId", "revision"]);
    result.claim = { slotId: uuid(cl.slotId), operationId: uuid(cl.operationId), revision: integer(cl.revision, 1, 100) }; }
  if (result.available && (selected.endAt === null || micros(selected.endAt) <= micros(selected.startAt!))) fail();
  if (result.available && result.claim !== null && result.claim.slotId !== q.slotId) fail();
  if (ref.kind === "session" && ref.effectOperationId === null && !same(original, selected)) fail();
  if (ref.kind === "session" && ref.effectOperationId !== null && (original?.endAt == null || selected.endAt === null)) fail();
  return result;
}
function operation(raw: unknown): PlanPosthocOperation {
  const o = exact(raw, ["operationId", "revision", "action", "actorId", "employeeId", "employeeAuthUserId", "reason", "sources", "sourceFingerprint", "recordedAt"]);
  const action = enumValue(o.action, ["apply", "revoke"] as const), sources = references(o.sources), revision = integer(o.revision, 1, 100);
  if (action === "revoke" && (sources.length > 0 || revision === 1)) fail();
  if (action === "apply" && revision === 100 || o.actorId === o.employeeAuthUserId) fail();
  return { operationId: uuid(o.operationId), revision, action, actorId: uuid(o.actorId), employeeId: uuid(o.employeeId), employeeAuthUserId: uuid(o.employeeAuthUserId), reason: label(o.reason, 1000), sources, sourceFingerprint: hash(o.sourceFingerprint), recordedAt: stamp(o.recordedAt) };
}
export function parsePlanPosthocQuery(raw: unknown): PlanPosthocQuery {
  try { safeTree(raw, 4096); const q = exact(raw, ["siteId", "workerId", "slotId", "mode", "operationId"]);
    const mode = enumValue(q.mode, ["detail", "recover"] as const), operationId = optionalUuid(q.operationId);
    if ((mode === "recover") !== (operationId !== null)) fail();
    return { siteId: site(q.siteId), workerId: uuid(q.workerId), slotId: uuid(q.slotId), mode, operationId };
  } catch { return fail("attendance_invalid_request"); }
}
export function parsePlanPosthocCommand(raw: unknown): PlanPosthocCommand {
  try { safeTree(raw, 16384); const action = (raw as { action?: unknown } | null)?.action;
    const c = exact(raw, ["action", "operationId", "expectedRevision", "expectedFingerprint", "employeeId", "employeeAuthUserId", "reason", ...(action === "apply" ? ["sources"] : [])]);
    enumValue(action, ["apply", "revoke"]); const expectedRevision = integer(c.expectedRevision, 0, 100);
    if (action === "revoke" && expectedRevision === 0) fail();
    const base = { operationId: uuid(c.operationId), expectedRevision, expectedFingerprint: hash(c.expectedFingerprint), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), reason: label(c.reason, 1000) };
    return action === "apply" ? { ...base, action, sources: references(c.sources) } : { ...base, action: "revoke" };
  } catch { return fail("attendance_invalid_request"); }
}
function preview(raw: unknown, q: PlanPosthocQuery, result: Pick<PlanPosthocResult, "worker" | "slot" | "revision" | "current" | "readAt">): PlanPosthocPreview {
  const p = exact(raw, ["fingerprint", "eligible", "blockers", "candidates", "approval", "source"]);
  if (!Array.isArray(p.candidates) || p.candidates.length > 100) return fail();
  const candidates = p.candidates.map(v => candidate(v, q)), keys = candidates.map(c => planPosthocReferenceKey(c.reference));
  if (new Set(keys).size !== keys.length) fail();
  const values = blockers(p.blockers, PLAN_POSTHOC_BLOCKERS), eligible = bool(p.eligible), fixed = approval(p.approval);
  if (eligible !== (values.length === 0)) fail();
  const s = exact(p.source, ["protocol", "basis", "caseId", "caseRevision", "revision", "currentOperationId", "candidates", "approval", "blockers"]);
  const basis = parsePlanExceptionEvidenceSource(s.basis, { siteId: q.siteId, workerId: q.workerId, slotId: q.slotId });
  const caseId = optionalUuid(s.caseId), caseRevision = integer(s.caseRevision, 0), revision = integer(s.revision, 0, 100), currentOperationId = optionalUuid(s.currentOperationId);
  if (s.protocol !== "posthoc-adoption-preview-v1" || (caseId === null) !== (caseRevision === 0)
    || revision !== result.revision || currentOperationId !== (result.current?.operationId ?? null)
    || !same(basis.worker, result.worker) || !same(basis.slot, result.slot)
    || !same(s.candidates, candidates) || !same(s.approval, fixed) || !same(s.blockers, values)) fail();
  const phase = micros(result.readAt) < micros(result.slot.startAt) ? "future" : micros(result.readAt) < micros(result.slot.endAt) ? "ongoing" : "ended";
  if (basis.phase !== phase || (caseId === null) !== values.includes("case_missing")) fail();
  if (fixed && micros(fixed.recordedAt) >= micros(result.slot.startAt)) fail();
  if (eligible && (phase !== "ended" || result.slot.cancelled || !result.slot.hasPublicationEvidence || !result.worker.active || !result.worker.employeeActive)) fail();
  const { context } = basis;
  const requireGlobal = (condition: boolean, code: typeof PLAN_POSTHOC_BLOCKERS[number]) => { if (condition && !values.includes(code)) fail(); };
  requireGlobal(phase !== "ended", "plan_not_ended"); requireGlobal(result.slot.cancelled, "slot_cancelled");
  requireGlobal(!result.slot.hasPublicationEvidence, "publication_missing"); requireGlobal(!result.worker.active || !result.worker.employeeActive, "worker_inactive");
  requireGlobal(Object.values(context).some(section => section?.limited), "context_unknown");
  requireGlobal(context.pendingCorrections.items.length > 0, "pending_correction");
  requireGlobal(context.missing.items.some(item => item.status === "submitted"), "pending_missing");
  requireGlobal(context.leave.items.some(item => item.status === "submitted"), "pending_leave");
  requireGlobal(context.workArrangements?.items.some(item => item.status === "submitted") ?? false, "pending_work_arrangement");
  requireGlobal(context.calendar.items.some(item => item.status === "created"), "calendar_entry");
  const sessions = [...basis.sessions, ...context.unassociated.items], missing = context.missing.items.filter(item => item.status === "approved" && item.isCurrentApproved);
  if (candidates.length !== sessions.length + missing.length) fail();
  for (const c of candidates) {
    const requireCandidate = (condition: boolean, code: typeof PLAN_POSTHOC_CANDIDATE_BLOCKERS[number]) => { if (condition && !c.blockers.includes(code)) fail(); };
    if (c.reference.kind === "session") {
      const ref = c.reference, b = sessions.find(item => item.startEventId === ref.startEventId);
      if (!b) return fail();
      if (b.lastEventId !== ref.lastEventId || b.lastSequence !== ref.lastSequence
        || (b.effect?.operationId ?? null) !== ref.effectOperationId || (b.effect?.revision ?? null) !== ref.effectRevision
        || !same(b.original, c.original) || !same(b.selected, c.selected)) fail();
      if (b.effect && micros(b.effect.recordedAt) > micros(result.readAt)) fail();
      const linked = "relation" in b ? b.relation.selection?.slotId ?? null : b.relationSlotId;
      requireCandidate(linked === q.slotId, "already_associated"); requireCandidate(linked !== null && linked !== q.slotId, "associated_elsewhere");
      requireCandidate(context.pendingCorrections.items.some(item => item.startEventId === ref.startEventId), "pending_correction");
    } else {
      const ref = c.reference, b = missing.find(item => item.requestId === ref.requestId);
      if (!b || b.rootRequestId !== ref.rootRequestId || b.operationId !== ref.approvalOperationId || !same(c.selected, { startAt: b.startAt, endAt: b.endAt })) fail();
    }
    requireCandidate(c.selected.endAt === null, "source_open");
    requireCandidate(c.selected.endAt !== null && micros(c.selected.endAt) === micros(c.selected.startAt!), "source_zero_duration");
    requireCandidate(c.selected.endAt !== null && micros(c.selected.endAt) > micros(c.selected.startAt!) && (micros(c.selected.startAt!) >= micros(result.slot.endAt) || micros(c.selected.endAt) <= micros(result.slot.startAt)), "source_outside_plan");
    requireCandidate(c.locationId !== result.slot.locationId, "location_mismatch"); requireCandidate(fixed === null, "approval_missing");
    requireCandidate(c.claim !== null && c.claim.slotId !== q.slotId, "claimed_elsewhere");
    requireGlobal(c.blockers.includes("identity_unproven"), "context_unknown"); requireGlobal(c.blockers.includes("pending_missing"), "pending_missing");
    requireGlobal(c.blockers.includes("pending_correction"), "pending_correction");
    if (c.available && (c.locationId !== result.slot.locationId || micros(c.selected.startAt!) >= micros(result.slot.endAt) || micros(c.selected.endAt!) <= micros(result.slot.startAt) || fixed === null)) fail();
    if (micros(c.selected.startAt!) > micros(result.readAt) || c.selected.endAt !== null && micros(c.selected.endAt) > micros(result.readAt)) fail();
    if (c.original !== null && (micros(c.original.startAt!) > micros(result.readAt) || c.original.endAt !== null && micros(c.original.endAt) > micros(result.readAt))) fail();
  }
  return { fingerprint: hash(p.fingerprint), eligible, blockers: values, candidates, approval: fixed,
    source: { protocol: "posthoc-adoption-preview-v1", basis, caseId, caseRevision, revision, currentOperationId, candidates, approval: fixed, blockers: values } };
}
export function parsePlanPosthocResult(raw: unknown, query: PlanPosthocQuery, expectedActorId: string, expectedCommand: PlanPosthocCommand | null = null): PlanPosthocResult {
  try { safeTree(raw, 3145728); const q = parsePlanPosthocQuery(query), actor = uuid(expectedActorId), detached: unknown = JSON.parse(JSON.stringify(raw));
    const v = exact(detached, ["protocol", "siteId", "actorId", "worker", "slot", "revision", "current", "preview", "history", "historyTruncated", "receipt", "readAt"]);
    if (v.protocol !== "plan-posthoc-adoption-v1" || v.siteId !== q.siteId || v.actorId !== actor) fail();
    const worker = parseExceptionWorker(v.worker), slot = parseExceptionSlot(v.slot), revision = integer(v.revision, 0, 100), readAt = stamp(v.readAt), current = v.current === null ? null : operation(v.current);
    if (worker.workerId !== q.workerId || slot.id !== q.slotId || (current === null ? revision !== 0 : current.revision !== revision)) fail();
    if (!Array.isArray(v.history) || v.history.length > 25) return fail();
    const history = v.history.map(operation), historyTruncated = bool(v.historyTruncated);
    if (history.length !== Math.min(revision, 25) || historyTruncated !== (revision > 25) || (current !== null && !same(current, history[0]))) fail();
    const ids = new Set<string>();
    for (let i = 0; i < history.length; i++) {
      const h = history[i]; if (h.revision !== revision - i || ids.has(h.operationId) || micros(h.recordedAt) > micros(readAt)
        || h.employeeId !== worker.employeeId || h.employeeAuthUserId !== worker.employeeAuthUserId
        || i > 0 && micros(h.recordedAt) > micros(history[i - 1].recordedAt)) fail(); ids.add(h.operationId);
    }
    const result: PlanPosthocResult = { protocol: "plan-posthoc-adoption-v1", siteId: q.siteId, actorId: actor, worker, slot, revision, current, preview: null, history, historyTruncated, receipt: null, readAt };
    if (v.preview !== null) result.preview = preview(v.preview, q, result);
    if (v.receipt !== null) {
      const r = exact(v.receipt, ["operationId", "command", "item"]), command = parsePlanPosthocCommand(r.command), item = operation(r.item);
      if (r.operationId !== item.operationId || command.operationId !== item.operationId || item.revision !== command.expectedRevision + 1
        || item.action !== command.action || item.employeeId !== command.employeeId || item.employeeAuthUserId !== command.employeeAuthUserId
        || item.employeeId !== worker.employeeId || item.employeeAuthUserId !== worker.employeeAuthUserId
        || item.actorId !== actor || item.reason !== command.reason || item.sourceFingerprint !== command.expectedFingerprint
        || !same(item.sources, command.action === "apply" ? command.sources : []) || item.revision > revision || micros(item.recordedAt) > micros(readAt)) fail();
      const saved = history.find(h => h.operationId === item.operationId); if (saved && !same(saved, item)) fail();
      if (item.revision >= revision - history.length + 1 && !saved) fail();
      result.receipt = { operationId: item.operationId, command, item };
    }
    if (q.mode === "recover" && (!result.receipt || result.receipt.operationId !== q.operationId || result.preview !== null)) fail();
    if (expectedCommand !== null && (!result.receipt || !same(result.receipt.command, parsePlanPosthocCommand(expectedCommand)))) fail();
    if (q.mode === "detail" && expectedCommand === null && (result.receipt !== null || result.preview === null)) fail();
    return freeze(result);
  } catch { return fail(); }
}
