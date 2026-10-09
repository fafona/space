//Synthetic password Auth/HTTP only; no real login, grant, approval or SQL.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { handleDelegatedRevisions, delegatedRevisionsHttpDependencies, parseDelegatedRevisionsHttpQuery } from "./route-handler";
import * as p from "@/lib/merchantAttendanceDelegatedRevisions";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://www.faolla.com", siteId = "99990208", actor = id(1), grantId = id(2), operationId = id(3), requestId = id(4), at = "2026-10-09T12:00:00.000001Z";
const query: p.DelegatedRevisionsContextQuery = { siteId, grantId, mode: "context", requestId };
const command: p.DelegatedRevisionsCommand = { action: "approve", operationId, requestId, expectedRevision: 3, expectedEvidence: "e".repeat(32), expectedBaseOperationId: id(5), reason: "明确受托修订核验" };
const get = (q: p.DelegatedRevisionsQuery) => new Request(origin + p.DELEGATED_REVISIONS_API + "?" + p.delegatedRevisionsQueryString(q), { headers: { origin } });
const postText = (body: string) => new Request(origin + p.DELEGATED_REVISIONS_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
const post = (body: unknown) => postText(JSON.stringify(body));
async function setup() {
  const result: p.DelegatedRevisionsResult = { protocol: p.DELEGATED_REVISIONS_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: { operationId, actorId: actor, grantId, action: "revision_approve",
    reference: { kind: "revision", requestId, rootRequestId: id(6), workerId: id(7), employeeId: id(8), employeeAuthUserId: id(9), requestRevision: command.expectedRevision,
      baseOperationId: command.expectedBaseOperationId, effectRevision: 2 }, commandFingerprint: await p.delegatedRevisionsCommandFingerprint(query, actor, command), businessFingerprint: "b".repeat(64), recordedAt: at } };
  const calls: Parameters<typeof delegatedRevisionsHttpDependencies.execute>[0][] = [];
  const deps: typeof delegatedRevisionsHttpDependencies = { authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedRevisionsHttpDependencies.entitlement>>),
    allow: () => true, enabled: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async input => { calls.push(input); return result; } };
  return { result, calls, deps };
}

test("208 URL exact context/recover only: no list, dual identity, duplicate/secret/authority or malformed UTF8", () => {
  const recover: p.DelegatedRevisionsQuery = { siteId, grantId, mode: "recover", operationId };
  for (const q of [query, recover]) assert.deepEqual(parseDelegatedRevisionsHttpQuery(get(q).url), q);
  for (const suffix of ["&pin=12345678", "&mode=context", "&operationId=" + operationId, "&p_allow_write=true", "&ownerId=" + actor, "#"]) assert.throws(() => parseDelegatedRevisionsHttpQuery(get(query).url + suffix));
  assert.throws(() => parseDelegatedRevisionsHttpQuery(origin + p.DELEGATED_REVISIONS_API + "?siteId=%ff"));
});

test("208 actual password actor POST projects only matching original receipt; operation ref is not invented CAS", async () => {
  const st = await setup(), response = await handleDelegatedRevisions(post({ query, command }), st.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, data: st.result });
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].authUserId, actor); assert.equal(st.calls[0].allowed, true); assert.deepEqual(st.calls[0].command, command);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await handleDelegatedRevisions(post({ query, command }), { ...st.deps, execute: async () => ({ ...st.result, receipt: st.result.kind === "receipt" && st.result.receipt ? { ...st.result.receipt, commandFingerprint: "c".repeat(64) } : null }) })).status, 503);
});

test("208 original GET is independent of new-write flags/entitlement, but remains original actual password actor", async () => {
  const st = await setup(), request = get({ siteId, grantId, mode: "recover", operationId });
  assert.equal((await handleDelegatedRevisions(request, { ...st.deps, enabled: () => assert.fail(), entitlement: async () => assert.fail() })).status, 200);
  assert.equal(st.calls[0].command, null); assert.equal(st.calls[0].allowed, false);
  assert.equal((await handleDelegatedRevisions(request, { ...st.deps, authenticate: async req => ({ ...(await st.deps.authenticate(req)), authenticationMethods: ["recovery"] }) })).status, 403); assert.equal(st.calls.length, 1);
});

test("208 request rejects annul/authority injections/duplicates,7key overflow/recover POST;8192byte transport cap unchanged", async () => {
  const st = await setup();
  for (const body of [{ query, command: { ...command, action: "annul" } }, { query, command, p_material: null }, { query, command: { ...command, ownerId: actor } },
    { query, command, authUserId: actor }, { query: { siteId, grantId, mode: "recover", operationId }, command }, { query, command: { ...command, reason: "x".repeat(4096) } }])
    assert.equal((await handleDelegatedRevisions(post(body), st.deps)).status, 400);
  assert.equal((await handleDelegatedRevisions(postText('{"query":{},"\\u0071uery":{},"command":{}}'), st.deps)).status, 400);
  assert.equal((await handleDelegatedRevisions(postText(" ".repeat(p.DELEGATED_REVISIONS_REQUEST_BYTES) + JSON.stringify({ query, command })), st.deps)).status, 413); assert.equal(st.calls.length, 0);
});

test("208 HTTP deadline/late Auth/abort and private failures cannot leak or dispatch late writer", async () => {
  const st = await setup(); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const timed = await handleDelegatedRevisions(post({ query, command }), { ...st.deps, timeoutMs: 15, authenticate: async req => { await wait; return st.deps.authenticate(req); } });
  assert.equal(timed.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
  const bad = await handleDelegatedRevisions(post({ query, command }), { ...st.deps, execute: async () => { throw Error("private SQL/body unavailable"); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes("private SQL/body"));
  const changed = await handleDelegatedRevisions(post({ query, command }), { ...st.deps, execute: async () => { throw new MerchantAttendanceError("attendance_management_delegation_changed"); } }); assert.equal(changed.status, 409);
  const foreign = new Request(post({ query, command }), { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } });
  assert.equal((await handleDelegatedRevisions(foreign, st.deps)).status, 403);
});
