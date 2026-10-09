import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { operationalRuleLedgerEncode } from "./merchantAttendanceOperationalRuleLedger";
import { parseOperationalPunchCommand, parseOperationalPunchQuery, parseOperationalPunchJson, parseOperationalPunchResult, parseOperationalPunchRpcResult, parseOperationalPunchResponse,
  operationalPunchPolicyFingerprint, operationalPunchCommandFingerprint, operationalPunchSessionFingerprint, type OperationalPunchParseInput } from "./merchantAttendanceOperationalPunch";
import { punchId as id, punchSite as site, punchFixture, punchStartFixture, signPunchSource } from "./merchantAttendanceOperationalPunchTestFixtures";
type Writable<T> = T extends readonly (infer U)[] ? Writable<U>[] : T extends object ? { -readonly [K in keyof T]: Writable<T[K]> } : T;
const copy = <T>(v: T) => structuredClone(v) as Writable<T>;
const invalid = /attendance_operational_punch_invalid/;
test("242 query/commands are exact, bounded and keep GPS/QR/PIN out of durable intent", async () => {
  assert.deepEqual(parseOperationalPunchQuery({ mode: "prepare" }), { mode: "prepare" });
  for (const q of [{ mode: "prepare", operationId: id(1) }, { mode: "recover" }, { mode: "recover", operationId: id(1), secret: "x" }]) assert.throws(() => parseOperationalPunchQuery(q));
  const { command } = await punchStartFixture(); assert.deepEqual(parseOperationalPunchCommand(command, "self", site), command);
  for (const more of [{ position: null }, { pin: "1234" }, { token: "aq1.secret" }, { choice: { kind: "finish" } }]) assert.throws(() => parseOperationalPunchCommand({ ...command, ...more }, "self", site));
  assert.throws(() => parseOperationalPunchCommand({ ...command, clock: { ...command.clock, expectedSequence: -0 } }, "self", site));
  assert.throws(() => parseOperationalPunchCommand({ ...command, clock: { ...command.clock, operationId: "ABCDEF00-0000-4000-8000-000000000020" } }, "self", site));
});
test("242 descriptors, duplicate keys, malformed unicode and unknown JSON fields fail closed", async () => {
  let getters = 0; const raw = { get mode() { getters++; return "prepare"; } }; assert.throws(() => parseOperationalPunchQuery(raw)); assert.equal(getters, 0);
  for (const s of ['{"mode":"prepare","mode":"prepare"}', '{"mode":"prepare","mo\\u0064e":"prepare"}', '{"mode":"\\ud800"}']) assert.throws(() => parseOperationalPunchJson(s, "request"));
  const { result, input } = await punchFixture(); await assert.rejects(parseOperationalPunchResult({ ...result, source: {} }, input), invalid);
  await assert.rejects(parseOperationalPunchResult({ ...result, [Symbol("hidden")]: 1 }, input), invalid);
});
test("242 canonical IDs, fingerprints and instants reject trailing newline at every public boundary", async () => {
  const f = await punchFixture();
  assert.throws(() => parseOperationalPunchQuery({ mode: "recover", operationId: id(9) + "\n" }));
  await assert.rejects(parseOperationalPunchResult({ ...f.result, readAt: f.result.readAt + "\n" }, f.input), invalid);
  await assert.rejects(parseOperationalPunchResult({ ...f.result, policy: { ...f.policy, policyFingerprint: f.policy.policyFingerprint + "\n" } }, f.input), invalid);
  await assert.rejects(parseOperationalPunchResult({ ...f.result, policy: { ...f.policy, locationId: id(4) + "\n" } }, f.input), invalid);
  await assert.rejects(operationalPunchPolicyFingerprint(site + "\n", "self", f.policy, f.source));
});
test("242 prepare validates both unconfigured and explicit saved source and strips private source", async () => {
  for (const configured of [false, true]) { const { source, result, input } = await punchFixture(configured);
    assert.deepEqual(await parseOperationalPunchRpcResult({ result, source }, input), result); assert.deepEqual(await parseOperationalPunchResult(result, input), result);
    const parsed = await parseOperationalPunchRpcResult({ result, source }, input); assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.policy!.fields.breakTypes)); assert.equal("source" in parsed, false);
    await assert.rejects(parseOperationalPunchRpcResult({ result, source: null }, input), invalid); }
});
test("242 policy CAS omits only the observation instant, retaining channel/location/source/legacy", async () => {
  const { source, policy } = await punchFixture(true), laterSource = signPunchSource({ ...source, at: "2026-10-08T12:00:01.123000Z" });
  const later = { ...policy, checkedAt: laterSource.at, sourceFingerprint: laterSource.sourceFingerprint };
  assert.notEqual(source.sourceFingerprint, laterSource.sourceFingerprint);
  assert.equal(await operationalPunchPolicyFingerprint(site, "self", later, laterSource), policy.policyFingerprint);
  for (const changed of [{ locationVersion: 6 }, { activationRevision: 2 }, { legacy: { ...policy.legacy, webBreakPaid: true } }]) assert.notEqual(await operationalPunchPolicyFingerprint(site, "self", { ...policy, ...changed }, source), policy.policyFingerprint);
  assert.notEqual(await operationalPunchPolicyFingerprint(site, "pin", policy, source), policy.policyFingerprint);
});
test("242 field decisions are recomputed from traces, full private source is independently bound", async () => {
  const { source, result, input } = await punchFixture(true); const forged = copy(result); forged.policy!.fields.breakTypes.value!.selection = "fixed";
  await assert.rejects(parseOperationalPunchResult(forged, input), invalid);
  const changed = copy(result); changed.policy!.origins[0].operationId = id(99);
  await assert.rejects(parseOperationalPunchRpcResult({ result: changed, source }, input), invalid);
  const changedIdentity = copy(result); changedIdentity.policy!.workerIdentity.employeeAuthUserId = id(99);
  await assert.rejects(parseOperationalPunchResult(changedIdentity, input), invalid);
});
test("242 actual start-shaped response binds event/session/source/command and is not next-write authority", async () => {
  const f = await punchStartFixture(true); assert.deepEqual(await parseOperationalPunchRpcResult({ result: f.result, source: f.source }, f.input), f.result);
  for (const name of ["canStart", "canBreak", "canFinish"] as const) await assert.rejects(parseOperationalPunchResult({ ...f.result, [name]: true }, f.input), invalid);
  const changed = copy(f.result); changed.session!.fields.breakTypes.trace[0].choice = { mode: "disabled" };
  await assert.rejects(parseOperationalPunchResult(changed, f.input), invalid);
  await assert.rejects(parseOperationalPunchResult({ ...f.result, operation: null }, f.input), invalid);
});
test("242 exact recover matches pending intent without source/current-policy re-read", async () => {
  const f = await punchStartFixture(), result = { ...f.result, session: null }, input = { ...f.input, write: false };
  assert.deepEqual(await parseOperationalPunchRpcResult({ result, source: null }, input), result);
  await assert.rejects(parseOperationalPunchRpcResult({ result, source: f.source }, input), invalid);
  await assert.rejects(parseOperationalPunchResult(result, { ...input, command: { ...f.command, choice: { kind: "start", selection: null, expectedPolicyFingerprint: "f".repeat(64) } } }), invalid);
  await assert.rejects(parseOperationalPunchResult({ ...result, session: f.session }, input), invalid);
});
test("242 historical start POST replay does not relabel the currently closed state", async () => {
  const f = await punchStartFixture(), end = { ...f.result.clock.receipt!, id: id(31), operationId: id(30), action: "clock_out" as const, sequence: 2, occurredAt: "2026-10-08T13:00:00.000Z" };
  const result = { ...f.result, readAt: "2026-10-08T13:00:00.001000Z", replayed: true, clock: { ...f.result.clock, replayed: true, state: { sequence: 2, status: "off" as const, lastEvent: end } } };
  assert.deepEqual(await parseOperationalPunchRpcResult({ result, source: f.source }, f.input), result);
});
test("242 managed break pins paid/unpaid into command SHA; same operation cannot change choice", async () => {
  const f = await punchStartFixture(true), base = { clock: { ...f.command.clock, action: "break_start" as const, operationId: id(40), expectedSequence: 1 },
    choice: { kind: "break" as const, startEventId: f.session.startEventId, expectedSessionFingerprint: f.session.sessionFingerprint, breakType: "paid" as const } };
  const target = { workerId: id(1), employeeId: id(2), employeeAuthUserId: id(3) };
  const paid = await operationalPunchCommandFingerprint(site, "self", id(3), target, base), unpaid = await operationalPunchCommandFingerprint(site, "self", id(3), target, { ...base, choice: { ...base.choice, breakType: "unpaid" } });
  assert.notEqual(paid, unpaid);
  const tuple = ["attendance-operational-punch-command-v1", site, "self", id(3), [id(1), id(2), id(3)], [id(1), id(40), id(4), "break_start", 1], ["break", id(21), f.session.sessionFingerprint, "paid"]];
  assert.equal(paid, createHash("sha256").update(operationalRuleLedgerEncode(tuple)).digest("hex"));
  await assert.rejects(operationalPunchCommandFingerprint(site, "pin", id(3), target, { ...base, clock: { ...base.clock, expectedEmployeeId: id(2) } }));
});
test("242 saved session hash contains immutable identity, original channel, location and activation", async () => {
  const f = await punchStartFixture(); assert.equal(await operationalPunchSessionFingerprint(site, f.session), f.session.sessionFingerprint);
  for (const change of [{ locationVersion: 6 }, { activationRevision: 2 }, { employeeId: id(90) }, { legacy: { ...f.session.legacy, webBreakPaid: true } }]) assert.notEqual(await operationalPunchSessionFingerprint(site, { ...f.session, ...change }), f.session.sessionFingerprint);
});
test("242 parser snapshots untrusted data before asynchronous SHA yields", async t => {
  const f = await punchStartFixture(true), raw = copy({ result: f.result, source: f.source }), original = copy(raw); let first = true;
  const digest = crypto.subtle.digest.bind(crypto.subtle); t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => {
    if (first) { first = false; await Promise.resolve(); raw.result.session!.activationRevision = 999; raw.source.layers.enterprise!.operationId = id(99); } return digest(...args); });
  assert.deepEqual(await parseOperationalPunchRpcResult(raw, f.input), original.result); assert.equal(Object.isFrozen(raw), false);
});
test("242 unknown error is not promoted to confirmed rejection", async () => {
  const { input } = await punchFixture();
  assert.deepEqual(await parseOperationalPunchResponse({ ok: false, error: { code: "attendance_operational_punch_changed", message: "配置已变更" } }, input), { ok: false, error: { code: "attendance_operational_punch_changed", message: "配置已变更" } });
  await assert.rejects(parseOperationalPunchResponse({ ok: false, error: { code: "new_unknown", message: "x" } }, input), invalid);
});
test("242 location private fence is server-only, with no invented GPS command", async () => {
  const f = await punchFixture(), locationPolicy = { ...f.policy, policyFingerprint: await operationalPunchPolicyFingerprint(site, "location", f.policy, f.source) };
  const clock = { ...f.result.clock, siteId: site, employeeId: id(2), channelEnabled: true, policy: { settingsVersion: 4, workerVersion: 2, locationVersion: 5, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 },
    locationResult: null, noticeGate: { ready: true, reason: "ready", revision: 1 }, finish: null, receiptGate: null, internalFence: { latitude: 37.3, longitude: -5.9, radiusMeters: 100, maxAgeMs: 60000 }, internalPolicyFingerprint: "a".repeat(32) };
  const result = { ...f.result, channel: "location", clock, policy: locationPolicy };
  const input: OperationalPunchParseInput = { siteId: site, channel: "location", query: { mode: "prepare" }, command: null, write: false, authUserId: id(3), expectedWorkerId: id(1) };
  const parsed = await parseOperationalPunchRpcResult({ result, source: f.source }, input); assert.equal("internalFence" in parsed.clock, false);
  await assert.rejects(parseOperationalPunchResult(result, input), invalid); assert.deepEqual(await parseOperationalPunchResult(parsed, input), parsed);
});
test("242 PIN target binds authenticated worker and terminal without assigning an Auth actor", async () => {
  const f = await punchFixture(), policy = { ...f.policy, policyFingerprint: await operationalPunchPolicyFingerprint(site, "pin", f.policy, f.source) };
  const result = { ...f.result, channel: "pin", policy, clock: { ...f.result.clock, siteId: site, terminalId: id(50), workerNo: "test001", workerName: "合成员工", employeeId: id(2), canStart: true, canFinish: true, blockReason: null } };
  const input: OperationalPunchParseInput = { siteId: site, channel: "pin", query: { mode: "prepare" }, command: null, write: false, authUserId: null, expectedWorkerId: id(1), expectedEmployeeId: id(2), terminalId: id(50), workerNo: "test001" };
  const parsed = await parseOperationalPunchRpcResult({ result, source: f.source }, input); assert.equal(parsed.channel, "pin");
  await assert.rejects(parseOperationalPunchResult(result, { ...input, expectedEmployeeId: id(99) }), invalid);
  await assert.rejects(parseOperationalPunchResult(result, { ...input, terminalId: id(99) }), invalid);
});
