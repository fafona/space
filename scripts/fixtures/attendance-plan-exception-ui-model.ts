// Synthetic, detached UI/protocol fixture. Fingerprints are server-attested
// shape values; this does not claim PostgreSQL canonical-byte verification.
import { planRuleApprovalsSource } from "./attendance-plan-rule-approvals-model";
import { calculateExceptionCandidate } from "../../src/lib/merchantAttendancePlanExceptionSource";
import type { PlanExceptionSource, PlanExceptionSourceResult } from "../../src/lib/merchantAttendancePlanExceptionSourceContract";
import type { PlanExceptionAccess, PlanExceptionQuery, PlanExceptionCommand, PlanExceptionDecisionCommand, PlanExceptionNoteCommand, PlanExceptionEvidence,
  PlanExceptionDecision, PlanExceptionResult } from "../../src/lib/merchantAttendancePlanExceptionContract";
export const exceptionUiId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const exceptionUiSite = "99990009", exceptionUiOwner = exceptionUiId(1), exceptionUiEmployee = exceptionUiId(2), exceptionUiAuth = exceptionUiId(3), exceptionUiWorker = exceptionUiId(4), exceptionUiSlot = exceptionUiId(30);
export const exceptionUiTime = "2026-10-09T12:00:00.000000Z", exceptionUiFingerprint = "a".repeat(64);
function isNoteCommand(command: PlanExceptionCommand): command is PlanExceptionNoteCommand {
  return "note" in command && typeof command.note === "string" && "expectedRevision" in command
    && typeof command.expectedRevision === "number" && "decisionOperationId" in command;
}
export function exceptionUiQuery(access: PlanExceptionAccess = "owner", mode: PlanExceptionQuery["mode"] = "detail", operationId = exceptionUiId(900)): PlanExceptionQuery {
  return { siteId: exceptionUiSite, access, mode, workerId: mode === "list" ? null : exceptionUiWorker, slotId: mode === "list" ? null : exceptionUiSlot,
    operationId: ["recover", "decide", "note", "ack"].includes(mode) ? operationId : null, beforeAt: null, beforeId: null };
}
export function exceptionUiEligibleSource(): PlanExceptionSourceResult {
  const policy = planRuleApprovalsSource(), worker = { workerId: exceptionUiWorker, workerName: "Synthetic <img src=x onerror=bad>", workerNo: "E-4", employeeId: exceptionUiEmployee, employeeAuthUserId: exceptionUiAuth, version: 2, active: true, employeeActive: true };
  const slot = { id: exceptionUiSlot, revision: policy.slot.revision, locationId: policy.slot.locationId, locationName: "Synthetic location", timeZone: policy.slot.timeZone,
    workDate: "2026-10-08", startAt: policy.slot.startAt, endAt: policy.slot.endAt, cancelled: false, hasPublicationEvidence: true };
  const reference = { operationId: exceptionUiId(700), revision: 1, sourceId: exceptionUiId(701), sourceSha256: "b".repeat(64), recordedAt: "2026-10-07T12:00:00.000000Z" };
  const startEventId = exceptionUiId(800), operationId = exceptionUiId(801), startAt = "2026-10-08T08:10:00.000000Z", endAt = "2026-10-08T15:50:00.000000Z";
  const source: PlanExceptionSource = { protocol: "plan-exception-evidence-v1", policy: "owner-confirmed-plan-edges-v1", siteId: exceptionUiSite,
    worker, slot, phase: "ended", approval: { ...reference, source: policy }, sessions: [{ startEventId, operationId, lastEventId: exceptionUiId(802), lastSequence: 2,
      relation: { startEventId, operationId, selection: { slotId: slot.id, revision: slot.revision }, status: "linked", reason: null, slot: { ...slot }, observedRevision: slot.revision, recordedAt: startAt, currentCancelled: false },
      adoption: { startEventId, operationId, channel: "self", employeeId: exceptionUiEmployee, employeeAuthUserId: exceptionUiAuth, status: "adopted", reason: null,
        approval: reference, recordedAt: startAt, policy: "explicit-plan-approval-at-clock-in-v1" }, original: { startAt, endAt }, selected: { startAt, endAt }, effect: null }],
    context: { unassociated: { limited: false, items: [] }, leave: { limited: false, items: [] }, calendar: { limited: false, items: [] }, missing: { limited: false, items: [] }, pendingCorrections: { limited: false, items: [] } } };
  return { protocol: "plan-exception-source-v1", siteId: exceptionUiSite, actorId: exceptionUiOwner, worker, slot, readAt: exceptionUiTime,
    source, fingerprint: exceptionUiFingerprint, eligible: true, blockers: [], candidate: calculateExceptionCandidate(source, true) };
}
export function exceptionUiBlockedSource(): PlanExceptionSourceResult {
  const r = exceptionUiEligibleSource(); r.source.sessions = []; r.source.approval = null; r.eligible = false; r.blockers = ["no_associated_sessions"];
  r.candidate = calculateExceptionCandidate(r.source, false); return r;
}
export function exceptionUiEvidence(r: PlanExceptionSourceResult = exceptionUiEligibleSource()): PlanExceptionEvidence {
  const approval = r.source.approval; return { policy: "owner-confirmed-plan-edges-v1", fingerprint: r.fingerprint, observedAt: r.readAt,
    eligible: r.eligible, blockers: [...r.blockers], candidate: structuredClone(r.candidate), approval: approval ? { operationId: approval.operationId, revision: approval.revision, sourceId: approval.sourceId, sourceSha256: approval.sourceSha256, recordedAt: approval.recordedAt } : null,
    sessions: r.source.sessions.map(s => ({ startEventId: s.startEventId, lastEventId: s.lastEventId, lastSequence: s.lastSequence, effectOperationId: s.effect?.operationId ?? null })),
    contextRefs: { unassociated: { limited: false, items: [] }, leave: { limited: false, items: [] }, calendar: { limited: false, items: [] }, missing: { limited: false, items: [] }, pendingCorrections: { limited: false, items: [] } } };
}
export function exceptionUiDecisionCommand(eligible = true): PlanExceptionDecisionCommand {
  return { operationId: exceptionUiId(900), expectedRevision: 0, expectedFingerprint: exceptionUiFingerprint, employeeId: exceptionUiEmployee,
    employeeAuthUserId: exceptionUiAuth, outcome: eligible ? "confirmed" : "follow_up", note: "Synthetic explicit owner reason" };
}
export function exceptionUiDecision(eligible = true): PlanExceptionDecision {
  const c = exceptionUiDecisionCommand(eligible); return { operationId: c.operationId, revision: 1, actorId: exceptionUiOwner, kind: "decision", outcome: c.outcome,
    note: c.note, decisionOperationId: null, recordedAt: exceptionUiTime, evidence: exceptionUiEvidence(eligible ? exceptionUiEligibleSource() : exceptionUiBlockedSource()), readAt: null };
}
export function exceptionUiWire(options: { access?: PlanExceptionAccess; mode?: PlanExceptionQuery["mode"]; eligible?: boolean; saved?: boolean; command?: PlanExceptionCommand | null; missingReceipt?: boolean } = {}): PlanExceptionResult {
  const { access = "owner", mode = "detail", eligible = true, saved = access === "self" || ["decide", "note", "ack"].includes(mode), command = mode === "decide" ? exceptionUiDecisionCommand(eligible) : null, missingReceipt = false } = options;
  const source = eligible ? exceptionUiEligibleSource() : exceptionUiBlockedSource(), decision = saved ? exceptionUiDecision(eligible) : null;
  const result: PlanExceptionResult = { protocol: "plan-exception-review-v1", siteId: exceptionUiSite, access, actorId: access === "owner" ? exceptionUiOwner : exceptionUiAuth,
    employeeId: access === "owner" ? null : exceptionUiEmployee, readAt: exceptionUiTime, items: [], nextCursor: null, receipt: null, readReceipt: null,
    detail: { caseId: saved ? exceptionUiId(900) : null, openedAt: saved ? exceptionUiTime : null, worker: { ...source.worker }, slotId: exceptionUiSlot, revision: saved ? 1 : 0,
      current: access === "owner" ? source : null, currentValidation: access === "owner" ? "checked" : "not_checked", stale: access === "owner" && saved ? false : null,
      latestDecision: decision, history: decision ? [{ operationId: decision.operationId, revision: decision.revision, actorId: decision.actorId, kind: decision.kind, outcome: decision.outcome, note: decision.note, decisionOperationId: null, recordedAt: decision.recordedAt }] : [],
      historyTruncated: false, canDecide: access === "owner", canNote: access === "self" && saved } };
  if (mode === "recover") { result.detail!.current = null; result.detail!.currentValidation = "not_checked"; result.detail!.stale = null; result.detail!.canDecide = false; }
  if (mode === "list") { result.detail = null; if (decision) result.items = [{ caseId: exceptionUiId(900), workerId: exceptionUiWorker, slotId: exceptionUiSlot, employeeId: exceptionUiEmployee,
    employeeAuthUserId: exceptionUiAuth, workerName: source.worker.workerName, workerNo: source.worker.workerNo, slotStartAt: source.slot.startAt, slotEndAt: source.slot.endAt, timeZone: source.slot.timeZone,
    openedAt: exceptionUiTime, revision: 1, latestDecision: { operationId: decision.operationId, revision: 1, outcome: decision.outcome, recordedAt: exceptionUiTime, readAt: null } }]; return result; }
  if (command && !missingReceipt) {
    if ("outcome" in command) {
      const item = { operationId: command.operationId, revision: command.expectedRevision + 1, actorId: result.actorId, kind: "decision" as const,
        outcome: command.outcome, note: command.note, decisionOperationId: null, recordedAt: exceptionUiTime, evidence: exceptionUiEvidence(source) };
      result.receipt = { operationId: command.operationId, command: { ...command }, item };
      result.detail!.revision = item.revision; result.detail!.caseId = command.operationId; result.detail!.openedAt = exceptionUiTime;
      result.detail!.stale = access === "owner" && mode !== "recover" ? false : null;
      result.detail!.latestDecision = { ...item, readAt: null }; const { evidence: _evidence, ...entry } = item; void _evidence; result.detail!.history = [entry];
    } else if (isNoteCommand(command)) {
      const item = { operationId: command.operationId, revision: command.expectedRevision + 1, actorId: result.actorId, kind: "note" as const, outcome: null, note: command.note, decisionOperationId: command.decisionOperationId, recordedAt: exceptionUiTime, evidence: null };
      result.receipt = { operationId: command.operationId, command: { ...command }, item }; result.detail!.revision = item.revision;
      const { evidence: _evidence, ...entry } = item; void _evidence; result.detail!.history.unshift(entry);
    } else {
      result.readReceipt = { operationId: command.operationId, command: { ...command }, decisionOperationId: command.decisionOperationId, actorId: exceptionUiAuth,
        employeeId: exceptionUiEmployee, employeeAuthUserId: exceptionUiAuth, readAt: exceptionUiTime }; result.detail!.latestDecision!.readAt = exceptionUiTime;
    }
  }
  return result;
}
export function exceptionUiHttp(options: Parameters<typeof exceptionUiWire>[0] & { moduleEnabled?: boolean } = {}) {
  const data = exceptionUiWire(options), moduleEnabled = options.moduleEnabled ?? true;
  if (!moduleEnabled && data.detail) { data.detail.canDecide = false; data.detail.canNote = false; }
  return { ok: true as const, moduleEnabled, data };
}
