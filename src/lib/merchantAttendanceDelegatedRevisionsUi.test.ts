//Synthetic protocol fixtures, not real Auth or native decision acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import * as r from "./merchantAttendanceDelegatedRevisions";
import { buildManagementRevisionsGrant, buildManagementRevisionsCommand, managementRevisionsContextQuery } from "./merchantAttendanceDelegatedRevisionsUi";
import { revisionApprovalResponse } from "../../scripts/fixtures/attendance-revision-approval-model";
import { correctionId as id } from "../../scripts/fixtures/attendance-correction-model";

const grantForm = { delegateEmployeeId: id(770), delegateAuthUserId: id(771), delegatedAction: "revision_approve", workerId: id(772), employeeId: id(773), employeeAuthUserId: id(774),
  locationIds: id(776) + "," + id(775), includePending: false, validFrom: "2026-09-30T10:00", validUntil: "2026-10-01T10:00", reason: " 明确指定连续修订范围 ", acknowledged: true };
test("208 owner grant helper keeps the exact revision scope, real dual identities, pending choice and only two actions", () => {
  for (const delegatedAction of ["revision_approve", "revision_reject"]) {
    const command = buildManagementRevisionsGrant({ ...grantForm, delegatedAction }, id(780));
    assert.equal(command.delegatedAction, delegatedAction); assert.equal(command.scope.kind, "revision");
    assert.deepEqual(command.scope, { kind: "revision", workerId: id(772), employeeId: id(773), employeeAuthUserId: id(774), locationIds: [id(775), id(776)], includePending: false });
    assert.equal(command.validFrom, "2026-09-30T10:00:00.000000Z"); assert.equal(command.reason, "明确指定连续修订范围");
  }
  for (const patch of [{ acknowledged: false }, { delegatedAction: "annul" }, { includePending: "true" }, { locationIds: "" }, { locationIds: id(775) + "," + id(775) },
    { delegateEmployeeId: id(773) }, { delegateAuthUserId: id(774) }, { authUserId: id(999) }]) assert.throws(() => buildManagementRevisionsGrant({ ...grantForm, ...patch }, id(780)));
});
test("208 decision helper captures only reason/ack and derives every CAS field and permitted action from strict fresh scoped review", async () => {
  const source = revisionApprovalResponse(), actorId = id(771), query = managementRevisionsContextQuery(source.siteId, id(781), source.requestId), item = source.review.review.application;
  const scope = { kind: "revision", workerId: item.workerId, employeeId: item.employeeId, employeeAuthUserId: id(774), locationIds: [item.basis.events[0].locationId], includePending: true };
  for (const action of ["revision_approve", "revision_reject"] as const) {
    const context = { protocol: r.DELEGATED_REVISIONS_PROTOCOL, siteId: source.siteId, actorId, readAt: source.asOf, kind: "context", grantId: query.grantId, action, scope,
      context: { review: source, canApprove: action === "revision_approve", canReject: action === "revision_reject" } };
    const command = await buildManagementRevisionsCommand(context, query, actorId, { reason: " 已核实基准与声明 ", acknowledged: true }, id(782));
    assert.deepEqual(command, { action: action === "revision_approve" ? "approve" : "reject", operationId: id(782), requestId: source.requestId,
      expectedRevision: source.review.submittedRevision, expectedEvidence: source.evidenceToken, expectedBaseOperationId: source.review.base.operationId, reason: "已核实基准与声明" });
    for (const draft of [{ reason: "reason", acknowledged: false }, { reason: "", acknowledged: true }, { reason: "reason", acknowledged: true, expectedRevision: 9 }])
      await assert.rejects(buildManagementRevisionsCommand(context, query, actorId, draft, id(782)));
    await assert.rejects(buildManagementRevisionsCommand({ ...context, actorId: id(999) }, query, actorId, { reason: "reason", acknowledged: true }, id(782)));
    await assert.rejects(buildManagementRevisionsCommand({ ...context, context: { ...context.context, canApprove: false, canReject: false } }, query, actorId, { reason: "reason", acknowledged: true }, id(782)));
  }
  assert.throws(() => managementRevisionsContextQuery(source.siteId, query.grantId, ""));
});
