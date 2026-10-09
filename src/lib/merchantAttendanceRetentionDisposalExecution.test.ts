import assert from "node:assert/strict";
import test from "node:test";
import { disposalActor, disposalAt, disposalSite, disposalId as id, disposalBasis, disposalPreview, disposalApprove, disposalQuery, disposalReceipt, disposalResult } from "../../scripts/fixtures/attendance-retention-disposal-execution-model";
import { parseDisposalExecutionQuery as query, parseDisposalExecutionCommand as command, disposalExecutionQueryString, parseDisposalExecutionHttpQuery,
  parseDisposalExecutionBody, parseDisposalExecutionJson, parseDisposalTrustedPreview as preview, parseDisposalExecutionResult as result,
  disposalExecutionCommandFingerprint as fingerprint, disposalExecutionReceiptMatches } from "./merchantAttendanceRetentionDisposalExecution";

test("single-record query and commands reject bulk fields, raw precision and forged scope", async () => {
  const q = disposalQuery(), c = await disposalApprove();
  assert.deepEqual(parseDisposalExecutionHttpQuery("https://faolla.test/?" + disposalExecutionQueryString(q)), q);
  assert.deepEqual(parseDisposalExecutionBody({ query: q, command: c }).command, c);
  for (const patch of [{ eventId: null }, { operationId: id(9) }, { mode: "execute" }, { afterId: id(9) }]) assert.throws(() => query({ ...q, ...patch }));
  for (const patch of [{ fields: ["captured_at"] }, { fields: [...(c.action === "approve" ? c.fields : []), "reason"] }, { eventId: id(9) }, { accuracyMeters: 1 }, { reason: "" }]) assert.throws(() => command(q, { ...c, ...patch }));
  assert.throws(() => command({ siteId: disposalSite, mode: "recover", eventId: null, operationId: c.operationId }, c));
  for (const suffix of ["&siteId=99990198", "#x", "%zz"]) assert.throws(() => parseDisposalExecutionHttpQuery("https://faolla.test/?" + disposalExecutionQueryString(q) + suffix));
  assert.throws(() => parseDisposalExecutionJson('{"query":{},"query":{},"command":{}}', "request"));
});
test("trusted metadata has independently reproducible hashes and exposes no disposed values", async () => {
  const p = await disposalPreview(), parsed = await preview(p); assert.deepEqual(parsed, p);
  const c = await disposalApprove(), receipt = await disposalReceipt(c); assert.equal(await fingerprint(disposalSite, disposalActor, c), receipt.commandFingerprint);
  for (const key of ["capturedAt", "accuracyMeters", "distanceMeters", "sourceText", "canExecute", "authorityChecked"]) assert.equal(Object.hasOwn(parsed, key), false);
  assert.equal(parsed.candidateState, "candidate"); assert(Object.isFrozen(parsed.basis) && Object.isFrozen(parsed.coverage));
});
test("coverage and all dependency/policy/hold blockers remain bound to the final preview fingerprint", async () => {
  const p = await disposalPreview(disposalBasis(), { eventCovered: false, artifactsComplete: true, artifactLimitExceeded: false, alreadyDisposed: false });
  assert.deepEqual((await preview(p)).blockers, ["dependency_coverage_unknown"]);
  for (const patch of [{ blockers: [] }, { candidateState: "candidate" }, { coverage: { ...p.coverage, eventCovered: true } }, { previewFingerprint: "f".repeat(64) }, { policyFingerprint: "f".repeat(64) }]) await assert.rejects(preview({ ...p, ...patch }));
  const b = structuredClone(disposalBasis()); Object.assign(b.dependencies.artifacts, { coverage: "over_limit" });
  const over = await disposalPreview(b, { eventCovered: true, artifactsComplete: true, artifactLimitExceeded: true, alreadyDisposed: false });
  assert.deepEqual((await preview(over)).blockers, ["artifact_dependencies_incomplete", "artifact_dependency_limit"]);
  await assert.rejects(preview({ ...over, coverage: { ...over.coverage, artifactLimitExceeded: false } }));
});
test("receipt-only approval and execution bind the actual actor, full command and original approval", async () => {
  const q = disposalQuery(), approve = await disposalApprove(), receipt = await disposalReceipt(approve);
  assert.equal((await result(disposalResult({ kind: "receipt", receipt }), q, disposalActor, approve)).data.kind, "receipt");
  assert(disposalExecutionReceiptMatches(receipt, disposalSite, disposalActor, approve, await fingerprint(disposalSite, disposalActor, approve)));
  const execute = { action: "execute" as const, operationId: id(8), eventId: q.eventId, approvalOperationId: approve.operationId };
  const done = await disposalReceipt(execute); assert.equal((await result(disposalResult({ kind: "receipt", receipt: done }), q, disposalActor, execute)).data.kind, "receipt");
  for (const patch of [{ actorId: id(9) }, { approvalOperationId: id(9) }, { operationId: id(9) }, { commandFingerprint: "e".repeat(64) }]) await assert.rejects(result(disposalResult({ kind: "receipt", receipt: { ...done, ...patch } }), q, disposalActor, execute));
  await assert.rejects(result(disposalResult({ kind: "receipt", receipt: null }), q, disposalActor, execute));
});
test("GET unknown receipt remains null and cannot prove execution failure or accept a write command", async () => {
  const c = await disposalApprove(), q = { siteId: disposalSite, mode: "recover" as const, eventId: null, operationId: c.operationId };
  const unknown = await result(disposalResult({ kind: "receipt", receipt: null }), q, disposalActor); assert.equal(unknown.data.kind, "receipt");
  await assert.rejects(result(disposalResult({ kind: "receipt", receipt: null }), q, disposalActor, c));
  await assert.rejects(result(disposalResult({ kind: "preview", preview: await disposalPreview() }), q, disposalActor));
});
test("preview and response are detached before hashing yields, and malicious getters are never invoked", async () => {
  const p = await disposalPreview(), expected = structuredClone(p), pending = preview(p);
  Object.assign(p.coverage, { eventCovered: false }); Object.assign(p.basis.policy, { retentionDays: 20 });
  assert.deepEqual(await pending, expected);
  let calls = 0; const bad = { ...expected }; Object.defineProperty(bad, "basis", { enumerable: true, get() { calls++; return expected.basis; } });
  await assert.rejects(preview(bad)); assert.equal(calls, 0);
  const badCommand = { ...await disposalApprove() }; Object.defineProperty(badCommand, "eventId", { enumerable: true, get() { calls++; return id(2); } });
  await assert.rejects(fingerprint(disposalSite, disposalActor, badCommand));
  assert.equal(disposalExecutionReceiptMatches(await disposalReceipt(), disposalSite, disposalActor, badCommand, "a".repeat(64)), false); assert.equal(calls, 0);
  const good = disposalResult({ kind: "preview", preview: expected }), reading = result(good, disposalQuery(), disposalActor);
  good.actorId = id(99); assert.equal((await reading).actorId, disposalActor);
  await assert.rejects(result({ ...good, actorId: disposalActor, readAt: "2026-10-08T12:00:00.123455Z" }, disposalQuery(), disposalActor));
  assert.equal(expected.asOf, disposalAt);
});
