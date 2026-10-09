//Synthetic route seam only. No configured Auth, PostgreSQL or browser opened.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleDelegatedAudit, delegatedAuditDependencies } from "./route-handler";
import { GET, POST, runtime, dynamic } from "./route";
import { DELEGATED_AUDIT_API, DELEGATED_AUDIT_PROTOCOL, delegatedAuditQueryString, delegatedAuditFingerprintText,
  type DelegatedAuditExportQuery, type DelegatedAuditQuery, type DelegatedAuditCommand, type DelegatedAuditResult } from "@/lib/merchantAttendanceDelegatedAudit";
const id = (n: number) => `20300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://www.faolla.com", url = origin + DELEGATED_AUDIT_API, siteId = "99990203", actor = id(1), at = "2026-10-08T12:00:00.000001Z", grantId = id(2);
const query: DelegatedAuditExportQuery = { siteId, grantId, mode: "export", source: "config", fromAt: "2026-10-08T00:00:00.000000Z", toAt: "2026-10-09T00:00:00.000000Z" };
const command: DelegatedAuditCommand = { action: "export", operationId: id(3) };
type Input = Parameters<typeof delegatedAuditDependencies.execute>[0];
const get = (q: DelegatedAuditQuery, headers: Record<string, string> = {}) => new Request(url + "?" + delegatedAuditQueryString(q), { headers: { origin, ...headers } });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
function result(input: Input, fresh = false): DelegatedAuditResult {
  const q = input.query, base = { protocol: DELEGATED_AUDIT_PROTOCOL, siteId, actorId: input.authUserId, readAt: at };
  if (q.mode === "recover") return { ...base, kind: "receipt", receipt: null };
  if (q.mode === "list") return { ...base, grantId, source: q.source, scopeKind: "audit_company", target: null, kind: "list", asOf: at, items: [], nextCursor: null };
  if (q.mode !== "export" || !input.command) throw Error("unsupported synthetic detail");
  const receipt = { operationId: input.command.operationId, actorId: input.authUserId, grantId, action: "export" as const,
    commandFingerprint: createHash("sha256").update(delegatedAuditFingerprintText(q, input.authUserId, input.command)).digest("hex"), asOf: at, count: 0, resultFingerprint: "a".repeat(64), recordedAt: at };
  return fresh ? { ...base, grantId, source: q.source, scopeKind: "audit_company", target: null, kind: "export", receipt,
    payload: { schemaVersion: 1, fromAt: q.fromAt, toAt: q.toAt, asOf: at, count: 0, rows: [] } } : { ...base, kind: "receipt", receipt };
}
function setup() {
  const calls: Input[] = [], entitlementCalls: string[] = [];
  const d: typeof delegatedAuditDependencies = { authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    enabled: () => true, allow: () => true, allowExport: () => true, entitlement: async site => { entitlementCalls.push(site);
      return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof delegatedAuditDependencies.entitlement>>; },
    execute: async input => { calls.push(input); return result(input); }, timeoutMs: 12000, bodyTimeoutMs: 5000 };
  return { calls, entitlementCalls, d };
}
test("203 route requires canonical same-origin/password actual actor, independent read/export rate guards", async () => {
  assert.equal(runtime, "nodejs"); assert.equal(dynamic, "force-dynamic"); assert.equal(typeof GET, "function"); assert.equal(typeof POST, "function");
  const s = setup(); const foreign: Record<string, string>[] = [{ origin: "https://other.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of foreign) assert.equal((await handleDelegatedAudit(post({ query, command }, headers), s.d)).status, 403);
  for (const methods of [[], ["magiclink"], ["password", "invite"]]) assert.equal((await handleDelegatedAudit(post({ query, command }), { ...s.d,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal((await handleDelegatedAudit(new Request(url.replace("www.faolla.com", "other.faolla.com")), s.d)).status, 403);
  assert.equal((await handleDelegatedAudit(post({ query, command }), { ...s.d, allow: () => false })).status, 429);
  assert.equal((await handleDelegatedAudit(post({ query, command }), { ...s.d, allowExport: () => false })).status, 429);
  assert.equal((await handleDelegatedAudit(new Request(url, { method: "DELETE" }), s.d)).status, 405); assert.equal(s.calls.length, 0);
});
test("203 route exact body/query/Accept/UTF8/bytes rejects authority smuggling before dispatch", async () => {
  const s = setup(); for (const value of [{ query, command, authUserId: actor }, { query, command, allowAccess: true }, { query: { ...query, employeeAuthUserId: id(9) }, command },
    { query, command: { ...command, grantId } }, { query: { siteId, mode: "recover", operationId: command.operationId }, command }]) assert.equal((await handleDelegatedAudit(post(value), s.d)).status, 400);
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff])]) assert.equal((await handleDelegatedAudit(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.d)).status, 400);
  assert.equal((await handleDelegatedAudit(post({}, { "content-type": "text/plain" }), s.d)).status, 415);
  assert.equal((await handleDelegatedAudit(post({ value: "x".repeat(16400) }), s.d)).status, 413);
  assert.equal((await handleDelegatedAudit(post({}, { "content-length": "16400" }), s.d)).status, 413);
  assert.equal((await handleDelegatedAudit(post({ query, command }, { accept: "text/html" }), s.d)).status, 400);
  assert.equal((await handleDelegatedAudit(get({ siteId, mode: "recover", operationId: command.operationId }, { accept: "text/csv" }), s.d)).status, 400);
  assert.equal((await handleDelegatedAudit(new Request(url + "?x=1", { method: "POST", headers: { origin }, body: "{}" }), s.d)).status, 400);
  assert.equal((await handleDelegatedAudit(new Request(url + "?" + delegatedAuditQueryString(query), { headers: { origin } }), s.d)).status, 400); assert.equal(s.calls.length, 0);
});
test("203 original-number POST/GET recovery remains reachable with gateoff/entitlement failure; GET never supplies command", async () => {
  const s = setup(), disabled = { ...s.d, enabled: () => false, entitlement: async () => { assert.fail("disabled recovery must not request entitlement"); } };
  assert.equal((await handleDelegatedAudit(post({ query, command }), disabled)).status, 200);
  assert.equal((await handleDelegatedAudit(get({ siteId, mode: "recover", operationId: command.operationId }), disabled)).status, 200);
  assert(s.calls.every(c => c.allowAccess === false)); assert.equal(s.calls[1].command, null); assert.equal(s.entitlementCalls.length, 0);
  assert.equal((await handleDelegatedAudit(post({ query, command }), { ...s.d, entitlement: async () => { throw Error("private entitlement"); } })).status, 200);
  assert.equal(s.calls.at(-1)!.allowAccess, false);
  assert.equal((await handleDelegatedAudit(post({ query, command }), { ...disabled, execute: async input => result(input, true) })).status, 503);
});
test("203 first verified export CSV carries receipt metadata/no-store; same-number CSV request returns JSON receipt only", async () => {
  const s = setup(); const fresh = await handleDelegatedAudit(post({ query, command }, { accept: "text/csv" }), { ...s.d, execute: async input => { s.calls.push(input); return result(input, true); } });
  assert.equal(fresh.status, 200); assert.match(fresh.headers.get("content-type")!, /^text\/csv/); assert.match(fresh.headers.get("content-disposition")!, /attachment/);
  assert.equal(fresh.headers.get("x-attendance-operation-id"), command.operationId); assert.equal(fresh.headers.get("x-attendance-actor-id"), actor);
  assert.equal(fresh.headers.get("x-attendance-command-sha256"), createHash("sha256").update(delegatedAuditFingerprintText(query, actor, command)).digest("hex"));
  assert.equal(fresh.headers.get("x-attendance-result-count"), "0"); assert.match(fresh.headers.get("cache-control")!, /private.*no-store/); assert.equal(fresh.headers.get("x-content-type-options"), "nosniff");
  const text = await fresh.text(); assert(text.startsWith('"schema"') || text.startsWith('\ufeff"schema"')); assert(Buffer.byteLength(text) <= 2097152);
  const replay = await handleDelegatedAudit(post({ query, command }, { accept: "text/csv" }), s.d); assert.equal(replay.status, 200); assert.match(replay.headers.get("content-type")!, /application\/json/);
  const body = await replay.json(); assert.equal(body.data.kind, "receipt"); assert(!Object.hasOwn(body.data, "payload")); assert.equal(s.calls.length, 2);
});
test("203 response exact actor/command SHA/private fields are revalidated without exposing internals", async () => {
  const s = setup(); for (const mutate of [(v: DelegatedAuditResult) => ({ ...v, private: "secret" }), (v: DelegatedAuditResult) => ({ ...v, actorId: id(99) }),
    (v: DelegatedAuditResult) => v.kind === "receipt" && v.receipt ? { ...v, receipt: { ...v.receipt, commandFingerprint: "f".repeat(64) } } : v]) {
    const response = await handleDelegatedAudit(post({ query, command }), { ...s.d, execute: async input => mutate(result(input)) }); assert.equal(response.status, 503); assert(!(await response.text()).includes("secret"));
  }
  let calls = 0; const response = await handleDelegatedAudit(post({ query, command }), { ...s.d, execute: async () => { calls++; throw Error("private SQL/PIN/salt"); } });
  assert.equal(response.status, 503); assert.equal(calls, 1); assert(!(await response.text()).includes("private SQL"));
});
test("203 bounded body/deadline cancellation stops late Auth/entitlement and dispatches no extra request", async () => {
  const s = setup(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  assert.equal((await handleDelegatedAudit(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit), { ...s.d, bodyTimeoutMs: 10 })).status, 400);
  assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  assert.equal((await handleDelegatedAudit(get({ siteId, mode: "recover", operationId: command.operationId }), { ...s.d, timeoutMs: 10, authenticate: async req => { await held; return s.d.authenticate(req); } })).status, 503);
  release(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  let finish!: () => void; const pending = new Promise<void>(r => { finish = r; });
  assert.equal((await handleDelegatedAudit(post({ query, command }), { ...s.d, timeoutMs: 10, entitlement: async site => { await pending; return s.d.entitlement(site); } })).status, 503);
  finish(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
});
