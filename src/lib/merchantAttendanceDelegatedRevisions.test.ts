//Synthetic DTO/source tests, not Auth/grant/SQL/real approval acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as p from "./merchantAttendanceDelegatedRevisions";
import { revisionApprovalResponse } from "../../scripts/fixtures/attendance-revision-approval-model";
import { correctionId as id } from "../../scripts/fixtures/attendance-correction-model";

export function delegatedRevisionFixture(action: "approve" | "reject" = "approve") {
  const review = revisionApprovalResponse(), app = review.review.review.application, actor = id(890), grantId = id(891);
  const query: p.DelegatedRevisionsContextQuery = { siteId: review.siteId, grantId, mode: "context", requestId: review.requestId };
  const command: p.DelegatedRevisionsCommand = { action, operationId: id(892), requestId: review.requestId, expectedRevision: review.review.submittedRevision,
    expectedEvidence: review.evidenceToken, expectedBaseOperationId: review.review.base.operationId, reason: "合成受托修订核验" };
  const scope: p.DelegatedRevisionsScope = { kind: "revision", workerId: app.workerId, employeeId: app.employeeId, employeeAuthUserId: id(893),
    locationIds: [...new Set([...app.basis.events, ...(review.review.review.evidence.currentBasis?.events ?? [])].map(e => e.locationId))].sort(), includePending: false };
  const context: p.DelegatedRevisionsContextResult = { protocol: p.DELEGATED_REVISIONS_PROTOCOL, siteId: query.siteId, actorId: actor, readAt: review.asOf,
    kind: "context", grantId, action: action === "approve" ? "revision_approve" : "revision_reject", scope,
    context: { review, canApprove: action === "approve", canReject: action === "reject" } };
  const result: p.DelegatedRevisionsResult = { protocol: p.DELEGATED_REVISIONS_PROTOCOL, siteId: query.siteId, actorId: actor, readAt: "2026-09-30T14:03:00.000000Z", kind: "receipt",
    receipt: { operationId: command.operationId, actorId: actor, grantId, action: context.action, reference: { kind: "revision", requestId: query.requestId,
      rootRequestId: review.review.base.lineage.rootRequestId, workerId: scope.workerId, employeeId: scope.employeeId, employeeAuthUserId: scope.employeeAuthUserId,
      requestRevision: command.expectedRevision, baseOperationId: command.expectedBaseOperationId, effectRevision: action === "approve" ? review.current.revision + 1 : null },
      commandFingerprint: createHash("sha256").update(p.delegatedRevisionsFingerprintText(query, actor, command)).digest("hex"), businessFingerprint: "b".repeat(64), recordedAt: "2026-09-30T14:02:01.000000Z" } };
  return { actor, query, command, context, result };
}

test("208 exact two query modes and old7key approve/reject command; no annul/list/authority/secret extensions", () => {
  const f = delegatedRevisionFixture(); assert.deepEqual(p.parseDelegatedRevisionsQuery(f.query), f.query);
  const recover: p.DelegatedRevisionsQuery = { siteId: f.query.siteId, grantId: f.query.grantId, mode: "recover", operationId: f.command.operationId };
  assert.deepEqual(p.parseDelegatedRevisionsQuery(Object.fromEntries(new URLSearchParams(p.delegatedRevisionsQueryString(recover)))), recover);
  assert.deepEqual(p.parseDelegatedRevisionsBody({ query: f.query, command: f.command }), { query: f.query, command: f.command });
  for (const patch of [{ mode: "list" }, { operationId: f.command.operationId }, { ownerId: f.actor }, { requestId: "bad" }]) assert.throws(() => p.parseDelegatedRevisionsQuery({ ...f.query, ...patch }));
  for (const patch of [{ action: "annul" }, { siteId: f.query.siteId }, { pin: "12345678" }, { expectedRevision: -0 }, { expectedRevision: 0 }, { expectedEvidence: "x".repeat(32) }, { reason: " x " }])
    assert.throws(() => p.parseDelegatedRevisionsCommand({ ...f.command, ...patch }));
  assert.throws(() => p.parseDelegatedRevisionsBody({ query: recover, command: f.command }));
  assert.throws(() => p.parseDelegatedRevisionsBody({ query: { ...f.query, requestId: id(999) }, command: f.command }));
});

