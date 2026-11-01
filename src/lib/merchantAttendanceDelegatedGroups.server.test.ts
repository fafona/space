import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import type { GroupsCommand } from "./merchantAttendanceGroups";
import * as p from "./merchantAttendanceDelegatedGroups";
import * as s from "./merchantAttendanceDelegatedGroups.server";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990204", actor = id(1), grantId = id(2), at = "2026-10-08T15:00:00.000001Z";
const q: Extract<p.DelegatedGroupsQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const command = (): GroupsCommand => ({ action: "save_group", operationId: id(3), groupId: id(3), expectedRevision: 0, name: "Kitchen", description: "", active: true, reason: "Staff grouping" });
const recovery = (): Extract<p.DelegatedGroupsQuery, { mode: "recover" }> => ({ siteId, grantId, mode: "recover", operationId: id(3) });
const base = () => ({ protocol: p.DELEGATED_GROUPS_PROTOCOL, siteId, actorId: actor, readAt: at });
const missing = () => ({ ...base(), kind: "receipt", receipt: null });
async function saved() { const c = command(); return { ...base(), kind: "receipt", receipt: { operationId: c.operationId, actorId: actor, grantId, action: "group_save", referenceId: id(3), revision: 1,
  commandFingerprint: await p.delegatedGroupsCommandFingerprint(q, actor, c), businessFingerprint: "a".repeat(64), recordedAt: at } }; }
