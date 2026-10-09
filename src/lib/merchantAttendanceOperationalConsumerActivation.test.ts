import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { operationalRuleLedgerEncode } from "./merchantAttendanceOperationalRuleLedger";
import { parseOperationalConsumerActivationBody, parseOperationalConsumerActivationQuery, parseOperationalConsumerActivationHttpQuery, parseOperationalConsumerActivationJson,
  parseOperationalConsumerActivationResult, operationalConsumerActivationCommandFingerprint, type OperationalConsumerActivationQuery } from "./merchantAttendanceOperationalConsumerActivation";
import * as f from "./merchantAttendanceOperationalConsumerActivationTestFixtures";

test("194/198 consumer is part of exact scope and hash; only implemented consumers can activate", async () => {
  const c = f.activationCommand();
  for (const consumer of ["review_routing", "timesheet_cycle", "reminders"] as const) {
    const q = { ...f.activationQuery, consumer }, changed = { ...c, consumer };
    assert.notEqual(await operationalConsumerActivationCommandFingerprint(changed, f.activationActor), await operationalConsumerActivationCommandFingerprint(c, f.activationActor));
    assert.throws(() => parseOperationalConsumerActivationBody({ query: q, command: c }));
    assert.equal((await parseOperationalConsumerActivationResult({ ...f.activationResult(), consumer }, q, f.activationActor)).canActivate, true);
    assert.equal((await parseOperationalConsumerActivationResult({ ...f.activationResult(null, null, false), consumer }, q, f.activationActor)).canActivate, false);
  }
  for (const consumer of ["application_window\n", "all", null]) assert.throws(() => parseOperationalConsumerActivationQuery({ ...f.activationQuery, consumer }));
});