test("208 full SHA uses exact comma-space canonical tuple including actor/grant/all old command fields", async () => {
  const f = delegatedRevisionFixture(), c = f.command;
  const tuple = ["attendance-delegated-revisions-v1-command", f.query.siteId, f.actor, f.query.grantId,
    [c.action, c.operationId, c.requestId, c.expectedRevision, c.expectedEvidence, c.expectedBaseOperationId, c.reason]];
  const encode = (v: unknown): string => Array.isArray(v) ? "[" + v.map(encode).join(", ") + "]" : JSON.stringify(v);
  assert.equal(p.delegatedRevisionsFingerprintText(f.query, f.actor, c), encode(tuple));
  assert.equal(await p.delegatedRevisionsCommandFingerprint(f.query, f.actor, c), f.result.kind === "receipt" ? f.result.receipt!.commandFingerprint : "");
  for (const command of [{ ...c, reason: "另一理由" }, { ...c, expectedRevision: c.expectedRevision + 1 }, { ...c, expectedEvidence: "a".repeat(32) }])
    assert.notEqual(await p.delegatedRevisionsCommandFingerprint(f.query, f.actor, command), await p.delegatedRevisionsCommandFingerprint(f.query, f.actor, c));
  assert.notEqual(await p.delegatedRevisionsCommandFingerprint({ ...f.query, grantId: id(999) }, f.actor, c), await p.delegatedRevisionsCommandFingerprint(f.query, f.actor, c));
});

test("208 context reuses genuine later-cycle v2 parser while masking only new grant action", async () => {
  for (const action of ["approve", "reject"] as const) {
    const f = delegatedRevisionFixture(action), r = await p.parseDelegatedRevisionsResult(f.context, f.query, f.actor);
    assert.equal(r.kind, "context"); if (r.kind !== "context") assert.fail();
    assert.equal(r.context.review.current.revision, 2); assert.equal(r.context.review.canApprove, true); assert.equal(r.context.review.canReject, true);
    assert.equal(r.context.canApprove, action === "approve"); assert.equal(r.context.canReject, action === "reject");
    assert.deepEqual(p.delegatedRevisionsCommandForContext(r, f.command), f.command); assert(Object.isFrozen(r.context.review));
    assert.throws(() => p.delegatedRevisionsCommandForContext(r, { ...f.command, action: action === "approve" ? "reject" : "approve" }));
    for (const patch of [{ expectedRevision: 1 }, { expectedEvidence: "d".repeat(32) }, { expectedBaseOperationId: id(999) }]) assert.throws(() => p.delegatedRevisionsCommandForContext(r, { ...f.command, ...patch }));
  }
});

test("208 context rejects other worker/employee/self, leaked locations, history and altered old parser facts", async () => {
  for (const mutate of [
    (v: p.DelegatedRevisionsContextResult) => { Reflect.set(v, "scope", { ...v.scope, workerId: id(999) }); },
    (v: p.DelegatedRevisionsContextResult) => { Reflect.set(v, "scope", { ...v.scope, employeeId: id(999) }); },
    (v: p.DelegatedRevisionsContextResult) => { Reflect.set(v, "scope", { ...v.scope, employeeAuthUserId: v.actorId }); },
    (v: p.DelegatedRevisionsContextResult) => { Reflect.set(v, "scope", { ...v.scope, locationIds: [id(999)] }); },
    (v: p.DelegatedRevisionsContextResult) => { Reflect.set(v, "context", { ...v.context, canReject: true }); },
    (v: p.DelegatedRevisionsContextResult) => { v.context.review.writeEnabled = false; v.context.review.canApprove = false; v.context.review.canReject = false; },
    (v: p.DelegatedRevisionsContextResult) => { v.context.review.current.workedUs++; },
  ]) {
    const f = delegatedRevisionFixture(), raw = structuredClone(f.context); mutate(raw); await assert.rejects(p.parseDelegatedRevisionsResult(raw, f.query, f.actor));
  }
  const f = delegatedRevisionFixture(); await assert.rejects(p.parseDelegatedRevisionsResult(f.context, f.query, id(999)));
  await assert.rejects(p.parseDelegatedRevisionsResult({ ...f.context, protocol: "revision-decision-v1" }, f.query, f.actor));
});

