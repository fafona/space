//Synthetic Auth/execute only. No real SQL, current roles, browser or deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleManagementDelegation, managementDelegationDependencies } from "./route-handler";
import { GET, POST, runtime, dynamic } from "./route";
import { MANAGEMENT_DELEGATION_API, MANAGEMENT_DELEGATION_PROTOCOL, managementDelegationQueryString, managementDelegationFingerprintText,
  type ManagementDelegationQuery, type ManagementDelegationCommand, type ManagementDelegationResult } from "@/lib/merchantAttendanceManagementDelegation";
const id = (n: number) => `20200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://www.faolla.com", url = origin + MANAGEMENT_DELEGATION_API, siteId = "99990202", actor = id(1), at = "2026-10-08T12:00:00.123456Z";
const query: ManagementDelegationQuery = { siteId, mode: "write" };
const command: ManagementDelegationCommand = { action: "grant", operationId: id(10), delegateEmployeeId: id(2), delegateAuthUserId: id(3), delegatedAction: "audit_view",
  scope: { kind: "audit_company", sources: ["config"] }, validFrom: at, validUntil: "2026-10-09T12:00:00.123456Z", reason: "合成限定授权" };
type Input = Parameters<typeof managementDelegationDependencies.execute>[0];
const get = (q: ManagementDelegationQuery, headers: Record<string, string> = {}) => new Request(url + "?" + managementDelegationQueryString(q), { headers: { origin, ...headers } });
const post = (value: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
function result(input: Input): ManagementDelegationResult {
  const c = input.command, base = { protocol: MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId: input.authUserId, readAt: at };
  if (c) return { ...base, kind: "receipt", receipt: { operationId: c.operationId, actorId: input.authUserId, action: c.action,
    grantId: c.action === "grant" ? c.operationId : c.grantId, revision: c.action === "grant" ? 1 : 2,
    commandFingerprint: createHash("sha256").update(managementDelegationFingerprintText(input.query.siteId, input.authUserId, c)).digest("hex"), recordedAt: at } };
  if (input.query.mode === "recover") return { ...base, kind: "receipt", receipt: { operationId: input.query.operationId, actorId: input.authUserId,
    action: "grant", grantId: input.query.operationId, revision: 1, commandFingerprint: "a".repeat(64), recordedAt: at } };
  if (input.query.mode !== "list") throw Error("unsupported synthetic detail");
  return { ...base, kind: "list", canGrant: input.allowGrant ?? false, items: [], nextId: null };
}
function setup() {
  const calls: Input[] = [], entitlementCalls: string[] = [];
  const d: typeof managementDelegationDependencies = { authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    allow: () => true, enabled: () => true, entitlement: async site => { entitlementCalls.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof managementDelegationDependencies.entitlement>>; },
    execute: async input => { calls.push(input); return result(input); }, timeoutMs: 12000, bodyTimeoutMs: 5000 };
  return { d, calls, entitlementCalls };
}
test("202 HTTP requires canonical same-origin/password actual Auth and limiter, not browser-supplied owner status", async () => {
  assert.equal(runtime, "nodejs"); assert.equal(dynamic, "force-dynamic"); assert.equal(typeof GET, "function"); assert.equal(typeof POST, "function");
  const s = setup(), body = { query, command };
  const foreign: Record<string, string>[] = [{ origin: "https://other.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of foreign)
    assert.equal((await handleManagementDelegation(post(body, headers), s.d)).status, 403);
  assert.equal((await handleManagementDelegation(new Request(url.replace("www.faolla.com", "other.faolla.com")), s.d)).status, 403);
  for (const methods of [[], ["magiclink"], ["recovery"], ["password", "invite"]])
    assert.equal((await handleManagementDelegation(post(body), { ...s.d, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal((await handleManagementDelegation(post(body), { ...s.d, allow: () => false })).status, 429);
  assert.equal((await handleManagementDelegation(new Request(url, { method: "DELETE" }), s.d)).status, 405); assert.equal(s.calls.length, 0);
});
test("202 strict body/query rejects forged authority/secret, duplicate JSON, bad UTF8, content type and oversize before SQL dispatch", async () => {
  const s = setup(), body = { query, command };
  for (const value of [{ ...body, authUserId: actor }, { ...body, allowGrant: true }, { ...body, authority: {} }, { ...body, command: { ...command, pin: "12345678" } },
    { query: { siteId, mode: "recover", operationId: id(10) }, command }]) assert.equal((await handleManagementDelegation(post(value), s.d)).status, 400);
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff])])
    assert.equal((await handleManagementDelegation(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.d)).status, 400);
  assert.equal((await handleManagementDelegation(post({}, { "content-type": "text/plain" }), s.d)).status, 415);
  assert.equal((await handleManagementDelegation(post({ x: "x".repeat(16400) }), s.d)).status, 413);
  assert.equal((await handleManagementDelegation(post({}, { "content-length": "16400" }), s.d)).status, 413);
  assert.equal((await handleManagementDelegation(new Request(url + "?siteId=" + siteId + "&siteId=" + siteId), s.d)).status, 400);
  assert.equal((await handleManagementDelegation(new Request(url + "?x=1", { method: "POST", headers: { origin }, body: "{}" }), s.d)).status, 400);
  assert.equal(s.calls.length, 0);
});
test("202 no-store response revalidates actual actor/command SHA, exact output and canGrant admission", async () => {
  const s = setup(), response = await handleManagementDelegation(post({ query, command }), s.d);
  assert.equal(response.status, 200); assert.equal(s.calls[0].authUserId, actor); assert.equal(s.calls[0].allowGrant, true); assert.equal(s.calls.length, 1);
  assert.match(response.headers.get("cache-control")!, /private.*no-store/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  for (const mutate of [(v: ManagementDelegationResult) => ({ ...v, private: "secret" }), (v: ManagementDelegationResult) => ({ ...v, actorId: id(90) }),
    (v: ManagementDelegationResult) => v.kind === "receipt" && v.receipt ? { ...v, receipt: { ...v.receipt, commandFingerprint: "f".repeat(64) } } : v]) {
    const bad = await handleManagementDelegation(post({ query, command }), { ...s.d, execute: async input => mutate(result(input)) });
    assert.equal(bad.status, 503); assert.equal((await bad.text()).includes("secret"), false);
  }
  const list: ManagementDelegationQuery = { siteId, mode: "list", state: "all", afterId: null, delegatedAction: null };
  assert.equal((await handleManagementDelegation(get(list), { ...s.d, enabled: () => false, execute: async input => ({ ...result(input), kind: "list", items: [], nextId: null, canGrant: true }) })).status, 503);
});
test("202 flag-off saved same-op POST, original-actor recovery and current-owner revoke reach SQL with false, no current-role pregate", async () => {
  const s = setup(), safe = { ...s.d, enabled: () => false, entitlement: async () => { assert.fail("not needed"); } };
  assert.equal((await handleManagementDelegation(post({ query, command }), safe)).status, 200);
  assert.equal((await handleManagementDelegation(get({ siteId, mode: "recover", operationId: id(10) }), safe)).status, 200);
  const revoke: ManagementDelegationCommand = { action: "revoke", operationId: id(11), grantId: id(10), expectedRevision: 1, reason: "合成撤销" };
  assert.equal((await handleManagementDelegation(post({ query, command: revoke }), { ...s.d, entitlement: async () => { assert.fail("revocation must not depend on entitlement"); } })).status, 200);
  assert(s.calls.every(v => v.allowGrant === false)); assert.equal(s.entitlementCalls.length, 0);
  assert.equal((await handleManagementDelegation(post({ query, command }), { ...s.d, entitlement: async () => { throw Error("private entitlement failure"); } })).status, 200);
  assert.equal(s.calls.at(-1)!.allowGrant, false);
});
test("202 bounded total/body deadlines cancel streams and no late Auth/entitlement can dispatch", async () => {
  const s = setup(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  assert.equal((await handleManagementDelegation(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit), { ...s.d, bodyTimeoutMs: 10 })).status, 400);
  assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  assert.equal((await handleManagementDelegation(get({ siteId, mode: "recover", operationId: id(10) }), { ...s.d, timeoutMs: 10, authenticate: async req => { await held; return s.d.authenticate(req); } })).status, 503);
  release(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  let finish!: () => void; const pending = new Promise<void>(r => { finish = r; });
  assert.equal((await handleManagementDelegation(post({ query, command }), { ...s.d, timeoutMs: 10, entitlement: async site => { await pending; return s.d.entitlement(site); } })).status, 503);
  finish(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  assert.equal((await handleManagementDelegation(get({ siteId, mode: "recover", operationId: id(10) }), { ...s.d, timeoutMs: 12001 })).status, 503);
});
test("202 unknown RPC failure never retries or leaks SQL/credential material", async () => {
  const s = setup(); let count = 0, signal: AbortSignal | undefined;
  const response = await handleManagementDelegation(post({ query, command }), { ...s.d, execute: async input => { count++; signal = input.signal; throw Error("private SQL material"); } });
  assert.equal(response.status, 503); assert.equal(count, 1); assert.equal(signal?.aborted, true); assert.equal((await response.text()).includes("private SQL"), false);
});
