import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import * as p from "./merchantAttendanceDelegatedConfiguration";
import * as s from "./merchantAttendanceDelegatedConfiguration.server";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990205", actor = id(1), grantId = id(2), at = "2026-10-08T16:00:00.000001Z";
const q: Extract<p.DelegatedConfigurationQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const command = (): p.DelegatedConfigurationCommand => ({ kind: "location", operationId: id(3), expectedVersion: 10, values: { id: id(4), name: "Madrid", timeZone: "Europe/Madrid", active: true } });
const recovery = (): Extract<p.DelegatedConfigurationQuery, { mode: "recover" }> => ({ siteId, grantId, mode: "recover", operationId: id(3) });
const base = () => ({ protocol: p.DELEGATED_CONFIGURATION_PROTOCOL, siteId, actorId: actor, readAt: at });
const missing = () => ({ ...base(), kind: "receipt", receipt: null });
async function saved() { return { ...base(), kind: "receipt", receipt: { operationId: id(3), actorId: actor, grantId, action: "location_save", referenceId: id(4), revision: 11,
  commandFingerprint: await p.delegatedConfigurationCommandFingerprint(q, actor, command()), businessFingerprint: "a".repeat(64), recordedAt: at } }; }
type Response = Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
function stub(fn: (args: Record<string, unknown>, count: number) => Response | Promise<Response>) { const calls: Record<string, unknown>[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, "faolla_attendance_delegated_config_v1"); calls.push(args); return fn(args, calls.length); } }; return { service, calls }; }
const ok = (data: unknown): Response => ({ data, error: null });
const input = (): s.DelegatedConfigurationInput => ({ query: q, command: command(), authUserId: actor, allowWrite: true });
test("205 adapter default-off exact <=64site, no trim/duplicates/wildcards", () => {
  const env = { FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_SITE_IDS: siteId };
  assert.equal(s.delegatedConfigurationSiteEnabled(siteId, {}), false); assert.equal(s.delegatedConfigurationSiteEnabled(siteId, env), true);
  for (const value of ["*", siteId + " ", siteId + ",", siteId + "," + siteId, " " + siteId]) assert.equal(s.delegatedConfigurationSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_SITE_IDS: value }), false);
  const ids = Array.from({ length: 64 }, (_, i) => String(99990205 + i)); assert.equal(s.delegatedConfigurationSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_SITE_IDS: ids.join(",") }), true);
  assert.equal(s.delegatedConfigurationSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_SITE_IDS: [...ids, "99990300"].join(",") }), false);
});
test("205 fresh change first recovers full original, then one realactor scoped RPC", async () => {
  const value = await saved(), st = stub((_, n) => ok(n === 1 ? missing() : value));
  assert.deepEqual(await s.createDelegatedConfigurationService(st.service, { enabled: () => true }).execute(input()), value);
  assert.deepEqual(st.calls, [{ p_query: recovery(), p_auth_user_id: actor, p_command: null, p_allow_write: false }, { p_query: q, p_auth_user_id: actor, p_command: command(), p_allow_write: true }]);
});
test("205 exactsaved receipt precedes current entitlement/rollout and never writes again", async () => {
  const value = await saved(), st = stub(() => ok(value));
  assert.deepEqual(await s.createDelegatedConfigurationService(st.service, { enabled: () => assert.fail() }).execute({ ...input(), allowWrite: false }), value); assert.equal(st.calls.length, 1);
  const wrong = stub(() => ok({ ...value, receipt: { ...value.receipt, commandFingerprint: "b".repeat(64) } }));
  await assert.rejects(s.createDelegatedConfigurationService(wrong.service).execute(input()), { code: "attendance_delegated_configuration_invalid" }); assert.equal(wrong.calls.length, 1);
});
test("205 disabled fresh stops after recover; minimal GET can recover without enable but never clears pending", async () => {
  const st = stub(() => ok(missing()));
  await assert.rejects(s.createDelegatedConfigurationService(st.service, { enabled: () => false }).execute(input()), { code: "attendance_delegated_configuration_disabled" }); assert.equal(st.calls.length, 1);
  const value = await saved(), original = stub(() => ok(value));
  assert.deepEqual(await s.createDelegatedConfigurationService(original.service, { enabled: () => assert.fail() }).readReceipt({ query: recovery(), authUserId: actor }), value);
  assert.deepEqual(original.calls, [{ p_query: recovery(), p_auth_user_id: actor, p_command: null, p_allow_write: false }]);
});
test("205 fullcommand recovery binds actor and same operation, null remains unknown", async () => {
  const st = stub(() => ok(missing())), service = s.createDelegatedConfigurationService(st.service);
  const result = await service.recover({ query: recovery(), expectedCommand: command(), authUserId: actor }); if (result.kind !== "receipt") assert.fail(); assert.equal(result.receipt, null);
  await assert.rejects(service.recover({ query: { ...recovery(), operationId: id(99) }, expectedCommand: command(), authUserId: actor })); assert.equal(st.calls.length, 1);
});
test("205 context reads one bounded grant only and never invoke rollout or writer", async () => {
  const value = { ...base(), kind: "context", grantId, action: "location_save", scope: { kind: "location", locationId: id(4), create: true }, context: { settingsVersion: 10, targetVersion: null, worker: null, employee: null, locations: [] } };
  const st = stub(() => ok(value)); assert.deepEqual(await s.createDelegatedConfigurationService(st.service, { enabled: () => assert.fail() }).execute({ ...input(), command: null }), value);
  assert.deepEqual(st.calls, [{ p_query: q, p_auth_user_id: actor, p_command: null, p_allow_write: false }]);
});
test("205 finite old business denials and unknown SQL map safely with no retry", async () => {
  for (const code of ["attendance_access_denied", "attendance_open_sessions", "attendance_location_in_use", "attendance_operation_conflict", "private SQL text"]) {
    const st = stub(() => ({ data: null, error: { message: code } })); await assert.rejects(s.createDelegatedConfigurationService(st.service).execute(input()), { code: code === "private SQL text" ? "attendance_unavailable" : code }); assert.equal(st.calls.length, 1);
  }
  const v = await saved(), wrong = stub(() => ok({ ...v, actorId: id(99) })); await assert.rejects(s.createDelegatedConfigurationService(wrong.service).execute(input()));
});
test("205 deadline/cancel does not dispatch late writer after preread and cleans listener", async () => {
  let resolve: ((v: Response) => void) | undefined; const wait = new Promise<Response>(r => { resolve = r; }), st = stub(() => wait), abort = new AbortController();
  const service = s.createDelegatedConfigurationService(st.service, { enabled: () => true, timeoutMs: 20 });
  await assert.rejects(service.execute(input(), abort.signal), { code: "attendance_unavailable" }); resolve?.(ok(missing())); await new Promise(r => setTimeout(r, 10)); assert.equal(st.calls.length, 1); assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(service.execute(input(), cancelled.signal), { code: "attendance_unavailable" }); assert.equal(st.calls.length, 1);
});
