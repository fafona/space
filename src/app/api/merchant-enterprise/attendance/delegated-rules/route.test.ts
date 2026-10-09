//Synthetic password Auth/HTTP only: not a real login or SQL executor acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleDelegatedRules, delegatedRulesHttpDependencies, parseDelegatedRulesHttpQuery } from "./route-handler";
import { handleDelegatedConfiguration } from "../delegated-configuration/route-handler";
import { emptyAttendanceRuleDraft } from "@/lib/merchantAttendanceRuleDraft";
import * as p from "@/lib/merchantAttendanceDelegatedRules";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const origin = "https://www.faolla.com", siteId = "99990206", actor = id(1), grantId = id(2), at = "2026-10-08T15:00:00.000001Z";
const query: Extract<p.DelegatedRulesQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const command: p.DelegatedRulesCommand = { family: "base", decision: { action: "save_draft", operationId: id(3), expectedRevision: 0, reason: "合成规则", expectedSettingsVersion: 1,
  expectedGroupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft() } };
const get = (q: p.DelegatedRulesQuery) => new Request(origin + p.DELEGATED_RULES_API + "?" + p.delegatedRulesQueryString(q), { headers: { origin } });
const postText = (text: string) => new Request(origin + p.DELEGATED_RULES_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body: text });
const post = (body: unknown) => postText(JSON.stringify(body));
async function setup() {
  const result: p.DelegatedRulesResult = { protocol: p.DELEGATED_RULES_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: {
    operationId: command.decision.operationId, actorId: actor, grantId, family: command.family, action: "rule_draft", referenceId: command.decision.operationId, revision: 1,
    commandFingerprint: await p.delegatedRulesCommandFingerprint(query, actor, command), businessFingerprint: "a".repeat(64), recordedAt: at } };
  const calls: Parameters<typeof delegatedRulesHttpDependencies.execute>[0][] = [];
  const deps: typeof delegatedRulesHttpDependencies = {
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedRulesHttpDependencies.entitlement>>),
    enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async input => { calls.push(input); return result; },
  };
  return { result, calls, deps };
}
test("206 HTTP four exact query modes and keyset JSON roundtrip; caller authority/duplicate fields reject", () => {
  for (const q of [query, { siteId, grantId, mode: "recover", operationId: id(3) }, { siteId, grantId, mode: "history", cursor: { siteId, grantId, atRevision: 26, beforeRevision: 2 } },
    { siteId, grantId, mode: "preview", sourceDraftRevision: 1, effectiveOn: "2026-10-09", endsOn: null }] as p.DelegatedRulesQuery[]) assert.deepEqual(parseDelegatedRulesHttpQuery(get(q).url), q);
  for (const suffix of ["&mode=context", "&ownerId=" + actor, "&allowWrite=true", "&scope=enterprise"]) assert.throws(() => parseDelegatedRulesHttpQuery(get(query).url + suffix));
  assert.throws(() => parseDelegatedRulesHttpQuery(origin + p.DELEGATED_RULES_API + "?siteId=%ff"));
});
test("206 HTTP uses only validated actual password Auth and verifies full returned intent", async () => {
  const st = await setup(), response = await handleDelegatedRules(post({ query, command }), st.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, data: st.result });
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].authUserId, actor); assert.equal(st.calls[0].allowed, true); assert.deepEqual(st.calls[0].command, command);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await handleDelegatedRules(post({ query, command }), { ...st.deps, execute: async () => ({ ...st.result, receipt: { ...st.result.receipt!, commandFingerprint: "f".repeat(64) } }) })).status, 503);
});
test("206 original minimal GET bypasses current rollout/entitlement but still requires real Auth", async () => {
  const st = await setup(), q: p.DelegatedRulesQuery = { siteId, grantId, mode: "recover", operationId: command.decision.operationId };
  const response = await handleDelegatedRules(get(q), { ...st.deps, enabled: () => assert.fail(), entitlement: async () => assert.fail() });
  assert.equal(response.status, 200); assert.equal(st.calls[0].command, null); assert.equal(st.calls[0].allowed, false);
  const denied = await handleDelegatedRules(get(q), { ...st.deps, authenticate: async request => ({ ...(await st.deps.authenticate(request)), authenticationMethods: ["recovery"] }) });
  assert.equal(denied.status, 403); assert.equal(st.calls.length, 1);
});
test("20649KiB adapter accepts bounded legal JSON above16KiB without widening old2058KiB", async () => {
  const st = await setup(), text = " ".repeat(20000) + JSON.stringify({ query, command });
  assert.equal((await handleDelegatedRules(postText(text), st.deps)).status, 200);
  assert.equal((await handleDelegatedRules(postText(" ".repeat(p.DELEGATED_RULES_REQUEST_BYTES) + JSON.stringify({ query, command })), st.deps)).status, 413);
  const old = new Request(origin + "/api/merchant-enterprise/attendance/delegated-configuration", { method: "POST", headers: { origin, "content-type": "application/json" }, body: text });
  assert.equal((await handleDelegatedConfiguration(old, { authenticate: st.deps.authenticate, allow: () => true })).status, 413); assert.equal(st.calls.length, 1);
});
test("206 authority injection/duplicate JSON/origin/verb/contenttype reject before execution", async () => {
  const st = await setup();
  for (const body of [{ query, command, authUserId: actor }, { query, command: { ...command, ownerId: actor } }, { query: { ...query, subject: "enterprise" }, command }]) assert.equal((await handleDelegatedRules(post(body), st.deps)).status, 400);
  assert.equal((await handleDelegatedRules(postText('{"query":{},"\\u0071uery":{},"command":{}}'), st.deps)).status, 400);
  assert.equal((await handleDelegatedRules(new Request(post({ query, command }), { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } }), st.deps)).status, 403);
  assert.equal((await handleDelegatedRules(new Request(origin + p.DELEGATED_RULES_API, { method: "DELETE" }), st.deps)).status, 405);
  assert.equal((await handleDelegatedRules(new Request(origin + p.DELEGATED_RULES_API, { method: "POST", headers: { origin, "content-type": "text/plain" }, body: "{}" }), st.deps)).status, 415); assert.equal(st.calls.length, 0);
});
test("206 bounded late Auth cannot dispatch, and unknown private SQL/errors never escape", async () => {
  const st = await setup(); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const response = await handleDelegatedRules(post({ query, command }), { ...st.deps, timeoutMs: 15, authenticate: async request => { await wait; return st.deps.authenticate(request); } });
  assert.equal(response.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
  const bad = await handleDelegatedRules(post({ query, command }), { ...st.deps, execute: async () => { throw Error("private SQL credential"); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes("credential"));
});
