//Synthetic strict DTO model only; not real grant/SQL/Auth acceptance.
import { createHash } from "node:crypto";
import { exceptionUiWire, exceptionUiDecisionCommand, exceptionUiId as id } from "./attendance-plan-exception-ui-model";
import * as p from "../../src/lib/merchantAttendanceDelegatedPlanExceptions";
import { buildManagementPlanExceptionsCommand } from "../../src/lib/merchantAttendanceDelegatedPlanExceptionsUi";
// The native fixture may pass its actual local SQL context here. This helper
// builds the SAME browser command; it never replaces SQL authorization/evidence.
export function delegatedPlanExceptionsFixtureCommand(context: unknown, query: p.DelegatedPlanExceptionsContextQuery, actor: string,
  outcome: string, operationId: string, note = "Synthetic delegated explicit decision") {
  return buildManagementPlanExceptionsCommand(context, query, actor, { outcome, note, acknowledged: true }, operationId);
}
export function delegatedPlanExceptionsModel(eligible = true) {
  const review = exceptionUiWire({ eligible }), actor = id(209001), grantId = id(209002);
  review.actorId = actor; review.detail!.current!.actorId = actor;
  const d = review.detail!, query: p.DelegatedPlanExceptionsContextQuery = { siteId: review.siteId, grantId, mode: "context", workerId: d.worker.workerId, slotId: d.slotId },
    command: p.DelegatedPlanExceptionsCommand = { ...exceptionUiDecisionCommand(eligible), operationId: id(209003), note: "Synthetic delegated explicit decision" };
  const scope: p.DelegatedPlanExceptionsScope = { kind: "formal_exception", workerId: d.worker.workerId, employeeId: d.worker.employeeId, employeeAuthUserId: d.worker.employeeAuthUserId,
    locationIds: [d.current!.slot.locationId], includePending: false };
  const context: p.DelegatedPlanExceptionsContextResult = { protocol: p.DELEGATED_PLAN_EXCEPTIONS_PROTOCOL, siteId: query.siteId, actorId: actor, readAt: review.readAt,
    kind: "context", grantId, action: "plan_exception_decide", scope, context: { review, canDecide: true, canConclude: eligible, canClear: false, canNotApplicable: false } };
  const receipt: p.DelegatedPlanExceptionsResult = { protocol: p.DELEGATED_PLAN_EXCEPTIONS_PROTOCOL, siteId: query.siteId, actorId: actor, readAt: review.readAt, kind: "receipt",
    receipt: { operationId: command.operationId, actorId: actor, grantId, action: "plan_exception_decide", reference: { kind: "formal_exception", workerId: query.workerId, slotId: query.slotId,
      employeeId: scope.employeeId, employeeAuthUserId: scope.employeeAuthUserId, caseId: command.operationId, decisionRevision: 1 },
      commandFingerprint: createHash("sha256").update(p.delegatedPlanExceptionsFingerprintText(query, actor, command)).digest("hex"), businessFingerprint: "b".repeat(64), recordedAt: review.readAt } };
  const recover: p.DelegatedPlanExceptionsQuery = { siteId: query.siteId, grantId, mode: "recover", operationId: command.operationId };
  return { actor, query, command, context, receipt, recover };
}