test("201 reminder activation validates its own current state and full saved receipt without granting recovery CAS", async () => {
  const query = { ...f.activationQuery, consumer: "reminders" as const }, command = { ...f.activationCommand(), consumer: "reminders" as const },
    item = await f.activationItem(command), saved = { ...await f.activationSaved(command), consumer: "reminders" as const };
  assert.equal((await parseOperationalConsumerActivationResult({ ...f.activationResult(), consumer: "reminders" }, query, f.activationActor)).canActivate, true);
  assert.deepEqual(await parseOperationalConsumerActivationResult(saved, query, f.activationActor, command), saved);
  const recovery = { ...query, mode: "recover" as const, operationId: command.operationId }, result = { ...f.activationResult(null, item, false), consumer: "reminders" as const };
  assert.deepEqual(await parseOperationalConsumerActivationResult(result, recovery, f.activationActor), result);
  for (const changed of [{ ...result, canActivate: true }, { ...result, canDeactivate: true }, { ...result, current: item },
    { ...saved, receipt: { ...item, consumer: "application_window" } }])
    await assert.rejects(parseOperationalConsumerActivationResult(changed, recovery, f.activationActor));
  await assert.rejects(parseOperationalConsumerActivationResult({ ...f.activationResult(item, null, false), consumer: "reminders", canActivate: true }, query, f.activationActor));
});
test("194 activation exact command and query reject extra fields, getters, duplicate URLs and unsafe numbers", () => {
  assert.deepEqual(parseOperationalConsumerActivationBody({ query: f.activationQuery, command: f.activationCommand() }).command, f.activationCommand());
  let reads = 0; assert.throws(() => parseOperationalConsumerActivationQuery({ siteId: f.activationSite, consumer: "application_window", get mode() { reads++; return "current"; } })); assert.equal(reads, 0);
  for (const query of [{ ...f.activationQuery, operationId: f.activationId(2) }, { ...f.activationQuery, siteId: f.activationSite + "\n" }, { siteId: f.activationSite, consumer: "application_window", mode: "recover", operationId: f.activationId(10) }]) assert.throws(() => parseOperationalConsumerActivationBody({ query, command: f.activationCommand() }));
  for (const expectedRevision of [-0, -1, 9007199254740990, 1.2]) assert.throws(() => parseOperationalConsumerActivationBody({ query: f.activationQuery, command: { ...f.activationCommand(), expectedRevision } }));
  for (const suffix of ["&mode=current", "#", "&unexpected=1"]) assert.throws(() => parseOperationalConsumerActivationHttpQuery("https://example.invalid/?siteId=99990001&consumer=application_window&mode=current" + suffix));
  assert.throws(() => parseOperationalConsumerActivationQuery({ siteId: f.activationSite, consumer: "application_window", mode: "recover", operationId: f.activationId(10) + "\n" }));
});
test("194 activation reasons retain exact Unicode and reject trimmed/control/oversize forms", () => {
  for (const reason of ["", " x", "x ", "x\u0000", "x\u0085", "\ud800", "中".repeat(201)]) assert.throws(() => parseOperationalConsumerActivationBody({ query: f.activationQuery, command: { ...f.activationCommand(), reason } }));
  assert.throws(() => parseOperationalConsumerActivationJson('{"siteId":"a","siteId":"b"}', true)); assert.throws(() => parseOperationalConsumerActivationJson("中".repeat(8192), true));
});
test("194 activation fingerprint matches independent PG-style exact tuple", async () => {
  const c = f.activationCommand(), tuple = ["attendance-operational-consumer-activation-command-v1", c.siteId, c.consumer, f.activationActor, [c.operationId, c.action, c.expectedRevision, c.reason]];
  assert.equal(await operationalConsumerActivationCommandFingerprint(c, f.activationActor), createHash("sha256").update(operationalRuleLedgerEncode(tuple)).digest("hex"));
  assert.notEqual(await operationalConsumerActivationCommandFingerprint(c, f.activationId(2)), await operationalConsumerActivationCommandFingerprint(c, f.activationActor));
});
test("194 activation current permits only matching state actions; absent state means off", async () => {
  const empty = await parseOperationalConsumerActivationResult(f.activationResult(), f.activationQuery, f.activationActor); assert.equal(empty.current, null); assert.equal(empty.canActivate, true);
  const item = await f.activationItem(); await parseOperationalConsumerActivationResult(f.activationResult(item), f.activationQuery, f.activationActor);
  for (const r of [{ ...f.activationResult(item), canActivate: true }, { ...empty, canDeactivate: true }, { ...empty, receipt: item }, { ...empty, actorId: f.activationId(2) }]) await assert.rejects(parseOperationalConsumerActivationResult(r, f.activationQuery, f.activationActor));
  await assert.rejects(parseOperationalConsumerActivationResult({ ...empty, readAt: f.activationAt + "\n" }, f.activationQuery, f.activationActor));
});
test("194 activation saved and recovery receipts validate full command hash and cannot confer CAS", async () => {
  const c = f.activationCommand(), saved = await f.activationSaved(c), q: OperationalConsumerActivationQuery = { siteId: c.siteId, consumer: c.consumer, mode: "recover", operationId: c.operationId };
  assert.deepEqual(await parseOperationalConsumerActivationResult(saved, f.activationQuery, f.activationActor, c), saved);
  await parseOperationalConsumerActivationResult(f.activationResult(null, saved.receipt, false), q, f.activationActor);
  for (const r of [{ ...saved, canActivate: true }, { ...saved, receipt: { ...saved.receipt!, reason: "改动" } }, { ...saved, readAt: "2026-10-08T12:00:00.123455Z" }]) await assert.rejects(parseOperationalConsumerActivationResult(r, f.activationQuery, f.activationActor, c));
  await assert.rejects(parseOperationalConsumerActivationResult(saved, q, f.activationActor)); await assert.rejects(parseOperationalConsumerActivationResult(saved, f.activationQuery, f.activationActor, { ...c, reason: "不同请求" }));
});
test("194 activation async receipt parsing owns all fields before digest", async t => {
  const saved = await f.activationSaved(), raw = { ...saved, current: saved.current ? { ...saved.current } : null }, expected = structuredClone(raw), digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { if (first) { first = false; await Promise.resolve(); raw.current!.operationId = f.activationId(999); raw.canActivate = true; } return digest(...args); });
  assert.deepEqual(await parseOperationalConsumerActivationResult(raw, f.activationQuery, f.activationActor, f.activationCommand()), expected); assert.equal(Object.isFrozen(raw), false);
});

