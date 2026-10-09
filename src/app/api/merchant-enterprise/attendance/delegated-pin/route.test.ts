//Synthetic password Auth/HTTP only; executes neither real KDF nor SQL.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleDelegatedPin, delegatedPinHttpDependencies, parseDelegatedPinHttpQuery } from "./route-handler";
import * as p from "@/lib/merchantAttendanceDelegatedCredentials";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://www.faolla.com", siteId = "99990207", actor = id(1), grantId = id(2), operationId = id(3), workerId = id(4), employeeId = id(5), employeeAuthUserId = id(6), at = "2026-10-09T12:00:00.000001Z";
const query: p.DelegatedCredentialsContextQuery = { siteId, grantId, mode: "context", operationId: null }, pin = "12345678";
const command: p.DelegatedMemberPinCommand = { kind: "member_pin", action: "pin_issue", operationId, workerId, employeeId, employeeAuthUserId, workerNo: "员工01", expectedRevision: 1, reason: "明确受托操作" };
const get = (q: p.DelegatedCredentialsQuery) => new Request(origin + p.DELEGATED_PIN_API + "?" + p.delegatedCredentialsQueryString(q), { headers: { origin } });
const postText = (body: string) => new Request(origin + p.DELEGATED_PIN_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
const post = (body: unknown) => postText(JSON.stringify(body));
async function setup(c: p.DelegatedPinCommand = command) {
  const result: p.DelegatedPinResult = { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: { operationId, actorId: actor, grantId, action: c.action,
    reference: c.kind === "member_pin" ? { kind: c.kind, workerId, employeeId, employeeAuthUserId, revision: 2 } : { kind: c.kind, workerId, subjectId: c.subjectId, subjectRevision: 3, generation: c.action === "pin_revoke" ? 2 : 1, workerVersion: 4, credentialRevision: 2 },
    commandFingerprint: await p.delegatedPinCommandFingerprint(query, actor, c), businessFingerprint: "b".repeat(64), recordedAt: at } };
  const calls: Parameters<typeof delegatedPinHttpDependencies.execute>[0][] = [];
  const deps: typeof delegatedPinHttpDependencies = { authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedPinHttpDependencies.entitlement>>),
    allow: () => true, enabled: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async input => { calls.push(input); return result; } };
  return { result, calls, deps };
}
test("207 PIN GET exact scoped context/original modes reject PIN/material/authority and directory keys", () => {
  for (const q of [query, { siteId, grantId, mode: "recover", operationId }] as p.DelegatedCredentialsQuery[]) assert.deepEqual(parseDelegatedPinHttpQuery(get(q).url), q);
  for (const suffix of ["&pin=" + pin, "&pairSecret=x", "&p_material=null", "&mode=context", "&workerId=" + workerId, "&allowWrite=true", "&cursor="])
    assert.throws(() => parseDelegatedPinHttpQuery(get(query).url + suffix));
});
test("207 HTTP member/independent issue ephemeral PIN is not projected, revoke accepts no secret", async () => {
  const independent: p.DelegatedIndependentPinCommand = { kind: "independent_pin", action: "pin_issue", operationId, workerId, subjectId: id(7), expectedSubjectRevision: 2,
    expectedGeneration: 1, expectedWorkerVersion: 3, expectedSettingsVersion: 4, expectedCredentialRevision: 1, reason: "明确受托操作" };
  for (const c of [command, independent, { ...command, action: "pin_revoke" as const }]) {
    const st = await setup(c), body = c.action === "pin_issue" ? { query, command: c, pin } : { query, command: c };
    const response = await handleDelegatedPin(post(body), st.deps); assert.equal(response.status, 200); const text = await response.text(); assert(!text.includes(pin));
    assert.deepEqual(JSON.parse(text), { ok: true, data: st.result }); assert.equal(st.calls[0].authUserId, actor); assert.equal(st.calls[0].allowed, true);
    assert.deepEqual(st.calls[0].command, { command: c, pin: c.action === "pin_issue" ? pin : null });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
test("207 PIN original GET remains flagoff/entitlement independent and full original identity checks still apply", async () => {
  const st = await setup(), request = get({ siteId, grantId, mode: "recover", operationId });
  assert.equal((await handleDelegatedPin(request, { ...st.deps, enabled: () => assert.fail(), entitlement: async () => assert.fail() })).status, 200);
  assert.equal(st.calls[0].command, null); assert.equal(st.calls[0].allowed, false);
  assert.equal((await handleDelegatedPin(request, { ...st.deps, authenticate: async req => ({ ...(await st.deps.authenticate(req)), authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleDelegatedPin(post({ query, command, pin }), { ...st.deps, execute: async () => ({ ...st.result, receipt: { ...st.result.receipt!, commandFingerprint: "c".repeat(64) } }) })).status, 503);
});
test("207 PIN body rejects material/secret leakage, missing or revokePIN, duplicateJSON and8192byte overflow before execute", async () => {
  const st = await setup();
  for (const body of [{ query, command }, { query, command, pin, p_material: { verified: true } }, { query, command: { ...command, pin }, pin },
    { query, command, pin, authUserId: actor }, { query, command: { ...command, action: "pin_revoke" }, pin }, { query, command, pin: "1234" }])
    assert.equal((await handleDelegatedPin(post(body), st.deps)).status, 400);
  assert.equal((await handleDelegatedPin(postText('{"query":{},"command":{},"pin":"12345678","\\u0070in":"87654321"}'), st.deps)).status, 400);
  assert.equal((await handleDelegatedPin(postText(" ".repeat(p.DELEGATED_CREDENTIALS_REQUEST_BYTES) + JSON.stringify({ query, command, pin })), st.deps)).status, 413); assert.equal(st.calls.length, 0);
});
test("207 PIN HTTP unknown/private errors, late Auth and abort never emit secrets or dispatch late", async () => {
  const st = await setup(); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const timed = await handleDelegatedPin(post({ query, command, pin }), { ...st.deps, timeoutMs: 15, authenticate: async req => { await wait; return st.deps.authenticate(req); } });
  assert.equal(timed.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal((await handleDelegatedPin(new Request(post({ query, command, pin }), { signal: controller.signal }), st.deps)).status, 503); assert.equal(st.calls.length, 0);
  const bad = await handleDelegatedPin(post({ query, command, pin }), { ...st.deps, execute: async () => { throw Error("private SQL " + pin); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes(pin));
});
