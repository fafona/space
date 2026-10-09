import assert from "node:assert/strict";
import test from "node:test";
import { DELEGATED_CONFIGURATION_PROTOCOL, type DelegatedConfigurationResult } from "./merchantAttendanceDelegatedConfiguration";
import { buildManagementConfigurationCommand, buildManagementConfigurationGrant, managementConfigurationUtcInput,
  type ManagementConfigurationGrantDraft, type ManagementConfigurationCommandDraft, type ManagementConfigurationContextQuery } from "./merchantAttendanceDelegatedConfigurationUi";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const actor = id(1), grantId = id(2), operationId = id(3), siteId = "99990205";
const query: ManagementConfigurationContextQuery = { siteId, grantId, mode: "context", operationId: null };
const base = () => ({ protocol: DELEGATED_CONFIGURATION_PROTOCOL, siteId, actorId: actor, readAt: "2026-10-08T16:00:00.123456Z" });
const workerDraft = (): ManagementConfigurationCommandDraft => ({ kind: "worker", workerNo: " W-001 ", displayName: " Kitchen ", locationId: id(6),
  startsOn: "2026-10-08", active: true, acknowledged: true });
const locationDraft = (): ManagementConfigurationCommandDraft => ({ kind: "location", name: " Madrid ", timeZone: "Europe/Madrid", active: true, acknowledged: true });
function workerContext(create: boolean): Extract<DelegatedConfigurationResult, { kind: "context" }> {
  return { ...base(), kind: "context", grantId, action: "worker_save", scope: { kind: "worker", create, workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), locationIds: [id(6)] },
    context: { settingsVersion: 10, targetVersion: create ? null : 3, employee: { id: id(5), displayName: "Kitchen" },
      worker: create ? null : { id: id(4), employeeId: id(5), workerNo: "W-001", displayName: "Kitchen", locationId: id(6), startsOn: "2026-10-08", active: true },
      locations: [{ id: id(6), name: "Madrid", timeZone: "Europe/Madrid", active: true }] } };
}
function locationContext(create: boolean): Extract<DelegatedConfigurationResult, { kind: "context" }> {
  return { ...base(), kind: "context", grantId, action: "location_save", scope: { kind: "location", create, locationId: id(8) }, context: { settingsVersion: 10,
    targetVersion: create ? null : 3, employee: null, worker: null, locations: create ? [] : [{ id: id(8), name: "Madrid", timeZone: "Europe/Madrid", active: true }] } };
}
function grant(): ManagementConfigurationGrantDraft {
  return { delegatedAction: "worker_save", delegateEmployeeId: id(10), delegateAuthUserId: id(11), create: true, workerId: id(4), employeeId: id(5),
    employeeAuthUserId: id(7), locationIds: [id(9), id(6)], validFrom: "2026-10-08T16:00", validUntil: "2026-10-09T16:00:01.123456", reason: " 配置核验 ", acknowledged: true };
}

test("205 structured worker grant binds complete identities and canonical 1..25 locations without mutating draft", () => {
  const draft = grant(), before = JSON.stringify(draft), result = buildManagementConfigurationGrant(draft, operationId);
  assert.equal(result.delegatedAction, "worker_save");
  assert.deepEqual(result.scope, { kind: "worker", create: true, workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), locationIds: [id(6), id(9)] });
  assert.equal(result.delegateEmployeeId, id(10)); assert.equal(result.delegateAuthUserId, id(11)); assert.equal(result.reason, "配置核验");
  assert.equal(result.validFrom, "2026-10-08T16:00:00.000000Z"); assert.equal(result.validUntil, "2026-10-09T16:00:01.123456Z");
  assert.equal(JSON.stringify(draft), before); assert(Object.isFrozen(result.scope)); if (result.scope.kind !== "worker") assert.fail(); assert(Object.isFrozen(result.scope.locationIds));
  for (const patch of [{ acknowledged: false }, { workerId: "" }, { employeeId: "" }, { employeeAuthUserId: "" }, { delegateAuthUserId: "" },
    { locationIds: [] }, { locationIds: [id(6), id(6)] }, { locationIds: Array.from({ length: 26 }, (_, n) => id(n + 20)) }, { delegateEmployeeId: id(5) }, { delegateAuthUserId: id(7) }]) {
    assert.throws(() => buildManagementConfigurationGrant({ ...draft, ...patch }, operationId));
  }
});

test("205 location grant has only its exact target/create scope and rejects wrong action or unacknowledged grant", () => {
  const draft: ManagementConfigurationGrantDraft = { delegatedAction: "location_save", delegateEmployeeId: id(10), delegateAuthUserId: id(11), create: false,
    locationId: id(8), validFrom: "2026-10-08T16:00", validUntil: "2026-10-09T16:00", reason: "核验", acknowledged: true };
  assert.deepEqual(buildManagementConfigurationGrant(draft, operationId).scope, { kind: "location", create: false, locationId: id(8) });
  for (const patch of [{ delegatedAction: "rule_publish" }, { locationId: "" }, { acknowledged: 1 }, { create: "false" }, { employeeId: id(5) }, { validUntil: draft.validFrom }]) {
    assert.throws(() => buildManagementConfigurationGrant({ ...draft, ...patch }, operationId));
  }
});

