//Service doubles only: ZERO SQL/Auth/old decision writes or business proof.
import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import * as p from "./merchantAttendanceDelegatedRevisions";
import { createDelegatedRevisionsService, delegatedRevisionsSiteEnabled } from "./merchantAttendanceDelegatedRevisions.server";
import { revisionApprovalResponse } from "../../scripts/fixtures/attendance-revision-approval-model";
import { correctionId as id } from "../../scripts/fixtures/attendance-correction-model";

async function fixture(action: "approve" | "reject" = "approve") {
  const review = revisionApprovalResponse(), app = review.review.review.application, actor = id(890), grantId = id(891);
  const query: p.DelegatedRevisionsContextQuery = { siteId: review.siteId, grantId, mode: "context", requestId: review.requestId };
  const command: p.DelegatedRevisionsCommand = { action, operationId: id(892), requestId: review.requestId, expectedRevision: review.review.submittedRevision,
    expectedEvidence: review.evidenceToken, expectedBaseOperationId: review.review.base.operationId, reason: "合成受托核验" };
  const scope: p.DelegatedRevisionsScope = { kind: "revision", workerId: app.workerId, employeeId: app.employeeId, employeeAuthUserId: id(893),
    locationIds: [...new Set(app.basis.events.map(e => e.locationId))].sort(), includePending: false };
  const context: p.DelegatedRevisionsContextResult = { protocol: p.DELEGATED_REVISIONS_PROTOCOL, siteId: query.siteId, actorId: actor, readAt: review.asOf,
    kind: "context", grantId, action: action === "approve" ? "revision_approve" : "revision_reject", scope, context: { review, canApprove: action === "approve", canReject: action === "reject" } };
  const receipt: p.DelegatedRevisionsResult = { protocol: p.DELEGATED_REVISIONS_PROTOCOL, siteId: query.siteId, actorId: actor, readAt: "2026-09-30T14:03:00.000000Z", kind: "receipt",
    receipt: { operationId: command.operationId, actorId: actor, grantId, action: context.action, reference: { kind: "revision", requestId: query.requestId,
      rootRequestId: review.review.base.lineage.rootRequestId, workerId: scope.workerId, employeeId: scope.employeeId, employeeAuthUserId: scope.employeeAuthUserId,
      requestRevision: command.expectedRevision, baseOperationId: command.expectedBaseOperationId, effectRevision: action === "approve" ? 3 : null },
      commandFingerprint: await p.delegatedRevisionsCommandFingerprint(query, actor, command), businessFingerprint: "b".repeat(64), recordedAt: "2026-09-30T14:02:01.000000Z" } };
  const env = { FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_SITE_IDS: query.siteId };
  const recovery: p.DelegatedRevisionsQuery = { siteId: query.siteId, grantId, mode: "recover", operationId: command.operationId };
  return { actor, query, command, context, receipt, recovery, env };
}
type Args = Record<string, unknown>;
const service = (fn: (name: string, args: Args) => Promise<unknown>): AttendanceSelfRpc => ({ rpc: async (name, args) => ({ data: await fn(name, args), error: null }) });
const code = (wanted: string) => (error: unknown) => error instanceof MerchantAttendanceError && error.code === wanted;

test("208 new approve/reject exactly3 RPC: original GET, fresh scoped NULL-command eligibility, actualactor oldcommand write", async () => {
  for (const action of ["approve", "reject"] as const) {
    const f = await fixture(action), calls: Args[] = [];
    const s = createDelegatedRevisionsService(service(async (name, args) => {
      assert.equal(name, p.DELEGATED_REVISIONS_RPC); calls.push(args);
      if (calls.length === 1) return { ...f.receipt, receipt: null }; if (calls.length === 2) return f.context; return f.receipt;
    }), { environment: () => f.env });
    assert.deepEqual(await s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: true }), f.receipt);
    assert.equal(calls.length, 3); assert.deepEqual(calls[0], { p_query: f.recovery, p_auth_user_id: f.actor, p_command: null, p_allow_write: false });
    assert.deepEqual(calls[1], { p_query: f.query, p_auth_user_id: f.actor, p_command: null, p_allow_write: true });
    assert.deepEqual(calls[2], { p_query: f.query, p_auth_user_id: f.actor, p_command: f.command, p_allow_write: true });
  }
});

test("208 original minimal GET and exact secretfree POST replay use1 RPC before flags/access; mismatched H never returns success", async () => {
  const f = await fixture(); let count = 0;
  const s = createDelegatedRevisionsService(service(async () => { count++; return f.receipt; }), { environment: () => assert.fail("original recovery must not inspect rollout") });
  assert.deepEqual(await s.readReceipt({ query: f.recovery, authUserId: f.actor }), f.receipt);
  assert.deepEqual(await s.recover({ query: f.recovery, authUserId: f.actor, expectedCommand: f.command }), f.receipt);
  assert.deepEqual(await s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: false }), f.receipt); assert.equal(count, 3);
  await assert.rejects(s.recover({ query: f.recovery, authUserId: f.actor, expectedCommand: { ...f.command, reason: "不同命令" } }), code("attendance_delegated_revisions_invalid"));
});

