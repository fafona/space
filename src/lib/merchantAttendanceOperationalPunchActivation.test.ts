import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { operationalRuleLedgerEncode } from "./merchantAttendanceOperationalRuleLedger";
import { parseOperationalPunchActivationBody, parseOperationalPunchActivationQuery, parseOperationalPunchActivationHttpQuery, parseOperationalPunchActivationJson,
  parseOperationalPunchActivationResult, operationalPunchActivationCommandFingerprint, type OperationalPunchActivationQuery } from "./merchantAttendanceOperationalPunchActivation";
import * as f from "./merchantAttendanceOperationalPunchActivationTestFixtures";
test("242 activation exact command and query reject extra fields, getters, duplicate URLs and unsafe numbers", () => {
  assert.deepEqual(parseOperationalPunchActivationBody({ query: f.activationQuery, command: f.activationCommand() }).command, f.activationCommand());
  let reads = 0; assert.throws(() => parseOperationalPunchActivationQuery({ siteId: f.activationSite, get mode() { reads++; return "current"; } })); assert.equal(reads, 0);
  for (const query of [{ ...f.activationQuery, operationId: f.activationId(2) }, { ...f.activationQuery, siteId: f.activationSite + "\n" }, { siteId: f.activationSite, mode: "recover", operationId: f.activationId(10) }]) assert.throws(() => parseOperationalPunchActivationBody({ query, command: f.activationCommand() }));
  for (const expectedRevision of [-0, -1, 9007199254740990, 1.2]) assert.throws(() => parseOperationalPunchActivationBody({ query: f.activationQuery, command: { ...f.activationCommand(), expectedRevision } }));
  for (const suffix of ["&mode=current", "#", "&unexpected=1"]) assert.throws(() => parseOperationalPunchActivationHttpQuery("https://example.invalid/?siteId=99990001&mode=current" + suffix));
  assert.throws(() => parseOperationalPunchActivationQuery({ siteId: f.activationSite, mode: "recover", operationId: f.activationId(10) + "\n" }));
});
test("242 activation reasons retain exact Unicode and reject trimmed/control/oversize forms", () => {
  for (const reason of ["", " x", "x ", "x\u0000", "x\u0085", "\ud800", "中".repeat(201)]) assert.throws(() => parseOperationalPunchActivationBody({ query: f.activationQuery, command: { ...f.activationCommand(), reason } }));
  assert.throws(() => parseOperationalPunchActivationJson('{"siteId":"a","siteId":"b"}', true)); assert.throws(() => parseOperationalPunchActivationJson("中".repeat(8192), true));
});
test("242 activation fingerprint matches independent PG-style exact tuple", async () => {
  const c = f.activationCommand(), tuple = ["attendance-operational-punch-activation-command-v1", c.siteId, f.activationActor, [c.operationId, c.action, c.expectedRevision, c.reason]];
  assert.equal(await operationalPunchActivationCommandFingerprint(c, f.activationActor), createHash("sha256").update(operationalRuleLedgerEncode(tuple)).digest("hex"));
  assert.notEqual(await operationalPunchActivationCommandFingerprint(c, f.activationId(2)), await operationalPunchActivationCommandFingerprint(c, f.activationActor));
});
test("242 activation current permits only matching state actions; absent state means off", async () => {
  const empty = await parseOperationalPunchActivationResult(f.activationResult(), f.activationQuery, f.activationActor); assert.equal(empty.current, null); assert.equal(empty.canActivate, true);
  const item = await f.activationItem(); await parseOperationalPunchActivationResult(f.activationResult(item), f.activationQuery, f.activationActor);
  for (const r of [{ ...f.activationResult(item), canActivate: true }, { ...empty, canDeactivate: true }, { ...empty, receipt: item }, { ...empty, actorId: f.activationId(2) }]) await assert.rejects(parseOperationalPunchActivationResult(r, f.activationQuery, f.activationActor));
  await assert.rejects(parseOperationalPunchActivationResult({ ...empty, readAt: f.activationAt + "\n" }, f.activationQuery, f.activationActor));
});
test("242 activation saved and recovery receipts validate full command hash and cannot confer CAS", async () => {
  const c = f.activationCommand(), saved = await f.activationSaved(c), q: OperationalPunchActivationQuery = { siteId: c.siteId, mode: "recover", operationId: c.operationId };
  assert.deepEqual(await parseOperationalPunchActivationResult(saved, f.activationQuery, f.activationActor, c), saved);
  await parseOperationalPunchActivationResult(f.activationResult(null, saved.receipt, false), q, f.activationActor);
  for (const r of [{ ...saved, canActivate: true }, { ...saved, receipt: { ...saved.receipt!, reason: "改动" } }, { ...saved, readAt: "2026-10-08T12:00:00.123455Z" }]) await assert.rejects(parseOperationalPunchActivationResult(r, f.activationQuery, f.activationActor, c));
  await assert.rejects(parseOperationalPunchActivationResult(saved, q, f.activationActor)); await assert.rejects(parseOperationalPunchActivationResult(saved, f.activationQuery, f.activationActor, { ...c, reason: "不同请求" }));
});
test("242 activation async receipt parsing owns all fields before digest", async t => {
  const saved = await f.activationSaved(), raw = { ...saved, current: saved.current ? { ...saved.current } : null }, expected = structuredClone(raw), digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { if (first) { first = false; await Promise.resolve(); raw.current!.operationId = f.activationId(999); raw.canActivate = true; } return digest(...args); });
  assert.deepEqual(await parseOperationalPunchActivationResult(raw, f.activationQuery, f.activationActor, f.activationCommand()), expected); assert.equal(Object.isFrozen(raw), false);
});
