import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as p from "./merchantAttendanceDelegatedConfiguration";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990205", actor = id(1), grantId = id(2), at = "2026-10-08T16:00:00.000001Z";
const q: Extract<p.DelegatedConfigurationQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const c = (): p.DelegatedConfigurationCommand => ({ kind: "worker", operationId: id(3), expectedVersion: 10, values: { id: id(4), employeeId: id(5), workerNo: "W-001", displayName: "Kitchen", locationId: id(6), active: true, startsOn: "2026-10-08" } });
const recovery = (): Extract<p.DelegatedConfigurationQuery, { mode: "recover" }> => ({ siteId, grantId, mode: "recover", operationId: id(3) });
const base = () => ({ protocol: p.DELEGATED_CONFIGURATION_PROTOCOL, siteId, actorId: actor, readAt: at });
async function saved() { return { ...base(), kind: "receipt", receipt: { operationId: id(3), actorId: actor, grantId, action: "worker_save", referenceId: id(4), revision: 11, commandFingerprint: await p.delegatedConfigurationCommandFingerprint(q, actor, c()), businessFingerprint: "a".repeat(64), recordedAt: at } }; }
const context = () => ({ ...base(), kind: "context", grantId, action: "worker_save", scope: { kind: "worker", create: true, workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), locationIds: [id(6)] },
  context: { settingsVersion: 10, targetVersion: null, worker: null, employee: { id: id(5), displayName: "Kitchen" }, locations: [{ id: id(6), name: "Madrid", timeZone: "Europe/Madrid", active: true }] } });
test("205 strict four-key query, exact string encoding and two command shapes only", () => {
  assert.deepEqual(p.parseDelegatedConfigurationBody({ query: q, command: c() }), { query: q, command: c() });
  assert.equal(p.delegatedConfigurationQueryString(q), `siteId=${siteId}&grantId=${grantId}&mode=context&operationId=`);
  for (const raw of [{ ...q, actorId: actor }, { ...q, operationId: id(3) }, { ...q, mode: "workers" }]) assert.throws(() => p.parseDelegatedConfigurationQuery(raw));
  for (const command of [{ ...c(), expectedVersion: 0 }, { ...c(), expectedVersion: 9007199254740990 }, { ...c(), kind: "settings" }, { ...c(), ownerId: actor }]) assert.throws(() => p.parseDelegatedConfigurationCommand(command));
});
test("205 no getters, inherited properties, duplicate JSON keys, invalid strings or invalid dates", () => {
  let hit = 0; const getter = { ...c(), get values() { hit++; return c().values; } }; assert.throws(() => p.parseDelegatedConfigurationCommand(getter)); assert.equal(hit, 0);
  assert.throws(() => p.parseDelegatedConfigurationQuery(Object.assign(Object.create({ fake: 1 }), q)));
  assert.throws(() => p.parseDelegatedConfigurationJson('{"kind":"worker","kind":"location"}'));
  const command = c(); if (command.kind !== "worker") assert.fail();
  for (const values of [{ ...command.values, displayName: " Kitchen" }, { ...command.values, workerNo: "W\n1" }, { ...command.values, startsOn: "2026-02-30" }]) assert.throws(() => p.parseDelegatedConfigurationCommand({ ...command, values }));
  assert.throws(() => p.parseDelegatedConfigurationJson('"' + "中".repeat(8192) + '"'));
});
test("205 canonical ledger tuple fingerprints actor/grant/full command with PG jsonb spacing", async () => {
  const text = p.delegatedConfigurationFingerprintText(q, actor, c()); assert(text.includes('", '));
  assert.equal(await p.delegatedConfigurationCommandFingerprint(q, actor, c()), createHash("sha256").update(text).digest("hex"));
  assert.equal(await p.delegatedConfigurationCommandFingerprint(q, actor, c()), await p.delegatedConfigurationCommandFingerprint(recovery(), actor, c()));
  assert.notEqual(await p.delegatedConfigurationCommandFingerprint(q, actor, c()), await p.delegatedConfigurationCommandFingerprint(q, id(99), c()));
  assert.throws(() => p.delegatedConfigurationFingerprintText({ ...recovery(), operationId: id(99) }, actor, c()));
});
test("205 exact minimal receipt rechecks actor/grant/op/full SHA/global revision/target", async () => {
  const value = await saved(); assert.deepEqual(await p.parseDelegatedConfigurationResult(value, recovery(), actor, c()), value);
  for (const change of [{ actorId: id(99) }, { grantId: id(99) }, { operationId: id(99) }, { referenceId: id(99) }, { revision: 10 }, { commandFingerprint: "b".repeat(64) }, { command: c() }]) await assert.rejects(p.parseDelegatedConfigurationResult({ ...value, receipt: { ...value.receipt, ...change } }, recovery(), actor, c()), { code: "attendance_delegated_configuration_invalid" });
  assert.equal((await p.parseDelegatedConfigurationResult({ ...base(), kind: "receipt", receipt: null }, recovery(), actor, c())).kind, "receipt");
  await assert.rejects(p.parseDelegatedConfigurationResult({ ...base(), kind: "receipt", receipt: null }, q, actor, c()));
});
test("205 grant-bounded worker context only and immutable result; command CAS checks target/location", async () => {
  const value = await p.parseDelegatedConfigurationResult(context(), q, actor); assert.equal(value.kind, "context"); if (value.kind !== "context") assert.fail();
  assert(Object.isFrozen(value.context.locations)); assert.deepEqual(p.delegatedConfigurationCommandForContext(value, c()), c());
  assert.throws(() => p.delegatedConfigurationCommandForContext(value, { ...c(), expectedVersion: 9 }));
  const command = c(); if (command.kind !== "worker") assert.fail();
  assert.throws(() => p.delegatedConfigurationCommandForContext(value, { ...command, values: { ...command.values, locationId: id(99) } }));
  for (const change of [{ targetVersion: 1 }, { employee: { id: id(99), displayName: "Wrong" } }, { locations: [] }, { workers: [] }]) await assert.rejects(p.parseDelegatedConfigurationResult({ ...context(), context: { ...context().context, ...change } }, q, actor));
});
test("205 location-only context has no worker/employee or outside locations, settings version is not target version", async () => {
  const v = { ...base(), kind: "context", grantId, action: "location_save", scope: { kind: "location", create: false, locationId: id(6) }, context: { settingsVersion: 10, targetVersion: 3, worker: null, employee: null, locations: [{ id: id(6), name: "Madrid", timeZone: "UTC", active: true }] } };
  const r = await p.parseDelegatedConfigurationResult(v, q, actor); if (r.kind !== "context") assert.fail();
  assert.deepEqual(p.delegatedConfigurationCommandForContext(r, { kind: "location", operationId: id(3), expectedVersion: 10, values: v.context.locations[0] }).expectedVersion, 10);
  await assert.rejects(p.parseDelegatedConfigurationResult({ ...v, context: { ...v.context, employee: { id: id(5), displayName: "Leak" } } }, q, actor));
});
