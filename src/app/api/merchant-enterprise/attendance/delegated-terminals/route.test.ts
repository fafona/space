//Synthetic password Auth/HTTP; no actual login, terminal, grant or SQL claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleDelegatedTerminals, delegatedTerminalsHttpDependencies, parseDelegatedTerminalsHttpQuery } from "./route-handler";
import * as p from "@/lib/merchantAttendanceDelegatedCredentials";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://www.faolla.com", siteId = "99990207", actor = id(1), grantId = id(2), operationId = id(3), terminalId = id(4), locationId = id(5), at = "2026-10-09T12:00:00.000001Z";
const secret = "A".repeat(43), query: p.DelegatedCredentialsContextQuery = { siteId, grantId, mode: "context", operationId: null };
const command: p.DelegatedTerminalCommand = { action: "terminal_prepare", operationId, terminalId, locationId, label: "前台", pairHash: createHash("sha256").update(secret).digest("hex"), reason: "明确受托操作" };
const get = (q: p.DelegatedCredentialsQuery) => new Request(origin + p.DELEGATED_TERMINALS_API + "?" + p.delegatedCredentialsQueryString(q), { headers: { origin } });
const postText = (body: string) => new Request(origin + p.DELEGATED_TERMINALS_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
const post = (body: unknown) => postText(JSON.stringify(body));
async function setup() {
  const result: p.DelegatedTerminalResult = { protocol: p.DELEGATED_TERMINALS_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: { operationId, actorId: actor, grantId, action: command.action,
    reference: { kind: "terminal", terminalId, locationId, auditAction: "create" }, commandFingerprint: await p.delegatedTerminalCommandFingerprint(query, actor, command), businessFingerprint: "b".repeat(64), recordedAt: at } };
  const calls: Parameters<typeof delegatedTerminalsHttpDependencies.execute>[0][] = [];
  const deps: typeof delegatedTerminalsHttpDependencies = { authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedTerminalsHttpDependencies.entitlement>>),
    allow: () => true, enabled: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async input => { calls.push(input); return result; } };
  return { result, calls, deps };
}
test("207 terminal GET exact context/recover rejects secrets/duplicates/authority and malformed URL", () => {
  for (const q of [query, { siteId, grantId, mode: "recover", operationId }] as p.DelegatedCredentialsQuery[]) assert.deepEqual(parseDelegatedTerminalsHttpQuery(get(q).url), q);
  for (const suffix of ["&pin=12345678", "&pairSecret=" + secret, "&mode=context", "&p_material=null", "&ownerId=" + actor, "#"]) assert.throws(() => parseDelegatedTerminalsHttpQuery(get(query).url + suffix));
  assert.throws(() => parseDelegatedTerminalsHttpQuery(origin + p.DELEGATED_TERMINALS_API + "?siteId=%ff"));
});
test("207 terminal HTTP uses actual password actor; transient envelope projects only exact durable command/receipt", async () => {
  const st = await setup(), response = await handleDelegatedTerminals(post({ query, command, pairSecret: secret }), st.deps);
  assert.equal(response.status, 200); const text = await response.text(); assert.deepEqual(JSON.parse(text), { ok: true, data: st.result }); assert(!text.includes(secret));
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].authUserId, actor); assert.equal(st.calls[0].allowed, true);
  assert.deepEqual(st.calls[0].command, { command, pairSecret: secret }); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await handleDelegatedTerminals(post({ query, command, pairSecret: secret }), { ...st.deps, execute: async () => ({ ...st.result, receipt: { ...st.result.receipt!, commandFingerprint: "c".repeat(64) } }) })).status, 503);
});
test("207 terminal minimal original GET bypasses current rollout/entitlement but never authentication", async () => {
  const st = await setup(), request = get({ siteId, grantId, mode: "recover", operationId });
  assert.equal((await handleDelegatedTerminals(request, { ...st.deps, enabled: () => assert.fail(), entitlement: async () => assert.fail() })).status, 200);
  assert.equal(st.calls[0].command, null); assert.equal(st.calls[0].allowed, false);
  assert.equal((await handleDelegatedTerminals(request, { ...st.deps, authenticate: async req => ({ ...(await st.deps.authenticate(req)), authenticationMethods: ["recovery"] }) })).status, 403); assert.equal(st.calls.length, 1);
});
test("207 terminal POST rejects missing transient secret, material/authority injection, duplicate JSON and8192byte overflow", async () => {
  const st = await setup();
  for (const body of [{ query, command }, { query, command, pairSecret: secret, p_material: null }, { query, command: { ...command, pairSecret: secret }, pairSecret: secret }, { query, command, pairSecret: secret, authUserId: actor }])
    assert.equal((await handleDelegatedTerminals(post(body), st.deps)).status, 400);
  assert.equal((await handleDelegatedTerminals(postText('{"query":{},"\\u0071uery":{},"command":{}}'), st.deps)).status, 400);
  assert.equal((await handleDelegatedTerminals(postText(" ".repeat(p.DELEGATED_CREDENTIALS_REQUEST_BYTES) + JSON.stringify({ query, command, pairSecret: secret })), st.deps)).status, 413); assert.equal(st.calls.length, 0);
});
test("207 terminal HTTP bounds late Auth/abort and conceals unknown SQL/secret errors", async () => {
  const st = await setup(); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const timed = await handleDelegatedTerminals(post({ query, command, pairSecret: secret }), { ...st.deps, timeoutMs: 15, authenticate: async req => { await wait; return st.deps.authenticate(req); } });
  assert.equal(timed.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
  const bad = await handleDelegatedTerminals(post({ query, command, pairSecret: secret }), { ...st.deps, execute: async () => { throw Error("private SQL " + secret); } });
  assert.equal(bad.status, 503); assert(!(await bad.text()).includes(secret));
  assert.equal((await handleDelegatedTerminals(new Request(post({ query, command, pairSecret: secret }), { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } }), st.deps)).status, 403);
});
