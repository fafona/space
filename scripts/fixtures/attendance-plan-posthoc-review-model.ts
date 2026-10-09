//207 detached protocol/UI fixtures only: no SQL identity, immutable ledger,
//PostgreSQL canonical bytes or actual authentication is attested here.
import { exceptionUiEligibleSource, exceptionUiId as id, exceptionUiWire } from "./attendance-plan-exception-ui-model";
import { parsePlanPosthocEvaluation } from "../../src/lib/merchantAttendancePlanPosthocEvaluation";
import { parsePlanPosthocFormalSource } from "../../src/lib/merchantAttendancePlanPosthocFormalSource";
import { parsePlanPosthocEvidence, type PlanExceptionPosthocEvidence } from "../../src/lib/merchantAttendancePlanPosthocEvidence";
import type { PlanPosthocEvaluationFacts } from "../../src/lib/merchantAttendancePlanPosthocEvaluationContract";
import type { PlanPosthocFormalSourceV3Result } from "../../src/lib/merchantAttendancePlanPosthocFormalSourceContract";
import type { PlanExceptionAccess, PlanExceptionOutcome, PlanExceptionResult, PlanExceptionDecisionCommand, PlanExceptionQuery } from "../../src/lib/merchantAttendancePlanExceptionContract";

export function posthocReviewSource(options: { fullLeave?: boolean; revoked?: boolean; adopted?: boolean; mixed?: "session-first" | "missing-first" } = {}): PlanPosthocFormalSourceV3Result {
  const old = exceptionUiEligibleSource(), a = old.source.approval!, compact = { operationId: a.operationId, revision: a.revision, sourceId: a.sourceId, sourceSha256: a.sourceSha256, recordedAt: a.recordedAt };
  const facts: PlanPosthocEvaluationFacts = { protocol: "plan-posthoc-evaluation-v1", siteId: old.siteId, actorId: old.actorId,
    worker: structuredClone(old.worker), slot: structuredClone(old.slot), readAt: old.readAt, fingerprint: "d".repeat(64),
    source: { protocol: "posthoc-evaluation-evidence-v1", basis: old.source,
      posthoc: { revision: 1, current: { operationId: id(207001), revision: 1, action: "apply", actorId: old.actorId,
        employeeId: old.worker.employeeId, employeeAuthUserId: old.worker.employeeAuthUserId, reason: "Synthetic explicit post-hoc review",
        sources: [], sourceFingerprint: "e".repeat(64), recordedAt: old.readAt }, selected: [], approval: compact },
      observations: [], approval: structuredClone(a), leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: [] } };
  if (options.adopted || options.mixed) {
    const reference = { kind: "session" as const, startEventId: id(207020), lastEventId: id(207021), lastSequence: 4, effectOperationId: null, effectRevision: null };
    const span = { startAt: "2026-10-08T08:00:00.000000Z", endAt: options.mixed ? "2026-10-08T08:05:00.000000Z" : "2026-10-08T08:10:00.000000Z" };
    facts.source.basis.context.unassociated.items = [{ startEventId: reference.startEventId, lastEventId: reference.lastEventId, lastSequence: reference.lastSequence,
      operationId: id(207022), relationSlotId: null, original: span, selected: span, effect: null }];
    const saved = { reference, original: span, selected: span, locationId: old.slot.locationId, timeZone: old.slot.timeZone, available: true, blockers: [], claim: null };
    facts.source.posthoc.current!.sources = [reference]; facts.source.posthoc.selected = [saved];
    facts.source.observations = [{ reference, current: { ...structuredClone(saved), claim: { slotId: old.slot.id, operationId: id(207001), revision: 1 } }, blockers: [] }];
  }
  if (options.mixed) {
    const reference = { kind: "missing" as const, requestId: id(207030), rootRequestId: id(207030), approvalOperationId: id(207031) };
    const span = { startAt: "2026-10-08T08:05:00.000000Z", endAt: "2026-10-08T08:10:00.000000Z" };
    const saved = { reference, original: null, selected: span, locationId: old.slot.locationId, timeZone: old.slot.timeZone, available: true, blockers: [], claim: null };
    facts.source.basis.context.missing.items = [{ requestId: reference.requestId, operationId: reference.approvalOperationId, revision: 2, status: "approved",
      supersedesRequestId: null, rootRequestId: reference.rootRequestId, isCurrentApproved: true, ...span, recordedAt: "2026-10-09T10:00:00.000000Z" }];
    facts.source.posthoc.current!.sources.push(reference); facts.source.posthoc.selected.push(saved);
    facts.source.observations.push({ reference, current: { ...structuredClone(saved), claim: { slotId: old.slot.id, operationId: id(207001), revision: 1 } }, blockers: [] });
    //171 persists the explicit command order. It neither groups nor sorts kinds.
    if (options.mixed === "missing-first") {
      facts.source.posthoc.current!.sources.reverse(); facts.source.posthoc.selected.reverse(); facts.source.observations.reverse();
    }
  }
  if (options.fullLeave) {
    facts.source.basis.sessions = []; facts.source.basis.approval = null; facts.source.approval = null; facts.source.posthoc.approval = null;
    const leave = { requestId: id(207010), operationId: id(207011), revision: 2, status: "approved" as const,
      startAt: old.slot.startAt, endAt: old.slot.endAt, recordedAt: "2026-10-09T10:00:00.000000Z" };
    facts.source.basis.context.leave.items = [leave]; facts.source.leave.items = [{ ...leave, current: true }];
  }
  if (options.revoked) { facts.source.posthoc.current!.action = "revoke"; facts.source.posthoc.current!.revision = facts.source.posthoc.revision = 2;
    facts.source.posthoc.current!.sources = []; facts.source.posthoc.selected = []; facts.source.observations = [];
    facts.source.posthoc.approval = null; facts.source.resolutionBlockers = ["posthoc_inactive"]; }
  const query = { siteId: old.siteId, workerId: old.worker.workerId, slotId: old.slot.id }, result = parsePlanPosthocEvaluation(facts, query, old.actorId);
  const parsed = parsePlanPosthocFormalSource({ protocol: "plan-exception-source-v3", siteId: result.siteId, actorId: result.actorId, worker: result.worker, slot: result.slot,
    readAt: result.readAt, source: { protocol: "plan-exception-evidence-v3", policy: "owner-confirmed-plan-edges-posthoc-v3", evaluation: result.source },
    fingerprint: result.fingerprint, state: result.state === "not_active" ? "blocked" : result.state, eligible: result.eligible, blockers: result.blockers, candidate: result.candidate, leaveEdges: result.leaveEdges }, query, old.actorId);
  if (parsed.protocol !== "plan-exception-source-v3") throw Error("fixture_protocol"); return structuredClone(parsed);
}
export function posthocReviewEvidence(source = posthocReviewSource()): PlanExceptionPosthocEvidence {
  const facts = source.source.evaluation, basis = facts.basis, sessionRef = (v: typeof basis.sessions[number] | typeof basis.context.unassociated.items[number]) => ({
    startEventId: v.startEventId, lastEventId: v.lastEventId, lastSequence: v.lastSequence, effectOperationId: v.effect?.operationId ?? null });
  const requestRef = (v: { requestId: string; operationId: string; revision: number }) => ({ requestId: v.requestId, operationId: v.operationId, revision: v.revision });
  const a = facts.approval, context = basis.context;
  return structuredClone(parsePlanPosthocEvidence({ policy: "owner-confirmed-plan-edges-posthoc-v3", fingerprint: source.fingerprint,
    observedAt: source.readAt, eligible: source.eligible, blockers: source.blockers, candidate: source.candidate,
    approval: a === null ? null : { operationId: a.operationId, revision: a.revision, sourceId: a.sourceId, sourceSha256: a.sourceSha256, recordedAt: a.recordedAt },
    sessions: basis.sessions.map(sessionRef), contextRefs: {
      unassociated: { limited: context.unassociated.limited, items: context.unassociated.items.map(sessionRef) },
      leave: { limited: context.leave.limited, items: context.leave.items.map(requestRef) },
      missing: { limited: context.missing.limited, items: context.missing.items.map(requestRef) },
      calendar: { limited: context.calendar.limited, items: context.calendar.items.map(item => ({ entryId: item.entryId, operationId: item.operationId, revision: item.revision })) },
      pendingCorrections: { limited: context.pendingCorrections.limited, items: context.pendingCorrections.items.map(item => ({ ...requestRef(item), kind: item.kind, startEventId: item.startEventId })) },
      ...(context.workArrangements ? { workArrangements: { limited: context.workArrangements.limited, items: context.workArrangements.items.map(item => ({ requestId: item.requestId, revision: item.revision, operationId: item.history.at(-1)!.operationId })) } } : {}) },
    evaluation: { state: source.state, slot: { slotId: source.slot.id, locationId: source.slot.locationId, timeZone: source.slot.timeZone, startAt: source.slot.startAt, endAt: source.slot.endAt },
      posthoc: facts.posthoc, observations: facts.observations, leaveEdges: source.leaveEdges } }, { slotId: source.slot.id, employeeId: source.worker.employeeId, employeeAuthUserId: source.worker.employeeAuthUserId }));
}
export function posthocReviewWire(options: { access?: PlanExceptionAccess; mode?: PlanExceptionQuery["mode"]; source?: PlanPosthocFormalSourceV3Result;
  outcome?: PlanExceptionOutcome; operationId?: string; receipt?: boolean } = {}): PlanExceptionResult {
  const { access = "owner", mode = "detail", source = posthocReviewSource(), outcome = source.state === "not_applicable" ? "not_applicable" : source.eligible ? "confirmed" : "follow_up", operationId = id(207900), receipt = mode === "decide" } = options;
  const result = exceptionUiWire({ access, mode: "detail", saved: true }), detail = result.detail!;
  const command: PlanExceptionDecisionCommand = { operationId, expectedRevision: 1, expectedFingerprint: source.fingerprint,
    employeeId: source.worker.employeeId, employeeAuthUserId: source.worker.employeeAuthUserId, outcome, note: "Synthetic explicit saved v3 decision" };
  const decision = { ...detail.latestDecision!, operationId, revision: 2, outcome, note: command.note, evidence: posthocReviewEvidence(source) };
  detail.revision = 2; detail.latestDecision = decision;
  const { evidence: _evidence, readAt: _readAt, ...entry } = decision; void _evidence; void _readAt; detail.history.unshift(entry);
  if (access === "owner") { detail.current = source; detail.currentValidation = "checked"; detail.stale = false; }
  if (receipt) { const { readAt: _read, ...item } = decision; void _read; result.receipt = { operationId, command, item }; }
  if (mode === "recover") { detail.current = null; detail.currentValidation = "not_checked"; detail.stale = null; detail.canDecide = false; }
  if (mode === "list") {
    const list = exceptionUiWire({ access, mode: "list", saved: true }); list.items[0].revision = 2;
    list.items[0].latestDecision = { operationId, revision: 2, outcome, recordedAt: decision.recordedAt, readAt: null }; return list;
  }
  return result;
}
