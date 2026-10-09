//Synthetic password Auth + HTTP projection only, not real SQL/login proof.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { delegatedPlanExceptionsModel as model } from "../../../../../../scripts/fixtures/attendance-delegated-plan-exceptions-model";
import { handleDelegatedPlanExceptions, delegatedPlanExceptionsHttpDependencies, parseDelegatedPlanExceptionsHttpQuery } from "./route-handler";
import * as p from "@/lib/merchantAttendanceDelegatedPlanExceptions";
const origin = "https://www.faolla.com";
const postText = (body: string) => new Request(origin + p.DELEGATED_PLAN_EXCEPTIONS_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
const post = (body: unknown) => postText(JSON.stringify(body));
const get = (query: p.DelegatedPlanExceptionsQuery) => new Request(origin + p.DELEGATED_PLAN_EXCEPTIONS_API + "?" + p.delegatedPlanExceptionsQueryString(query), { headers: { origin } });
function setup() {
  const f = model(), calls: Parameters<typeof delegatedPlanExceptionsHttpDependencies.execute>[0][] = [], deps: typeof delegatedPlanExceptionsHttpDependencies = {
    authenticate: async () => ({ user: { id: f.actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedPlanExceptionsHttpDependencies.entitlement>>),
    allow: () => true, enabled: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async input => { calls.push(input); return f.receipt; },
  }; return { f, calls, deps };
}
test("209 URL exact target/recover; duplicate/malformed UTF8/owner/authority injections rejected", () => {
  const { f } = setup(); for (const q of [f.query, f.recover]) assert.deepEqual(parseDelegatedPlanExceptionsHttpQuery(get(q).url), q);
  for (const suffix of ["&mode=context", "&operationId=" + f.command.operationId, "&ownerId=" + f.actor, "&p_allow_posthoc=true", "#"]) assert.throws(() => parseDelegatedPlanExceptionsHttpQuery(get(f.query).url + suffix));
  assert.throws(() => parseDelegatedPlanExceptionsHttpQuery(origin + p.DELEGATED_PLAN_EXCEPTIONS_API + "?siteId=%ff"));
});
test("209 actual password actor POST strict minimum receipt, no cache or private failures", async () => {
  const st = setup(), response = await handleDelegatedPlanExceptions(post({ query: st.f.query, command: st.f.command }), st.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, data: st.f.receipt }); assert.equal(st.calls.length, 1);
  assert.equal(st.calls[0].authUserId, st.f.actor); assert.equal(st.calls[0].allowed, true); assert.deepEqual(st.calls[0].command, st.f.command);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const bad = await handleDelegatedPlanExceptions(post({ query: st.f.query, command: st.f.command }), { ...st.deps, execute: async () => { throw Error("Private SQL body secret"); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes("Private SQL"));
});
test("209 original GET independent of gates/entitlement, still password actual actor; no recovery-session writes", async () => {
  const st = setup(); assert.equal((await handleDelegatedPlanExceptions(get(st.f.recover), { ...st.deps, enabled: () => assert.fail(), entitlement: async () => assert.fail() })).status, 200);
  assert.equal(st.calls[0].allowed, false); assert.equal(st.calls[0].command, null);
  assert.equal((await handleDelegatedPlanExceptions(get(st.f.recover), { ...st.deps, authenticate: async req => ({ ...(await st.deps.authenticate(req)), authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal(st.calls.length, 1);
});
test("209 no caller capability/Auth/annul/unknown keys/duplicate JSON; original 8192-byte transport limit", async () => {
  const st = setup(), { query, command } = st.f;
  for (const body of [{ query, command: { ...command, action: "annul" } }, { query, command, authUserId: st.f.actor }, { query, command, p_allow_write: true },
    { query: st.f.recover, command }, { query, command: { ...command, note: "x".repeat(4096) } }]) assert.equal((await handleDelegatedPlanExceptions(post(body), st.deps)).status, 400);
  assert.equal((await handleDelegatedPlanExceptions(postText('{"query":{},"\\u0071uery":{},"command":{}}'), st.deps)).status, 400);
  assert.equal((await handleDelegatedPlanExceptions(postText(" ".repeat(p.DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES) + JSON.stringify({ query, command })), st.deps)).status, 413); assert.equal(st.calls.length, 0);
  assert.equal((await handleDelegatedPlanExceptions(new Request(post({ query, command }), { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } }), st.deps)).status, 403);
});
test("209 bounded late Auth cannot dispatch writer or project stale receipt", async () => {
  const st = setup(); let release!: () => void; const wait = new Promise<void>(done => { release = done; });
  const timed = await handleDelegatedPlanExceptions(post({ query: st.f.query, command: st.f.command }), { ...st.deps, timeoutMs: 10, authenticate: async req => { await wait; return st.deps.authenticate(req); } });
  assert.equal(timed.status, 503); release(); await new Promise<void>(done => setImmediate(done)); assert.equal(st.calls.length, 0);
});
