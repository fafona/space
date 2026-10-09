//Synthetic password Auth and mocked transport only; no real login/SQL call.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleDelegatedGroups, delegatedGroupsHttpDependencies, parseDelegatedGroupsHttpQuery } from "./route-handler";
import * as p from "@/lib/merchantAttendanceDelegatedGroups";
import type { GroupsCommand } from "@/lib/merchantAttendanceGroups";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const origin = "https://www.faolla.com", path = "/api/merchant-enterprise/attendance/delegated-groups", siteId = "99990204", actor = id(1), grantId = id(2);
const query: p.DelegatedGroupsQuery = { siteId, grantId, mode: "context", operationId: null };
const command: GroupsCommand = { action: "save_group", operationId: id(3), groupId: id(3), expectedRevision: 0, name: "Kitchen", description: "", active: true, reason: "Synthetic grouping" };
const get = (q: p.DelegatedGroupsQuery) => new Request(origin + path + "?" + new URLSearchParams(Object.entries(q).map(([k, v]) => [k, v === null ? "" : v])), { headers: { origin } });
const post = (body: unknown) => new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
async function setup() {
  const result: p.DelegatedGroupsResult = { protocol: p.DELEGATED_GROUPS_PROTOCOL, siteId, actorId: actor, readAt: "2026-10-08T15:00:00.000002Z", kind: "receipt", receipt: {
    operationId: command.operationId, actorId: actor, grantId, action: "group_save", referenceId: id(3), revision: 1,
    commandFingerprint: await p.delegatedGroupsCommandFingerprint(query, actor, command), businessFingerprint: "a".repeat(64), recordedAt: "2026-10-08T15:00:00.000001Z",
  } };
  const calls: Parameters<typeof delegatedGroupsHttpDependencies.execute>[0][] = [];
  const deps: typeof delegatedGroupsHttpDependencies = {
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedGroupsHttpDependencies.entitlement>>),
    enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    execute: async input => { calls.push(input); return result; },
  };
  return { result, calls, deps };
}
test("204 HTTP exact queries reject duplicate keys, injected identities and incompatible modes", () => {
  assert.deepEqual(parseDelegatedGroupsHttpQuery(get(query).url), query);
  for (const suffix of ["&mode=context", "&authUserId=" + actor, "&allowWrite=true", "&scope=company"]) assert.throws(() => parseDelegatedGroupsHttpQuery(get(query).url + suffix));
  assert.throws(() => parseDelegatedGroupsHttpQuery(get(query).url.replace("mode=context", "mode=recover")));
});
test("204 HTTP binds actual password Auth and validates full submitted receipt SHA", async () => {
  const st = await setup(), response = await handleDelegatedGroups(post({ query, command }), st.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, data: st.result });
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].authUserId, actor); assert.equal(st.calls[0].allowed, true);
  assert.deepEqual(st.calls[0].command, command); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const bad = await handleDelegatedGroups(post({ query, command }), { ...st.deps, execute: async () => ({ ...st.result, receipt: { ...st.result.receipt!, commandFingerprint: "b".repeat(64) } }) });
  assert.equal(bad.status, 503);
});
test("204 original GET is command-free and independent of new-write gate/entitlement", async () => {
  const st = await setup(), recovery: p.DelegatedGroupsQuery = { siteId, grantId, mode: "recover", operationId: command.operationId };
  const response = await handleDelegatedGroups(get(recovery), { ...st.deps, enabled: () => assert.fail("recovery skips rollout"), entitlement: async () => assert.fail("recovery skips current entitlement") });
  assert.equal(response.status, 200); assert.equal(st.calls.length, 1); assert.equal(st.calls[0].command, null); assert.equal(st.calls[0].allowed, false);
  assert.deepEqual(st.calls[0].query, recovery);
});
test("204 invalid JSON/authority, wrong origin, recovery-only Auth and oversized payload stop before executor", async () => {
  const st = await setup();
  for (const body of [{ query, command, authUserId: actor }, { query, command: { ...command, ownerId: actor } }, { query: { ...query, grantId: "invalid" }, command }]) {
    assert.equal((await handleDelegatedGroups(post(body), st.deps)).status, 400);
  }
  const foreign = new Request(post({ query, command }), { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } });
  assert.equal((await handleDelegatedGroups(foreign, st.deps)).status, 403);
  assert.equal((await handleDelegatedGroups(post({ query, command }), { ...st.deps, authenticate: async () => ({ ...(await st.deps.authenticate(post({ query, command }))), authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleDelegatedGroups(post({ query, command: { ...command, reason: "中".repeat(3000) } }), st.deps)).status, 413);
  assert.equal((await handleDelegatedGroups(new Request(origin + path, { method: "DELETE" }), st.deps)).status, 405);
  assert.equal((await handleDelegatedGroups(new Request(origin + path, { method: "POST", headers: { origin, "content-type": "text/plain" }, body: "{}" }), st.deps)).status, 415);
  assert.equal(st.calls.length, 0);
});
test("204 HTTP late Auth never dispatches SQL after deadline, and errors redact private details", async () => {
  const st = await setup(); let release!: () => void;
  const pending = new Promise<void>(r => { release = r; });
  const response = await handleDelegatedGroups(post({ query, command }), { ...st.deps, timeoutMs: 15, authenticate: async request => { await pending; return st.deps.authenticate(request); } });
  assert.equal(response.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
  const bad = await handleDelegatedGroups(post({ query, command }), { ...st.deps, execute: async () => { throw Error("private SQL credential"); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes("credential"));
});
