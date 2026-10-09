import assert from "node:assert/strict";
import test from "node:test";
import type { GroupsCommand, GroupsResult } from "./merchantAttendanceGroups";
import * as p from "./merchantAttendanceDelegatedGroups";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990204", actor = id(1), grantId = id(2), at = "2026-10-08T15:00:00.000001Z";
const q: Extract<p.DelegatedGroupsQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const create = (): GroupsCommand => ({ action: "save_group", operationId: id(3), groupId: id(3), expectedRevision: 0, name: "Kitchen", description: "", active: true, reason: "Staff grouping" });
const base = () => ({ protocol: p.DELEGATED_GROUPS_PROTOCOL, siteId, actorId: actor, readAt: at });
function emptyContext(): GroupsResult { return { protocol: "groups-v1", siteId, actorId: actor, settingsVersion: 1, timeZone: "Europe/Madrid", view: "context", group: null, worker: null, items: [], nextCursor: null, detail: null, receipt: null }; }
async function saved(c = create()) { return { ...base(), kind: "receipt" as const, receipt: { operationId: c.operationId, actorId: actor, grantId, action: p.delegatedGroupsAction(c),
  referenceId: c.action === "save_group" ? c.groupId : c.action === "assign" ? c.operationId : c.assignmentId, revision: c.action === "assign" ? 1 : c.expectedRevision + 1,
  commandFingerprint: await p.delegatedGroupsCommandFingerprint(q, actor, c), businessFingerprint: "a".repeat(64), recordedAt: at } }; }