test("208 minimal receipts bind original actual actor/grant/op/full H, exact references and real effect/no-effect", async () => {
  for (const action of ["approve", "reject"] as const) {
    const f = delegatedRevisionFixture(action), q: p.DelegatedRevisionsQuery = { siteId: f.query.siteId, grantId: f.query.grantId, mode: "recover", operationId: f.command.operationId };
    assert.deepEqual(await p.parseDelegatedRevisionsResult(f.result, q, f.actor, f.command), f.result);
    assert.deepEqual(await p.parseDelegatedRevisionsResult({ ...f.result, receipt: null }, q, f.actor, f.command), { ...f.result, receipt: null });
    if (f.result.kind !== "receipt" || !f.result.receipt) assert.fail();
    for (const patch of [{ actorId: id(999) }, { grantId: id(999) }, { operationId: id(999) }, { commandFingerprint: "c".repeat(64) }, { businessFingerprint: "bad" }, { reason: "leaked" }])
      await assert.rejects(p.parseDelegatedRevisionsResult({ ...f.result, receipt: { ...f.result.receipt, ...patch } }, q, f.actor, f.command));
    for (const patch of [{ requestId: id(999) }, { requestRevision: 1 }, { baseOperationId: id(999) }, { effectRevision: action === "approve" ? null : 3 }, { decisionRevision: 3 }])
      await assert.rejects(p.parseDelegatedRevisionsResult({ ...f.result, receipt: { ...f.result.receipt, reference: { ...f.result.receipt.reference, ...patch } } }, q, f.actor, f.command));
    await assert.rejects(p.parseDelegatedRevisionsResult({ ...f.result, receipt: null }, f.query, f.actor, f.command));
  }
});

test("208 strict byte/tree/duplicate/descriptor boundary is detached before async digest", async () => {
  const f = delegatedRevisionFixture();
  assert.throws(() => p.parseDelegatedRevisionsJson('{"query":{},"\\u0071uery":{}}'));
  assert.throws(() => p.parseDelegatedRevisionsJson(" ".repeat(p.DELEGATED_REVISIONS_REQUEST_BYTES) + "{}"));
  assert.throws(() => p.parseDelegatedRevisionsCommand({ ...f.command, reason: "x".repeat(4096) }));
  assert.throws(() => p.parseDelegatedRevisionsCommand(Object.defineProperty({ ...f.command }, "reason", { get: () => assert.fail() })));
  const q: p.DelegatedRevisionsQuery = { siteId: f.query.siteId, grantId: f.query.grantId, mode: "recover", operationId: f.command.operationId };
  const original = structuredClone(f.result), pending = p.parseDelegatedRevisionsResult(original, q, f.actor, f.command);
  if (original.kind === "receipt" && original.receipt) Reflect.set(original.receipt, "commandFingerprint", "x".repeat(64));
  assert.deepEqual(await pending, f.result);
  await assert.rejects(p.parseDelegatedRevisionsResult({ ...f.result, extra: "x".repeat(p.DELEGATED_REVISIONS_RESULT_BYTES) }, q, f.actor));
});