test("205 explicit UTC controls preserve six digits and reject local-offset/impossible/ambiguous input", () => {
  assert.equal(managementConfigurationUtcInput("2026-10-08T16:00"), "2026-10-08T16:00:00.000000Z");
  assert.equal(managementConfigurationUtcInput("2026-10-08T16:00:01.1"), "2026-10-08T16:00:01.100000Z");
  assert.equal(managementConfigurationUtcInput("2026-10-08T16:00:01.123456Z"), "2026-10-08T16:00:01.123456Z");
  for (const invalid of [null, "2026-02-30T16:00", "2026-10-08T24:00", "2026-10-08 16:00", "2026-10-08T16:00:00+02:00", "2026-10-08T16:00:00.1234567", "2026-10-08T16:00:00.000000Z\n"]) {
    assert.throws(() => managementConfigurationUtcInput(invalid));
  }
});

test("205 worker create/update bind context target and global settings CAS rather than target revision", async () => {
  for (const create of [true, false]) {
    const context = workerContext(create), result = await buildManagementConfigurationCommand(context, query, actor, workerDraft(), operationId);
    assert.deepEqual(result, { kind: "worker", operationId, expectedVersion: 10, values: { id: id(4), employeeId: id(5), workerNo: "W-001", displayName: "Kitchen",
      locationId: id(6), startsOn: "2026-10-08", active: true } });
    assert(Object.isFrozen(result)); assert(Object.isFrozen(result.values));
    await assert.rejects(buildManagementConfigurationCommand(context, query, actor, { ...workerDraft(), locationId: id(99) }, operationId));
    for (const patch of [{ id: id(99) }, { employeeId: id(99) }, { expectedVersion: 3 }, { acknowledged: false }]) await assert.rejects(buildManagementConfigurationCommand(context, query, actor, { ...workerDraft(), ...patch }, operationId));
  }
});

test("205 location create/update bind exact target and reject worker values, wrong identity and malformed contexts", async () => {
  for (const create of [true, false]) {
    const context = locationContext(create), result = await buildManagementConfigurationCommand(context, query, actor, locationDraft(), operationId);
    assert.deepEqual(result, { kind: "location", operationId, expectedVersion: 10, values: { id: id(8), name: "Madrid", timeZone: "Europe/Madrid", active: true } });
    assert(Object.isFrozen(result.values));
    await assert.rejects(buildManagementConfigurationCommand(context, query, actor, workerDraft(), operationId));
    for (const changed of [{ ...context, actorId: id(99) }, { ...context, action: "worker_save" }, { ...context, context: { ...context.context, targetVersion: create ? 3 : null } },
      { ...context, context: { ...context.context, employee: { id: id(5), displayName: "Leak" } } }]) await assert.rejects(buildManagementConfigurationCommand(changed, query, actor, locationDraft(), operationId));
  }
});

test("205 strict context parser rejects wrong site/grant/target triple and inherited/getter/extra UI fields", async () => {
  const context = workerContext(false);
  for (const changed of [{ ...context, siteId: "99999999" }, { ...context, grantId: id(99) }, { ...context, context: { ...context.context, employee: { id: id(99), displayName: "Wrong" } } },
    { ...context, context: { ...context.context, worker: { ...context.context.worker, id: id(99) } } }]) await assert.rejects(buildManagementConfigurationCommand(changed, query, actor, workerDraft(), operationId));
  let hits = 0; const getter = { ...workerDraft(), get active() { hits++; return true; } };
  await assert.rejects(buildManagementConfigurationCommand(context, query, actor, getter, operationId)); assert.equal(hits, 0);
  await assert.rejects(buildManagementConfigurationCommand(context, query, actor, Object.assign(Object.create({ fake: true }), workerDraft()), operationId));
  assert.throws(() => buildManagementConfigurationGrant({ ...grant(), get create() { hits++; return true; } }, operationId)); assert.equal(hits, 0);
});

test("205 dates preserve old command parser semantics; builders do not guess a present or start day", async () => {
  for (const startsOn of ["2000-01-01", "2024-02-29", "2100-12-31"]) {
    const result = await buildManagementConfigurationCommand(workerContext(true), query, actor, { ...workerDraft(), startsOn }, operationId);
    if (result.kind !== "worker") assert.fail(); assert.equal(result.values.startsOn, startsOn);
  }
  for (const startsOn of ["", "1999-12-31", "2101-01-01", "2026-02-30", " 2026-10-08"]) await assert.rejects(buildManagementConfigurationCommand(workerContext(true), query, actor, { ...workerDraft(), startsOn }, operationId));
});

test("205 intent builders freeze independent snapshots and never reuse mutable draft or context references", async () => {
  const draft = workerDraft(), context = workerContext(false), before = JSON.stringify(context);
  const promise = buildManagementConfigurationCommand(context, query, actor, draft, operationId);
  Reflect.set(draft, "displayName", "Late edit"); Reflect.set(context.context, "settingsVersion", 11);
  const result = await promise; assert.equal(result.expectedVersion, 10); if (result.kind !== "worker") assert.fail(); assert.equal(result.values.displayName, "Kitchen");
  assert.notEqual(JSON.stringify(context), before); assert(Object.isFrozen(result.values));
  assert.throws(() => { result.values.displayName = "changed"; });
});
