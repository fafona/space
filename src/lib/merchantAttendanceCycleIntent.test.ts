import assert from "node:assert/strict";
import test from "node:test";
import { cycleIntentCommandFingerprint, cycleIntentQueryString, parseCycleIntentBody, parseCycleIntentBodyJson,
  parseCycleIntentCommand, parseCycleIntentHttpQuery, parseCycleIntentQuery, type CycleIntentAccept, type CycleIntentQuery } from "./merchantAttendanceCycleIntent";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { siteId: "99990200", access: "owner" as const, workerId: id(1), grantId: null };
const query: CycleIntentQuery = { ...scope, mode: "detail", intentId: id(2) };
const accept: CycleIntentAccept = { action: "accept", operationId: id(2), intentId: id(2), anchorDate: "2026-10-08", fromDate: "2026-10-05", throughDate: "2026-10-11",
  employeeId: id(3), employeeAuthUserId: id(4), expectedWorkerVersion: 1, expectedEmployeeVersion: 2, expectedSettingsVersion: 3, expectedActivationRevision: 1,
  expectedPreparationFingerprint: "a".repeat(64), expectedFrameRevision: 0, expectedFrameHeadOperationId: null, reason: "明确采用完整周期" };
test("200 exact scope/modes roundtrip without self send authority", () => {
  for (const q of [{ ...scope, mode: "prepare", anchorDate: "2026-10-08" }, { ...scope, mode: "list", cursor: null }, query,
    { ...scope, mode: "recover", intentId: id(2), operationId: id(5) }, { ...scope, access: "delegate", grantId: id(6), mode: "list", cursor: id(7) }] as const) {
    assert.deepEqual(parseCycleIntentHttpQuery("https://www.faolla.com/path?" + cycleIntentQueryString(q)), q); assert(Object.isFrozen(parseCycleIntentQuery(q)));
  }
  for (const q of [{ ...query, access: "self" }, { ...query, grantId: id(6) }, { ...query, access: "delegate" }, { ...query, actorId: id(7) }, { ...scope, mode: "send" }]) assert.throws(() => parseCycleIntentQuery(q));
});
test("200 accept binds exact identity/range/source plus independent frame CAS", () => {
  const result = parseCycleIntentBody({ query, command: accept }); assert.deepEqual(result.command, accept); assert(Object.isFrozen(result.command));
  const second = { ...accept, expectedFrameRevision: 2, expectedFrameHeadOperationId: id(9) }; assert.deepEqual(parseCycleIntentCommand(second, query), second);
  for (const command of [{ ...accept, intentId: id(8) }, { ...accept, operationId: id(8) }, { ...accept, anchorDate: "2026-10-12" },
    { ...accept, fromDate: "2026-09-01" }, { ...accept, expectedFrameRevision: 1 }, { ...accept, expectedFrameHeadOperationId: id(8) },
    { ...accept, expectedActivationRevision: 0 }, { ...accept, expectedWorkerVersion: -0 }, { ...accept, source: {} }, { ...accept, reason: " 空格" }]) assert.throws(() => parseCycleIntentCommand(command, query));
  assert.throws(() => parseCycleIntentCommand(accept, { ...scope, mode: "prepare", anchorDate: "2026-10-08" }));
});
test("200 cancel is a new original operation against exact accepted head, never deletion", () => {
  const command = { action: "cancel", operationId: id(5), intentId: id(2), expectedRevision: 1, expectedHeadOperationId: id(2), expectedIntentFingerprint: "b".repeat(64), reason: "取消未送审计划" };
  assert.deepEqual(parseCycleIntentCommand(command, query), command);
  for (const c of [{ ...command, operationId: id(2) }, { ...command, expectedRevision: 2 }, { ...command, expectedHeadOperationId: id(5) }, { ...command, action: "link" }]) assert.throws(() => parseCycleIntentCommand(c, query));
});
test("200 request JSON/URL rejects duplicate and escaped duplicate keys, fragments, extra fields and byte overflow", () => {
  const text = JSON.stringify({ query, command: accept }); assert.deepEqual(parseCycleIntentBodyJson(text), { query, command: accept });
  for (const value of [text.replace('"query":', '"query":{},"query":'), text.replace('"action":', '"\\u0061ction":"cancel","action":'), text.replace('明确采用完整周期', '\\ud800'), '中'.repeat(3000)]) assert.throws(() => parseCycleIntentBodyJson(value));
  const url = "https://www.faolla.com/?" + cycleIntentQueryString(query);
  for (const value of [url + "&siteId=99990200", url + "#fragment", url + "#", url + "&grantId=null", url + "&x=1"]) assert.throws(() => parseCycleIntentHttpQuery(value));
});
test("200 getters never run and hashing owns original query/command before digest yields", async t => {
  let reads = 0; assert.throws(() => parseCycleIntentBody({ query, get command() { reads++; return accept; } }));
  assert.throws(() => parseCycleIntentCommand({ ...accept, get reason() { reads++; return "private"; } }, query)); assert.equal(reads, 0);
  const q = { ...query }, c = { ...accept }, digest = crypto.subtle.digest.bind(crypto.subtle);
  const expected = await cycleIntentCommandFingerprint(q, c, id(10));
  const mock = t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { c.reason = "later mutation"; q.workerId = id(11); return digest(...args); });
  assert.equal(await cycleIntentCommandFingerprint(q, c, id(10)), expected); mock.mock.restore();
});
test("200 canonical command SHA binds actor, actual grant, complete frame CAS and every intent field", async () => {
  const base = await cycleIntentCommandFingerprint(query, accept, id(10)); assert.match(base, /^[a-f0-9]{64}$/);
  assert.notEqual(await cycleIntentCommandFingerprint(query, accept, id(11)), base);
  assert.notEqual(await cycleIntentCommandFingerprint({ ...query, access: "delegate", grantId: id(6) }, accept, id(10)), base);
  for (const c of [{ ...accept, reason: "另一个原因" }, { ...accept, expectedEmployeeVersion: 3 }, { ...accept, expectedFrameRevision: 2, expectedFrameHeadOperationId: id(9) },
    { ...accept, expectedPreparationFingerprint: "b".repeat(64) }, { ...accept, throughDate: "2026-10-12" }, { ...accept, employeeAuthUserId: id(12) }]) assert.notEqual(await cycleIntentCommandFingerprint(query, c, id(10)), base);
});
