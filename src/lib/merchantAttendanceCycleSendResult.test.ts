import assert from "node:assert/strict";
import test from "node:test";
import { cycleSendModel, cycleSendModelId as id } from "../../scripts/fixtures/attendance-cycle-send-model";
import { parseCycleSendResult, parseCycleSendResultJson, parseCycleSendResponse } from "./merchantAttendanceCycleSendResult";
test("200 minimal adoption receipt matches full actual actor, original command and send digest", async () => {
  const f = await cycleSendModel(), r = await parseCycleSendResult(f.linked(), f.frame, f.actor, f.command.operationId, f.fingerprint, f.command);
  assert.equal(r.data.kind, "linked"); assert.equal(r.receipt?.action, "link"); assert(Object.isFrozen(r));
  if (r.data.kind !== "linked") throw Error(); assert.equal(r.data.periodOperation.version, 1); assert(!Object.hasOwn(r, "artifact"));
  const recovered = await parseCycleSendResponse({ ok: true, moduleEnabled: false, data: f.linked() }, f.frame, f.actor, f.command.operationId, f.fingerprint);
  assert.equal(recovered.moduleEnabled, false); assert.deepEqual(recovered.data, r);
});
test("200 original lookup may be unknown; a fresh POST must never accept that as successful", async () => {
  const f = await cycleSendModel(), r = await parseCycleSendResult(f.unknown(), f.frame, f.actor, f.command.operationId, f.fingerprint);
  assert.equal(r.data.kind, "receipt"); assert.equal(r.receipt, null);
  await assert.rejects(parseCycleSendResult(f.unknown(), f.frame, f.actor, f.command.operationId, f.fingerprint, f.command));
  await assert.rejects(parseCycleSendResult({ ...f.unknown(), data: { kind: "linked" } }, f.frame, f.actor, f.command.operationId, f.fingerprint));
});
test("200 mixed receipt, old send, foreign actor, altered reason or forged source do not verify", async () => {
  const f = await cycleSendModel(), b = f.linked();
  const bad = [
    { ...b, actorId: id(10) }, { ...b, siteId: "99999999" }, { ...b, readAt: "2026-10-12T09:00:00.000000Z" },
    { ...b, receipt: { ...b.receipt, periodId: id(11) } }, { ...b, receipt: { ...b.receipt, intentId: id(11) } },
    { ...b, receipt: { ...b.receipt, commandFingerprint: "c".repeat(64) } }, { ...b, receipt: { ...b.receipt, revision: 1 } },
    { ...b, receipt: { ...b.receipt, action: "accept" } }, { ...b, receipt: { ...b.receipt, recordedAt: "2026-10-12T10:00:00.123455Z" } },
    { ...b, data: { ...b.data, periodOperation: { ...b.data.periodOperation, revision: 2 } } },
    { ...b, data: { ...b.data, periodOperation: { ...b.data.periodOperation, actorId: id(10) } } },
    { ...b, data: { ...b.data, periodOperation: { ...b.data.periodOperation, reason: "other", command: { ...f.command, reason: "other" } } } },
    { ...b, data: { ...b.data, periodOperation: { ...b.data.periodOperation, command: { ...f.command, expectedFingerprint: "c".repeat(64) } } } },
  ];
  for (const raw of bad) await assert.rejects(parseCycleSendResult(raw, f.frame, f.actor, f.command.operationId, f.fingerprint));
  await assert.rejects(parseCycleSendResult(b, f.frame, id(10), f.command.operationId, f.fingerprint));
  await assert.rejects(parseCycleSendResult(b, { ...f.frame, throughDate: "2026-10-12" }, f.actor, f.command.operationId, f.fingerprint));
});
test("200 nested input is owned before hashing and getters, cycles, extra keys and oversized JSON fail", async t => {
  const f = await cycleSendModel(), raw = f.linked(), digest = crypto.subtle.digest.bind(crypto.subtle); let calls = 0;
  await assert.rejects(parseCycleSendResult({ ...raw, get receipt() { calls++; return raw.receipt; } }, f.frame, f.actor, f.command.operationId, f.fingerprint)); assert.equal(calls, 0);
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { raw.data.periodOperation.command.reason = "after yield"; raw.receipt.actorId = id(10); return digest(...args); });
  const result = await parseCycleSendResult(raw, f.frame, f.actor, f.command.operationId, f.fingerprint); assert.equal(result.receipt?.actorId, f.actor);
  if (result.data.kind !== "linked") throw Error(); assert.equal(result.data.periodOperation.command.reason, f.command.reason);
  await assert.rejects(parseCycleSendResult({ ...f.linked(), artifact: {} }, f.frame, f.actor, f.command.operationId, f.fingerprint));
  assert.throws(() => parseCycleSendResultJson('{"a":1,"a":2}')); assert.throws(() => parseCycleSendResultJson(" ".repeat(16385)));
  const cycle: Record<string, unknown> = {}; cycle.cycle = cycle;
  await assert.rejects(parseCycleSendResult(cycle, f.frame, f.actor, f.command.operationId, f.fingerprint));
});