test("204 exact input separates scoped context from original recovery and denies browser identity/owner claims", () => {
  assert.deepEqual(p.parseDelegatedGroupsQuery(q), q);
  for (const v of [{ ...q, ownerId: actor }, { ...q, workerId: id(9) }, { ...q, mode: "groups" }, { ...q, operationId: id(3) }, { ...q, grantId: "AAAAAAAA-0000-4000-8000-000000000002" }, { ...q, mode: "recover", operationId: null }]) assert.throws(() => p.parseDelegatedGroupsQuery(v));
  assert.throws(() => p.parseDelegatedGroupsBody({ query: { ...q, mode: "recover", operationId: id(3) }, command: create() }));
});
test("204 strict own-data tree rejects accessors/prototypes/sparse arrays/Unicode/duplicates and bytes", () => {
  let invoked = false; const accessor = Object.defineProperty({ ...q }, "mode", { get() { invoked = true; return "context"; }, enumerable: true });
  assert.throws(() => p.parseDelegatedGroupsQuery(accessor)); assert.equal(invoked, false);
  assert.throws(() => p.parseDelegatedGroupsQuery(Object.create(q)));
  assert.throws(() => p.parseDelegatedGroupsJson('{"x":1,"x":2}')); assert.throws(() => p.parseDelegatedGroupsJson('"' + "a".repeat(8193) + '"'));
  assert.throws(() => p.parseDelegatedGroupsCommand({ ...create(), name: "\ud800" }));
  assert.throws(() => p.parseDelegatedGroupsCommand({ ...create(), expectedRevision: -0 }));
});
test("204 all four commands reuse124 exact parser and fixed canonical scalar SHA tuple", async () => {
  const commands: GroupsCommand[] = [create(), { action: "assign", operationId: id(4), groupId: id(3), workerId: id(5), expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone: "Europe/Madrid", startsOn: "2026-10-08", endsOn: null, reason: "Assigned" },
    { action: "end", operationId: id(6), assignmentId: id(4), expectedRevision: 1, endsOn: "2026-10-09", reason: "Ended" }, { action: "cancel", operationId: id(7), assignmentId: id(4), expectedRevision: 2, reason: "Cancelled" }];
  for (const c of commands) { assert.deepEqual(p.parseDelegatedGroupsCommand(c), c); assert.match(p.delegatedGroupsFingerprintText(q, actor, c), /^\["attendance-delegated-groups-command-v1", /); assert.match(await p.delegatedGroupsCommandFingerprint(q, actor, c), /^[a-f0-9]{64}$/); }
  assert.notEqual(await p.delegatedGroupsCommandFingerprint(q, actor, create()), await p.delegatedGroupsCommandFingerprint(q, id(99), create()));
  assert.notEqual(await p.delegatedGroupsCommandFingerprint(q, actor, create()), await p.delegatedGroupsCommandFingerprint({ ...q, grantId: id(99) }, actor, create()));
});
test("204 context is exact grant-derived legacy context, not merchant inventory; create scope exposes absent target", async () => {
  const raw = { ...base(), kind: "context", grantId, action: "group_save", scope: { kind: "group", groupId: id(3), create: true }, context: emptyContext() };
  const result = await p.parseDelegatedGroupsResult(raw, q, actor); assert.equal(result.kind, "context");
  if (result.kind !== "context") assert.fail(); assert.deepEqual(p.delegatedGroupsCommandForContext(result, create()), create());
  await assert.rejects(p.parseDelegatedGroupsResult({ ...raw, context: { ...raw.context, view: "groups" } }, q, actor));
  await assert.rejects(p.parseDelegatedGroupsResult({ ...raw, scope: { ...raw.scope, create: false } }, q, actor));
  assert.throws(() => p.delegatedGroupsCommandForContext(result, { ...create(), groupId: id(90), operationId: id(90) }));
  await assert.rejects(p.parseDelegatedGroupsResult({ ...raw, actorId: id(99) }, q, actor));
});
test("204 minimal original receipts bind operation, actual actor, grant, full command SHA, reference and revision", async () => {
  const raw = await saved(), recover: p.DelegatedGroupsQuery = { ...q, mode: "recover", operationId: id(3) };
  assert.deepEqual(await p.parseDelegatedGroupsResult(raw, q, actor, create()), raw);
  assert.deepEqual(await p.parseDelegatedGroupsResult(raw, recover, actor, create()), raw);
  for (const changes of [{ commandFingerprint: "b".repeat(64) }, { actorId: id(99) }, { grantId: id(99) }, { revision: 2 }, { referenceId: id(99) }, { action: "group_cancel" }, { recordedAt: "2026-10-08T16:00:00.000001Z" }]) await assert.rejects(p.parseDelegatedGroupsResult({ ...raw, receipt: { ...raw.receipt, ...changes } }, recover, actor, create()));
  await assert.rejects(p.parseDelegatedGroupsResult(raw, recover, actor, { ...create(), reason: "Changed" }));
  await assert.rejects(p.parseDelegatedGroupsResult({ ...raw, receipt: { ...raw.receipt, command: create() } }, recover, actor, create()));
});
test("204 missing original remains unknown, and full command is required to validate a pending SHA", async () => {
  const recover: p.DelegatedGroupsQuery = { ...q, mode: "recover", operationId: id(3) }, raw = { ...base(), kind: "receipt", receipt: null };
  assert.equal((await p.parseDelegatedGroupsResult(raw, recover, actor, create())).kind, "receipt");
  await assert.rejects(p.parseDelegatedGroupsResult(raw, q, actor, create()));
  await assert.rejects(p.parseDelegatedGroupsResult(await saved(), { ...recover, operationId: id(90) }, actor, create()));
});
test("204 result/request copies freeze detached commands and nested contexts", async () => {
  const c = create(), parsed = p.parseDelegatedGroupsBody({ query: q, command: c }); c.reason = "Changed"; assert.equal(parsed.command.reason, "Staff grouping"); assert(Object.isFrozen(parsed.command));
  const raw = { ...base(), kind: "context", grantId, action: "group_save", scope: { kind: "group", groupId: id(3), create: true }, context: emptyContext() };
  const result = await p.parseDelegatedGroupsResult(raw, q, actor); raw.context.timeZone = "UTC";
  if (result.kind !== "context") assert.fail(); assert.equal(result.context.timeZone, "Europe/Madrid"); assert(Object.isFrozen(result.context));
});