test("208 fresh context has explicit defaultoff≤64site gate and actual allowed entitlement; disabled POST only probes original", async () => {
  const f = await fixture(); let calls = 0;
  const s = createDelegatedRevisionsService(service(async () => { calls++; return { ...f.receipt, receipt: null }; }), { environment: () => ({}) });
  await assert.rejects(s.execute({ query: f.query, command: null, authUserId: f.actor, allowWrite: true }), code("attendance_delegated_revisions_disabled")); assert.equal(calls, 0);
  await assert.rejects(s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: false }), code("attendance_delegated_revisions_disabled")); assert.equal(calls, 1);
  assert(delegatedRevisionsSiteEnabled(f.query.siteId, f.env));
  for (const raw of [f.query.siteId + "," + f.query.siteId, " " + f.query.siteId, f.query.siteId + ",", Array.from({ length: 65 }, (_, n) => String(99990000 + n)).join(",")])
    assert(!delegatedRevisionsSiteEnabled(f.query.siteId, { ...f.env, FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_SITE_IDS: raw }));
  assert(!delegatedRevisionsSiteEnabled(f.query.siteId, { ...f.env, FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED: "true" }));
  const read = createDelegatedRevisionsService(service(async (_name, args) => { assert.equal(args.p_command, null); assert.equal(args.p_allow_write, true); return f.context; }), { environment: () => f.env });
  assert.deepEqual(await read.execute({ query: f.query, command: null, authUserId: f.actor, allowWrite: true }), f.context);
});

test("208 before-await snapshot binds query/actor/all7command fields despite caller mutation", async () => {
  const f = await fixture(), raw = { query: structuredClone(f.query), command: structuredClone(f.command), authUserId: f.actor, allowWrite: true };
  let release!: () => void; const wait = new Promise<void>(r => { release = r; }), calls: Args[] = [];
  const s = createDelegatedRevisionsService(service(async (_name, args) => {
    calls.push(args); if (calls.length === 1) { await wait; return { ...f.receipt, receipt: null }; } if (calls.length === 2) return f.context; return f.receipt;
  }), { environment: () => f.env });
  const pending = s.execute(raw); Reflect.set(raw.query, "grantId", id(999)); Reflect.set(raw.command, "reason", "修改后"); raw.authUserId = id(999); raw.allowWrite = false; release();
  assert.deepEqual(await pending, f.receipt); assert.deepEqual(calls[2].p_command, f.command); assert.equal(calls[2].p_auth_user_id, f.actor);
});

test("208 stale evidence/action/identity and changed rollout stop before writer; context grant mask remains strict", async () => {
  const f = await fixture();
  for (const patch of [{ expectedEvidence: "d".repeat(32) }, { expectedRevision: 1 }, { action: "reject" as const }]) {
    let calls = 0; const s = createDelegatedRevisionsService(service(async () => ++calls === 1 ? { ...f.receipt, receipt: null } : f.context), { environment: () => f.env });
    await assert.rejects(s.execute({ query: f.query, command: { ...f.command, ...patch }, authUserId: f.actor, allowWrite: true })); assert.equal(calls, 2);
  }
  let calls = 0, enabled = true;
  const s = createDelegatedRevisionsService(service(async () => { if (++calls === 1) return { ...f.receipt, receipt: null }; enabled = false; return f.context; }), { environment: () => enabled ? f.env : {} });
  await assert.rejects(s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: true }), code("attendance_delegated_revisions_disabled")); assert.equal(calls, 2);
});

test("208 whole deadline/abort prevents late follow-up RPC and conceals unknown SQL errors", async () => {
  const f = await fixture(); let release!: () => void; const wait = new Promise<void>(r => { release = r; }); let calls = 0;
  const s = createDelegatedRevisionsService(service(async () => { calls++; await wait; return { ...f.receipt, receipt: null }; }), { environment: () => f.env, timeoutMs: 15 });
  await assert.rejects(s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: true }), code("attendance_delegated_revisions_invalid")); release();
  await new Promise<void>(r => setImmediate(r)); assert.equal(calls, 1);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(s.readReceipt({ query: f.recovery, authUserId: f.actor }, aborted.signal)); assert.equal(calls, 1);
  const bad: AttendanceSelfRpc = { rpc: async () => ({ data: null, error: { message: "private SQL/body must not escape" } }) };
  await assert.rejects(createDelegatedRevisionsService(bad).readReceipt({ query: f.recovery, authUserId: f.actor }), code("attendance_delegated_revisions_invalid"));
  const known: AttendanceSelfRpc = { rpc: async () => ({ data: null, error: { message: "attendance_management_delegation_changed" } }) };
  await assert.rejects(createDelegatedRevisionsService(known).readReceipt({ query: f.recovery, authUserId: f.actor }), code("attendance_management_delegation_changed"));
});

test("208 malformed commands/extra authority/recover mixing fail before any RPC", async () => {
  const f = await fixture(); const s = createDelegatedRevisionsService(service(async () => assert.fail()), { environment: () => f.env });
  await assert.rejects(s.execute({ query: f.recovery, command: f.command, authUserId: f.actor, allowWrite: true }));
  const malformed = structuredClone(f.command); Reflect.set(malformed, "action", "annul");
  await assert.rejects(s.execute({ query: f.query, command: malformed, authUserId: f.actor, allowWrite: true }));
  const extra = { query: f.query, command: f.command, authUserId: f.actor, allowWrite: true, ownerId: f.actor };
  await assert.rejects(s.execute(extra));
});
