import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleMissingDelegation, missingDelegationDependencies as defaults } from "../app/api/merchant-enterprise/attendance/missing-delegation/route-handler";
import { executeMissingDelegation } from "./merchantAttendanceMissingDelegation.server";
import { missingDelegationQueryString, parseMissingDelegationResult, type MissingDelegationQuery, type MissingDelegationCommand } from "./merchantAttendanceMissingDelegation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { missingDelegationQuery as query, missingDelegationCommand as command, missingDelegationGrantCommand as grant,
  missingDelegationWire as wire, missingDelegationReceiptHttp as receipt, missingDelegationId as id } from "../../scripts/fixtures/attendance-missing-delegation-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/missing-delegation";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${missingDelegationQueryString(q)}`, { headers });
const post = (q = query("delegate", "decide"), c: MissingDelegationCommand = command()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: q, command: c }) });
async function rpcWire(q: MissingDelegationQuery, c: MissingDelegationCommand | null) { if (!c) return wire(q); const { ok, ...data } = await receipt(q, c); void ok; return parseMissingDelegationResult(data, q, {}, c); }
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return rpcWire(input.query, input.command); }, ...patch };
  return { deps, calls };
}
test("strict default-off makes no auth/RPC except authenticated original recovery and safe owner revoke", async t => {
  const saved = process.env.FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED;
  t.after(() => { if (saved === undefined) delete process.env.FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED; else process.env.FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED = saved; });
  for (const value of [undefined, "true", " 1", "0", "1\n"]) { if (value === undefined) delete process.env.FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED; else process.env.FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED = value; assert.equal(defaults.enabled(), false); }
  process.env.FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED = "1"; assert.equal(defaults.enabled(), true);
  let authenticated = 0; const f = setup({ enabled: () => false, authenticate: async () => { authenticated++; return { user: { id: id(3) } as User, accessToken: "", authenticationMethods: ["password"] }; } });
  assert.equal((await handleMissingDelegation(get(), f.deps)).status, 404); assert.equal((await handleMissingDelegation(post(), f.deps)).status, 404); assert.equal(authenticated, 0);
  assert.equal((await handleMissingDelegation(get(query("delegate", "recover")), f.deps)).status, 200); assert.equal(authenticated, 1); assert.equal(f.calls[0].allowWrite, false); assert.equal(f.calls[0].command, null);
  const owner = setup({ enabled: () => false, authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "", authenticationMethods: ["password"] }) });
  assert.equal((await handleMissingDelegation(post(query("owner"), grant()), owner.deps)).status, 404);
  assert.equal((await handleMissingDelegation(post(query("owner", "detail"), { action: "revoke", operationId: id(30), grantId: id(10), expectedRevision: 1, reason: "Safe revoke" }), owner.deps)).status, 200);
  assert.equal(owner.calls.length, 1); assert.equal(owner.calls[0].allowWrite, false);
});
test("method, same/canonical origin, strong authentication and rate checks precede RPC", async () => {
  const f = setup(); assert.equal((await handleMissingDelegation(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleMissingDelegation(request, f.deps)).status, 403);
  for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) assert.equal((await handleMissingDelegation(get(), { ...f.deps,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "", authenticationMethods }) })).status, 403);
  const rate = await handleMissingDelegation(get(), { ...f.deps, allow: () => false }); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60");
  assert.equal((await handleMissingDelegation(get(), { ...f.deps, entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } })).status, 403);
  assert.equal(f.calls.length, 0);
});
test("request exact keys reject URL identities, duplicate JSON, read/write mode confusion and body pollution", async () => {
  const f = setup(); for (const request of [new Request(get().url + "&siteId=99990001", { headers }), new Request(get().url + "&actorId=" + id(3), { headers }),
    new Request(url + "?siteId=99990001", post()), new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("owner"), command: command() }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate", "decide"), command: { ...command(), actorId: id(1) } }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate", "decide"), command: command() }).replace('"reason":', '"reason":"first","reason":') }),
    new Request(url + "?" + missingDelegationQueryString(query("delegate", "decide")), { headers }), new Request(url, { method: "POST", headers, body: "{" })]) {
    assert.equal((await handleMissingDelegation(request, f.deps)).status, 400, request.url); } assert.equal(f.calls.length, 0);
});
test("bounded body transport uses strict 8KiB, fatal UTF8 and a total deadline", async () => {
  const f = setup({ bodyTimeoutMs: 10 }); for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) }), 400]] as const) assert.equal((await handleMissingDelegation(request, f.deps)).status, status);
  let canceled = false; const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } });
  assert.equal((await handleMissingDelegation(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400);
  assert.equal(canceled, true); assert.equal(f.calls.length, 0);
});
test("actual handler → service maps owner/delegate to one dedicated RPC with exact four arguments and flat receipt", async () => {
  for (const access of ["owner", "delegate"] as const) { const q = access === "owner" ? query("owner") : query("delegate", "decide"), c = access === "owner" ? grant() : command(), auth = access === "owner" ? id(1) : id(3);
    const calls: { name: string; args: Record<string, unknown> }[] = [], f = setup({ authenticate: async () => ({ user: { id: auth } as User, accessToken: "", authenticationMethods: ["password"] }),
      execute: input => executeMissingDelegation(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: await rpcWire(input.query, input.command), error: null }; } }) });
    const r = await handleMissingDelegation(post(q, c), f.deps); assert.equal(r.status, 200); assert.deepEqual(await r.json(), await receipt(q, c));
    assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(calls, [{ name: access === "owner" ? "faolla_attendance_missing_delegations_v1" : "faolla_attendance_delegated_missing_v1",
      args: { p_query: q, p_auth_user_id: auth, p_command: c, p_allow_write: true } }]); }
});
test("module pause preserves exact RPC replay authority flag instead of route-created business success", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
  assert.equal((await handleMissingDelegation(post(), f.deps)).status, 200); assert.equal(f.calls[0].allowWrite, false); assert.deepEqual(f.calls[0].command, command());
});
test("service refuses altered receipt fingerprints, actor/private extra fields, oversized replies and redacts unknown failures", async () => {
  const input = { query: query("delegate", "decide"), command: command(), authUserId: id(3), allowWrite: true };
  for (const kind of ["hash", "actor", "private", "large"] as const) {
    const data: Record<string, unknown> = structuredClone(await rpcWire(input.query, input.command)); if (kind === "hash") (data.receipt as Record<string, unknown>).commandFingerprint = "0".repeat(64);
    if (kind === "actor") data.actorId = id(77); if (kind === "private") data.command = command(); if (kind === "large") data.private = "x".repeat(131073);
    let calls = 0; await assert.rejects(executeMissingDelegation(input, { rpc: async () => { calls++; return { data, error: null }; } }), { code: "attendance_missing_delegation_invalid" }); assert.equal(calls, 1);
  }
  for (const message of ["private password", "constructor", "toString"]) await assert.rejects(executeMissingDelegation(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  const known = await handleMissingDelegation(post(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_missing_basis_changed"); } }).deps); assert.equal(known.status, 409);
  for (const error of [Error("secret"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("private", 403)]) {
    const r = await handleMissingDelegation(get(), setup({ execute: async () => { throw error; } }).deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" }); }
});
