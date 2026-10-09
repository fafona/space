//Pure detached protocol tests. No SQL, real authorization or business proof.
import assert from "node:assert/strict";
import test from "node:test";
import * as p from "./merchantAttendanceDelegatedPlanExceptions";
import { delegatedPlanExceptionsModel as model } from "../../scripts/fixtures/attendance-delegated-plan-exceptions-model";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
test("209 exact context/recover, old7key command and duplicate-safe bytes; no list, owner, payroll or annul", () => {
  const f = model(); assert.deepEqual(p.parseDelegatedPlanExceptionsQuery(f.query), f.query); assert.deepEqual(p.parseDelegatedPlanExceptionsBody({ query: f.query, command: f.command }), { query: f.query, command: f.command });
  assert.deepEqual(p.parseDelegatedPlanExceptionsQuery(Object.fromEntries(new URLSearchParams(p.delegatedPlanExceptionsQueryString(f.recover)))), f.recover);
  for (const patch of [{ mode: "list" }, { ownerId: f.actor }, { operationId: f.command.operationId }, { workerId: "bad" }]) assert.throws(() => p.parseDelegatedPlanExceptionsQuery({ ...f.query, ...patch }));
  for (const patch of [{ action: "annul" }, { outcome: "absent" }, { note: " x " }, { note: "a\nb" }, { expectedRevision: -0 }, { expectedRevision: -1 }, { expectedFingerprint: "a".repeat(63) }, { note: "x".repeat(501) }]) assert.throws(() => p.parseDelegatedPlanExceptionsCommand({ ...f.command, ...patch }));
  assert.throws(() => p.parseDelegatedPlanExceptionsBody({ query: f.recover, command: f.command }));
  assert.throws(() => p.parseDelegatedPlanExceptionsJson('{"query":{},"\\u0071uery":{}}'));
  assert.throws(() => p.parseDelegatedPlanExceptionsJson(" ".repeat(p.DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES) + "{}"));
  assert.throws(() => p.parseDelegatedPlanExceptionsCommand(Object.defineProperty({ ...f.command }, "note", { get: () => assert.fail("never invoke getter") })));
});
test("209 canonical SHA includes real actor, grant, exact worker/slot and every unchanged decision key", async () => {
  const f = model(); if (f.receipt.kind !== "receipt") assert.fail(); const h = await p.delegatedPlanExceptionsCommandFingerprint(f.query, f.actor, f.command);
  assert.equal(h, f.receipt.receipt!.commandFingerprint);
  for (const query of [{ ...f.query, grantId: id(999) }, { ...f.query, workerId: id(998) }, { ...f.query, slotId: id(997) }]) assert.notEqual(await p.delegatedPlanExceptionsCommandFingerprint(query, f.actor, f.command), h);
  for (const command of [{ ...f.command, note: "Different reason" }, { ...f.command, expectedRevision: 1 }, { ...f.command, expectedFingerprint: "c".repeat(64) }]) assert.notEqual(await p.delegatedPlanExceptionsCommandFingerprint(f.query, f.actor, command), h);
});
test("209 strict old174 current source/evidence retained, actual delegate and scope; blocked follow_up remains allowed", async () => {
  for (const eligible of [true, false]) { const f = model(eligible), result = await p.parseDelegatedPlanExceptionsResult(f.context, f.query, f.actor);
    assert.equal(result.kind, "context"); if (result.kind !== "context") assert.fail(); assert.equal(result.context.canConclude, eligible);
    assert.deepEqual(p.delegatedPlanExceptionsCommandForContext(result, f.command), f.command); assert(Object.isFrozen(result.context.review));
    assert.throws(() => p.delegatedPlanExceptionsCommandForContext(result, { ...f.command, expectedRevision: 1 }));
    assert.throws(() => p.delegatedPlanExceptionsCommandForContext(result, { ...f.command, expectedFingerprint: "c".repeat(64) }));
    if (!eligible) assert.throws(() => p.delegatedPlanExceptionsCommandForContext(result, { ...f.command, outcome: "confirmed" }));
  }
  for (const patch of [{ workerId: id(999) }, { employeeId: id(999) }, { employeeAuthUserId: model().actor }, { locationIds: [id(999)] }]) { const f = model(); await assert.rejects(p.parseDelegatedPlanExceptionsResult({ ...f.context, scope: { ...f.context.scope, ...patch } }, f.query, f.actor)); }
  const f = model(); await assert.rejects(p.parseDelegatedPlanExceptionsResult({ ...f.context, context: { ...f.context.context, canClear: true } }, f.query, f.actor));
  await assert.rejects(p.parseDelegatedPlanExceptionsResult({ ...f.context, context: { ...f.context.context, canNotApplicable: true } }, f.query, f.actor));
  await assert.rejects(p.parseDelegatedPlanExceptionsResult(f.context, f.query, id(999)));
});
test("209 minimum original receipt binds all identities/target/H/decision revision, detached before digest", async () => {
  const f = model(); if (f.receipt.kind !== "receipt") assert.fail();
  assert.deepEqual(await p.parseDelegatedPlanExceptionsResult(f.receipt, f.recover, f.actor, f.command), f.receipt);
  assert.deepEqual(await p.parseDelegatedPlanExceptionsResult({ ...f.receipt, receipt: null }, f.recover, f.actor, f.command), { ...f.receipt, receipt: null });
  for (const patch of [{ actorId: id(999) }, { grantId: id(999) }, { operationId: id(999) }, { action: "revision_approve" }, { commandFingerprint: "c".repeat(64) }, { businessFingerprint: "bad" }, { note: "leaked" }]) await assert.rejects(p.parseDelegatedPlanExceptionsResult({ ...f.receipt, receipt: { ...f.receipt.receipt, ...patch } }, f.recover, f.actor, f.command));
  for (const patch of [{ workerId: id(999) }, { slotId: id(999) }, { employeeId: id(999) }, { employeeAuthUserId: id(999) }, { decisionRevision: 2 }, { caseId: id(999) }]) await assert.rejects(p.parseDelegatedPlanExceptionsResult({ ...f.receipt, receipt: { ...f.receipt.receipt, reference: { ...f.receipt.receipt!.reference, ...patch } } }, f.recover, f.actor, f.command));
  assert(f.receipt.receipt); const value = { ...f.receipt, receipt: { ...f.receipt.receipt } }, parsing = p.parseDelegatedPlanExceptionsResult(value, f.recover, f.actor, f.command);
  value.receipt.commandFingerprint = "x".repeat(64); assert.deepEqual(await parsing, f.receipt);
  await assert.rejects(p.parseDelegatedPlanExceptionsResult({ ...f.receipt, receipt: null }, f.query, f.actor, f.command));
});