type Response = Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
function stub(fn: (args: Record<string, unknown>, count: number) => Response | Promise<Response>) { const calls: Record<string, unknown>[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, s.DELEGATED_GROUPS_RPC); calls.push(args); return fn(args, calls.length); } }; return { service, calls }; }
const ok = (data: unknown): Response => ({ data, error: null });
const input = (): s.DelegatedGroupsInput => ({ query: q, command: command(), authUserId: actor, allowWrite: true });
test("204 adapter default-off exact64 site gate rejects trim/duplicates/wildcards", () => {
  const env = { FAOLLA_ATTENDANCE_DELEGATED_GROUPS_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_GROUPS_SITE_IDS: siteId };
  assert.equal(s.delegatedGroupsSiteEnabled(siteId, {}), false); assert.equal(s.delegatedGroupsSiteEnabled(siteId, env), true);
  for (const value of ["*", siteId + " ", siteId + ",", siteId + "," + siteId, " " + siteId]) assert.equal(s.delegatedGroupsSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_GROUPS_SITE_IDS: value }), false);
  const ids = Array.from({ length: 64 }, (_, i) => String(99990204 + i)); assert.equal(s.delegatedGroupsSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_GROUPS_SITE_IDS: ids.join(",") }), true);
  assert.equal(s.delegatedGroupsSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_GROUPS_SITE_IDS: [...ids, "99990300"].join(",") }), false);
});
test("204 fresh writer first reads exact original and then sends real actor once", async () => {
  const receipt = await saved(), st = stub((_, n) => ok(n === 1 ? missing() : receipt));
  const result = await s.createDelegatedGroupsService(st.service, { enabled: () => true }).execute(input()); assert.deepEqual(result, receipt); assert.equal(st.calls.length, 2);
  assert.deepEqual(st.calls[0], { p_query: recovery(), p_auth_user_id: actor, p_command: null, p_allow_write: false });
  assert.deepEqual(st.calls[1], { p_query: q, p_auth_user_id: actor, p_command: command(), p_allow_write: true });
});
test("204 saved original returns before current enable/entitlement and never mutates again", async () => {
  const receipt = await saved(), st = stub(() => ok(receipt));
  const result = await s.createDelegatedGroupsService(st.service, { enabled: () => assert.fail("original precedes rollout") }).execute({ ...input(), allowWrite: false });
  assert.deepEqual(result, receipt); assert.equal(st.calls.length, 1);
});
test("204 off fresh operation stops after read; unknown never becomes a confirmed write", async () => {
  for (const allow of [true, false]) { const st = stub(() => ok(missing())); await assert.rejects(s.createDelegatedGroupsService(st.service, { enabled: () => false }).execute({ ...input(), allowWrite: allow }), { code: "attendance_delegated_groups_disabled" }); assert.equal(st.calls.length, 1); }
});
test("204 recovery validates original full SHA independent of rollout and keeps null receipt unknown", async () => {
  const st = stub(() => ok(missing())), service = s.createDelegatedGroupsService(st.service, { enabled: () => assert.fail() });
  const result = await service.recover({ query: recovery(), expectedCommand: command(), authUserId: actor }); assert.equal(result.kind, "receipt"); if (result.kind !== "receipt") assert.fail(); assert.equal(result.receipt, null);
  const receipt = await saved(), wrong = stub(() => ok({ ...receipt, receipt: { ...receipt.receipt, commandFingerprint: "b".repeat(64) } }));
  await assert.rejects(s.createDelegatedGroupsService(wrong.service).recover({ query: recovery(), expectedCommand: command(), authUserId: actor }), { code: "attendance_delegated_groups_invalid" });
});
test("204 minimal original GET never uses new grants, never sends a command and still binds actual actor/grant", async () => {
  const value = await saved(), st = stub(() => ok(value));
  const service = s.createDelegatedGroupsService(st.service, { enabled: () => assert.fail("receipt never reads rollout") });
  assert.deepEqual(await service.readReceipt({ query: recovery(), authUserId: actor }), value);
  assert.deepEqual(st.calls, [{ p_query: recovery(), p_auth_user_id: actor, p_command: null, p_allow_write: false }]);
  const wrong = stub(() => ok({ ...value, receipt: { ...value.receipt, grantId: id(99) } }));
  await assert.rejects(s.createDelegatedGroupsService(wrong.service).readReceipt({ query: recovery(), authUserId: actor }), { code: "attendance_delegated_groups_invalid" });
});
test("204 one scoped context GET is null/false and never reads rollout", async () => {
  const context = { ...base(), kind: "context", grantId, action: "group_save", scope: { kind: "group", groupId: id(3), create: true }, context: { protocol: "groups-v1", siteId, actorId: actor, settingsVersion: 1, timeZone: "UTC", view: "context", group: null, worker: null, items: [], nextCursor: null, detail: null, receipt: null } };
  const st = stub(() => ok(context)); await s.createDelegatedGroupsService(st.service, { enabled: () => assert.fail() }).execute({ ...input(), command: null }); assert.equal(st.calls.length, 1); assert.equal(st.calls[0].p_command, null); assert.equal(st.calls[0].p_allow_write, false);
});
test("204 finite safe errors and wrong actor are rejected without retry", async () => {
  for (const code of ["attendance_access_denied", "attendance_group_overlap", "attendance_operation_conflict", "private SQL text"]) { const st = stub(() => ({ data: null, error: { message: code } })); await assert.rejects(s.createDelegatedGroupsService(st.service).execute(input()), { code: code === "private SQL text" ? "attendance_unavailable" : code }); assert.equal(st.calls.length, 1); }
  const receipt = await saved(), st = stub(() => ok({ ...receipt, actorId: id(99) })); await assert.rejects(s.createDelegatedGroupsService(st.service).execute(input()), { code: "attendance_delegated_groups_invalid" });
});
test("204 total deadline/cancellation preserves unknown and prevents late preread from dispatching writer", async () => {
  let resolve: ((v: Response) => void) | undefined; const wait = new Promise<Response>(r => { resolve = r; }), st = stub(() => wait);
  const abort = new AbortController(), service = s.createDelegatedGroupsService(st.service, { enabled: () => true, timeoutMs: 20 });
  await assert.rejects(service.execute(input(), abort.signal), { code: "attendance_unavailable" }); resolve?.(ok(missing())); await new Promise(r => setTimeout(r, 10)); assert.equal(st.calls.length, 1); assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(service.execute(input(), cancelled.signal), { code: "attendance_unavailable" }); assert.equal(st.calls.length, 1);
});
test("204 caller changes after first await cannot alter actual actor, command or authority scope", async () => {
  const receipt = await saved(); let resolve: ((v: Response) => void) | undefined; const st = stub((_, n) => n === 1 ? new Promise<Response>(r => { resolve = r; }) : ok(receipt));
  const raw = { ...input(), query: { ...q }, command: command() }, run = s.createDelegatedGroupsService(st.service, { enabled: () => true }).execute(raw);
  raw.authUserId = id(99); raw.query.grantId = id(99); if (raw.command) raw.command.reason = "Changed"; resolve?.(ok(missing())); await run;
  assert.equal(st.calls[1].p_auth_user_id, actor); assert.deepEqual(st.calls[1].p_command, command()); assert.deepEqual(st.calls[1].p_query, q);
});
