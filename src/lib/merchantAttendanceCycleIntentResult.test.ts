import test from "node:test";
import assert from "node:assert/strict";
import { parseCycleIntentResult, parseCycleIntentResponse, parseCycleIntentResultJson } from "./merchantAttendanceCycleIntentResult";
import { cycleIntentCommandFingerprint } from "./merchantAttendanceCycleIntent";
import { cycleModel, cycleOwner, cycleId } from "../../scripts/fixtures/attendance-cycle-intent-model";
test("200 SQL preparation is strictly projected and browser revalidates its saved source", async () => {
  const f = await cycleModel(), q = { ...f.scope, mode: "prepare" as const, anchorDate: f.command.anchorDate };
  const result = await parseCycleIntentResult(f.result({ kind: "preparation", source: f.source, anchorDate: q.anchorDate, activation: { revision: 1, active: true }, frameHead: { revision: 0, lastOperationId: null } }), q, cycleOwner, null, "sql");
  assert.equal(result.data.kind, "preparation"); assert.deepEqual((await parseCycleIntentResponse({ ok: true, data: result }, q, cycleOwner)).data, result);
  if (result.data.kind !== "preparation") throw Error(); assert.equal(result.data.preparation.authorityChecked, false); assert(Object.isFrozen(result.data.source));
  for (const patch of [{ frameHead: null }, { frameHead: { revision: 0, lastOperationId: cycleId(8) } }, { preparation: { ...result.data.preparation, applied: true } }])
    await assert.rejects(parseCycleIntentResult(f.result({ ...result.data, ...patch }), q, cycleOwner));
});
test("200 saved detail recomputes source, preparation, full command and intent digests", async () => {
  const f = await cycleModel(), result = await parseCycleIntentResult(f.result({ kind: "detail", intent: f.intent, head: f.receipt }), f.query, cycleOwner);
  assert.equal(result.data.kind, "detail"); assert(Object.isFrozen(result.data));
  for (const patch of [{ intentFingerprint: "f".repeat(64) }, { dueAt: "2026-10-12T22:00:00.000000Z" }, { employeeAuthUserId: cycleId(20) },
    { acceptCommand: { ...f.command, expectedWorkerVersion: 3 } }, { preparation: { ...f.preparation, authorityChecked: true } }, { source: { ...f.source, sourceFingerprint: "b".repeat(64) } }])
    await assert.rejects(parseCycleIntentResult(f.result({ kind: "detail", intent: { ...f.intent, ...patch }, head: f.receipt }), f.query, cycleOwner));
});
test("200 explicit current owner cancellation does not rewrite the original accepting actor", async () => {
  const f = await cycleModel(), newOwner = cycleId(91), head = { ...f.receipt, action: "cancel", operationId: cycleId(11), actorId: newOwner, revision: 2, recordedAt: "2026-10-08T12:00:00.123457Z" };
  const value = await parseCycleIntentResult(f.result({ kind: "detail", intent: f.intent, head }, null, newOwner), f.query, newOwner);
  if (value.data.kind !== "detail") throw Error(); assert.equal(value.data.intent.actorId, cycleOwner); assert.equal(value.data.head.actorId, newOwner);
  await assert.rejects(parseCycleIntentResult(f.result({ kind: "detail", intent: f.intent, head: { ...head, revision: 1 } }, null, newOwner), f.query, newOwner));
});
test("200 matching POST and original GET receipt require original actor and complete command SHA", async () => {
  const f = await cycleModel(), wire = f.result({ kind: "receipt" }, f.receipt);
  assert.equal((await parseCycleIntentResult(wire, f.query, cycleOwner, f.command)).receipt!.operationId, f.command.operationId);
  const q = { ...f.scope, mode: "recover" as const, intentId: f.query.intentId, operationId: f.command.operationId };
  await parseCycleIntentResult(wire, q, cycleOwner);
  const unknown = await parseCycleIntentResult(f.result({ kind: "receipt" }), q, cycleOwner); assert.equal(unknown.receipt, null);
  for (const r of [{ ...f.receipt, actorId: cycleId(91) }, { ...f.receipt, commandFingerprint: "f".repeat(64) }, { ...f.receipt, periodId: cycleId(30) }, null])
    await assert.rejects(parseCycleIntentResult(f.result({ kind: "receipt" }, r), f.query, cycleOwner, f.command));
  const c = { action: "cancel" as const, operationId: cycleId(11), intentId: f.query.intentId, expectedRevision: 1 as const, expectedHeadOperationId: f.query.intentId, expectedIntentFingerprint: f.intent.intentFingerprint, reason: "Synthetic200 cancellation" };
  const r = { ...f.receipt, action: c.action, operationId: c.operationId, revision: 2, commandFingerprint: await cycleIntentCommandFingerprint(f.query, c, cycleOwner) };
  await parseCycleIntentResult(f.result({ kind: "receipt" }, r), f.query, cycleOwner, c);
});
test("200 list is ascending exclusive 25+1 keyset, not an unbounded history", async () => {
  const f = await cycleModel(), q = { ...f.scope, mode: "list" as const, cursor: null };
  const items = Array.from({ length: 25 }, (_, n) => { const intentId = cycleId(100 + n), { workerId: _worker, source: _source, preparation: _prep, acceptCommand: _c, recordedAt: _at, ...item } = f.intent;
    void _worker; void _source; void _prep; void _c; void _at; return { ...item, intentId, head: { ...f.receipt, intentId, operationId: intentId } }; });
  const data = { kind: "list", items, nextCursor: items.at(-1)!.intentId };
  await parseCycleIntentResult(f.result(data), q, cycleOwner);
  for (const changed of [{ ...data, nextCursor: cycleId(888) }, { ...data, items: [...items, items[0]] }, { ...data, items: [...items].reverse() }])
    await assert.rejects(parseCycleIntentResult(f.result(changed), q, cycleOwner));
  await assert.rejects(parseCycleIntentResult(f.result(data), { ...q, cursor: items[0].intentId }, cycleOwner));
});
test("200 descriptor/JSON/budget corruption cannot become a verified receipt", async () => {
  const f = await cycleModel(); let calls = 0;
  await assert.rejects(parseCycleIntentResult(f.result({ kind: "detail", intent: { ...f.intent, get source() { calls++; return f.source; } }, head: f.receipt }), f.query, cycleOwner));
  assert.equal(calls, 0); assert.throws(() => parseCycleIntentResultJson('{"a":1,"a":2}')); assert.throws(() => parseCycleIntentResultJson(" ".repeat(524289)));
  await assert.rejects(parseCycleIntentResult(f.result({ kind: "detail", intent: { ...f.intent, extra: true }, head: f.receipt }), f.query, cycleOwner));
});
test("200 snapshot owns nested source before asynchronous digest validation", async t => {
  const f = await cycleModel(), wire = f.result({ kind: "detail", intent: structuredClone(f.intent), head: f.receipt });
  const digest = crypto.subtle.digest.bind(crypto.subtle); let once = false;
  const mock = t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { if (!once) { once = true; assert(Reflect.set(wire.data.intent.acceptCommand, "reason", "Caller mutation")); assert(Reflect.set(wire.data.intent.preparation, "authorityChecked", true)); } return digest(...args); });
  const result = await parseCycleIntentResult(wire, f.query, cycleOwner); mock.mock.restore();
  if (result.data.kind !== "detail") throw Error(); assert.equal(result.data.intent.acceptCommand.reason, f.command.reason); assert.equal(result.data.intent.preparation.authorityChecked, false);
});
