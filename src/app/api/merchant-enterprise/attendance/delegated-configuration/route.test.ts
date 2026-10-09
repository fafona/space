//Synthetic password Auth and bounded transport only, not real login or SQL.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleDelegatedConfiguration, delegatedConfigurationHttpDependencies, parseDelegatedConfigurationHttpQuery } from "./route-handler";
import * as p from "@/lib/merchantAttendanceDelegatedConfiguration";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const origin = "https://www.faolla.com", path = p.DELEGATED_CONFIGURATION_API, siteId = "99990205", actor = id(1), grantId = id(2);
const query: p.DelegatedConfigurationQuery = { siteId, grantId, mode: "context", operationId: null };
const command: p.DelegatedConfigurationCommand = { kind: "location", operationId: id(3), expectedVersion: 2,
  values: { id: id(4), name: "Kitchen", timeZone: "Europe/Madrid", active: true } };
const get = (q: p.DelegatedConfigurationQuery) => new Request(origin + path + "?" + p.delegatedConfigurationQueryString(q), { headers: { origin } });
const post = (body: unknown) => new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
async function setup() {
  const result: p.DelegatedConfigurationResult = { protocol: p.DELEGATED_CONFIGURATION_PROTOCOL, siteId, actorId: actor, readAt: "2026-10-08T15:00:00.000002Z", kind: "receipt", receipt: {
    operationId: command.operationId, actorId: actor, grantId, action: "location_save", referenceId: command.values.id, revision: command.expectedVersion + 1,
    commandFingerprint: await p.delegatedConfigurationCommandFingerprint(query, actor, command), businessFingerprint: "a".repeat(64), recordedAt: "2026-10-08T15:00:00.000001Z",
  } };
  const calls: Parameters<typeof delegatedConfigurationHttpDependencies.execute>[0][] = [];
  const deps: typeof delegatedConfigurationHttpDependencies = {
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedConfigurationHttpDependencies.entitlement>>),
    enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    execute: async input => { calls.push(input); return result; },
  };
  return { result, calls, deps };
}
test("205 HTTP context is four exact fields, no identity/allowance injection or incompatible recovery", () => {
  assert.deepEqual(parseDelegatedConfigurationHttpQuery(get(query).url), query);
  for (const suffix of ["&mode=context", "&authUserId=" + actor, "&allowWrite=true", "&scope=company"]) assert.throws(() => parseDelegatedConfigurationHttpQuery(get(query).url + suffix));
  assert.throws(() => parseDelegatedConfigurationHttpQuery(get(query).url.replace("mode=context", "mode=recover")));
});
test("205 HTTP actual password Auth and full submitted intent govern the receipt", async () => {
  const st = await setup(), response = await handleDelegatedConfiguration(post({ query, command }), st.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, data: st.result });
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].authUserId, actor); assert.equal(st.calls[0].allowed, true);
  assert.deepEqual(st.calls[0].command, command); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const bad = await handleDelegatedConfiguration(post({ query, command }), { ...st.deps, execute: async () => ({ ...st.result, receipt: { ...st.result.receipt!, revision: 4 } }) });
  assert.equal(bad.status, 503);
});
test("205 original GET is minimal and independent of new rollout and entitlements", async () => {
  const st = await setup(), recovery: p.DelegatedConfigurationQuery = { siteId, grantId, mode: "recover", operationId: command.operationId };
  const response = await handleDelegatedConfiguration(get(recovery), { ...st.deps, enabled: () => assert.fail("no current rollout for recovery"), entitlement: async () => assert.fail("no current entitlement for recovery") });
  assert.equal(response.status, 200); assert.equal(st.calls.length, 1); assert.equal(st.calls[0].command, null); assert.equal(st.calls[0].allowed, false);
});
test("205 JSON authority, recovery Auth, origin, verb, content type and byte limit reject before execution", async () => {
  const st = await setup();
  for (const body of [{ query, command, authUserId: actor }, { query, command: { ...command, ownerId: actor } }, { query, command: { ...command, kind: "settings" } }]) {
    assert.equal((await handleDelegatedConfiguration(post(body), st.deps)).status, 400);
  }
  assert.equal((await handleDelegatedConfiguration(new Request(post({ query, command }), { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } }), st.deps)).status, 403);
  assert.equal((await handleDelegatedConfiguration(post({ query, command }), { ...st.deps, authenticate: async () => ({ ...(await st.deps.authenticate(post({ query, command }))), authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleDelegatedConfiguration(post({ query, command: { ...command, values: { ...command.values, name: "中".repeat(3000) } } }), st.deps)).status, 413);
  assert.equal((await handleDelegatedConfiguration(new Request(origin + path, { method: "DELETE" }), st.deps)).status, 405);
  assert.equal((await handleDelegatedConfiguration(new Request(origin + path, { method: "POST", headers: { origin, "content-type": "text/plain" }, body: "{}" }), st.deps)).status, 415);
  assert.equal(st.calls.length, 0);
});
test("205 late Auth and private executor faults cannot dispatch late or leak private details", async () => {
  const st = await setup(); let release!: () => void;
  const pending = new Promise<void>(r => { release = r; });
  const response = await handleDelegatedConfiguration(post({ query, command }), { ...st.deps, timeoutMs: 15,
    authenticate: async request => { await pending; return st.deps.authenticate(request); } });
  assert.equal(response.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
  const bad = await handleDelegatedConfiguration(post({ query, command }), { ...st.deps, execute: async () => { throw Error("private SQL credential"); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes("credential"));
});
