import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleCorrectionDelegation, correctionDelegationDependencies as defaults } from "../app/api/merchant-enterprise/attendance/correction-delegation/route-handler";
import { executeCorrectionDelegation } from "./merchantAttendanceCorrectionDelegation.server";
import { correctionDelegationQueryString, parseCorrectionDelegationResult, type CorrectionDelegationQuery, type CorrectionDelegationCommand } from "./merchantAttendanceCorrectionDelegation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { correctionDelegationQuery as query, correctionDelegationCommand as command, correctionDelegationGrantCommand as grant,
  correctionDelegationWire as wire, correctionDelegationReceiptHttp as receipt, correctionDelegationId as id } from "./merchantAttendanceCorrectionDelegationTestFixtures";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/correction-delegation";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${correctionDelegationQueryString(q)}`, { headers });
const post = (q = query("delegate", "decide"), c: CorrectionDelegationCommand = command()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: q, command: c }) });
async function rpcWire(q: CorrectionDelegationQuery, c: CorrectionDelegationCommand | null) { if (!c) return wire(q); const { ok, ...data } = await receipt(q, c); void ok; return parseCorrectionDelegationResult(data, q, {}, c); }
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return rpcWire(input.query, input.command); }, ...patch };
  return { deps, calls };
}
test("strict default-off makes no auth/RPC except authenticated original recovery and safe owner revoke", async t => {
  const saved = process.env.FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED;
  t.after(() => { if (saved === undefined) delete process.env.FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED; else process.env.FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED = saved; });
  for (const value of [undefined, "true", " 1", "0", "1\n"]) { if (value === undefined) delete process.env.FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED; else process.env.FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED = value; assert.equal(defaults.enabled(), false); }
  process.env.FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED = "1"; assert.equal(defaults.enabled(), true);
  let authenticated = 0; const f = setup({ enabled: () => false, authenticate: async () => { authenticated++; return { user: { id: id(3) } as User, accessToken: "", authenticationMethods: ["password"] }; } });
  assert.equal((await handleCorrectionDelegation(get(), f.deps)).status, 404); assert.equal((await handleCorrectionDelegation(post(), f.deps)).status, 404); assert.equal(authenticated, 0);
  assert.equal((await handleCorrectionDelegation(get(query("delegate", "recover")), f.deps)).status, 200); assert.equal(authenticated, 1); assert.equal(f.calls[0].allowWrite, false); assert.equal(f.calls[0].command, null);
  const owner = setup({ enabled: () => false, authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "", authenticationMethods: ["password"] }) });
  assert.equal((await handleCorrectionDelegation(post(query("owner"), grant()), owner.deps)).status, 404);
  assert.equal((await handleCorrectionDelegation(post(query("owner", "detail"), { action: "revoke", operationId: id(30), grantId: id(10), expectedRevision: 1, reason: "Safe revoke" }), owner.deps)).status, 200);
  assert.equal(owner.calls.length, 1); assert.equal(owner.calls[0].allowWrite, false);
});
test("method, same/canonical origin, strong authentication and rate checks precede RPC", async () => {
  const f = setup(); assert.equal((await handleCorrectionDelegation(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleCorrectionDelegation(request, f.deps)).status, 403);
  for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) assert.equal((await handleCorrectionDelegation(get(), { ...f.deps,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "", authenticationMethods }) })).status, 403);
  const rate = await handleCorrectionDelegation(get(), { ...f.deps, allow: () => false }); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60");
  assert.equal((await handleCorrectionDelegation(get(), { ...f.deps, entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } })).status, 403);
  assert.equal(f.calls.length, 0);
});
test("request exact keys reject URL identities, duplicate JSON, read/write mode confusion and body pollution", async () => {
  const f = setup(); for (const request of [new Request(get().url + "&siteId=99990001", { headers }), new Request(get().url + "&actorId=" + id(3), { headers }),
    new Request(url + "?siteId=99990001", post()), new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("owner"), command: command() }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate", "decide"), command: { ...command(), actorId: id(1) } }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate", "decide"), command: command() }).replace('"reason":', '"reason":"first","reason":') }),
    new Request(url + "?" + correctionDelegationQueryString(query("delegate", "decide")), { headers }), new Request(url, { method: "POST", headers, body: "{" })]) {
    assert.equal((await handleCorrectionDelegation(request, f.deps)).status, 400, request.url); } assert.equal(f.calls.length, 0);
});
test("bounded body transport uses strict 8KiB, fatal UTF8 and a total deadline", async () => {
  const f = setup({ bodyTimeoutMs: 10 }); for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) }), 400]] as const) assert.equal((await handleCorrectionDelegation(request, f.deps)).status, status);
  let canceled = false; const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } });
  assert.equal((await handleCorrectionDelegation(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400);
  assert.equal(canceled, true); assert.equal(f.calls.length, 0);
});
test("actual handler → service maps owner/delegate to one dedicated RPC with exact four arguments and flat receipt", async () => {
  for (const access of ["owner", "delegate"] as const) { const q = access === "owner" ? query("owner") : query("delegate", "decide"), c = access === "owner" ? grant() : command(), auth = access === "owner" ? id(1) : id(3);
    const calls: { name: string; args: Record<string, unknown> }[] = [], f = setup({ authenticate: async () => ({ user: { id: auth } as User, accessToken: "", authenticationMethods: ["password"] }),
      execute: input => executeCorrectionDelegation(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: await rpcWire(input.query, input.command), error: null }; } }) });
    const r = await handleCorrectionDelegation(post(q, c), f.deps); assert.equal(r.status, 200); assert.deepEqual(await r.json(), await receipt(q, c));
    assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(calls, [{ name: access === "owner" ? "faolla_attendance_correction_delegations_v1" : "faolla_attendance_delegated_corrections_v1",
      args: { p_query: q, p_auth_user_id: auth, p_command: c, p_allow_write: true } }]); }
});
test("module pause preserves exact RPC replay authority flag instead of route-created business success", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
  assert.equal((await handleCorrectionDelegation(post(), f.deps)).status, 200); assert.equal(f.calls[0].allowWrite, false); assert.deepEqual(f.calls[0].command, command());
});
test("service refuses altered receipt fingerprints, actor/private extra fields, oversized replies and redacts unknown failures", async () => {
  const input = { query: query("delegate", "decide"), command: command(), authUserId: id(3), allowWrite: true };
  for (const kind of ["hash", "actor", "private", "large"] as const) {
    const data: Record<string, unknown> = structuredClone(await rpcWire(input.query, input.command)); if (kind === "hash") (data.receipt as Record<string, unknown>).commandFingerprint = "0".repeat(64);
    if (kind === "actor") data.actorId = id(77); if (kind === "private") data.command = command(); if (kind === "large") data.private = "x".repeat(131073);
    let calls = 0; await assert.rejects(executeCorrectionDelegation(input, { rpc: async () => { calls++; return { data, error: null }; } }), { code: "attendance_correction_delegation_invalid" }); assert.equal(calls, 1);
  }
  for (const message of ["private password", "constructor", "toString"]) await assert.rejects(executeCorrectionDelegation(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  const known = await handleCorrectionDelegation(post(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_correction_evidence_changed"); } }).deps); assert.equal(known.status, 409);
  for (const error of [Error("secret"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("private", 403)]) {
    const r = await handleCorrectionDelegation(get(), setup({ execute: async () => { throw error; } }).deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" }); }
});

test("safe owner metadata remains reachable while flag or entitlement is off; enabled metadata preserves the actual entitlement", async () => {
  for (const mode of ["list", "detail"] as const) {
    let entitlements = 0; const f = setup({ enabled: () => false, authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
      entitlement: async () => { entitlements++; throw Error("must not run while flag-off"); } });
    assert.equal((await handleCorrectionDelegation(get(query("owner", mode)), f.deps)).status, 200);
    assert.equal(entitlements, 0); assert.equal(f.calls[0].allowWrite, false);
    const active = setup({ authenticate: f.deps.authenticate });
    assert.equal((await handleCorrectionDelegation(get(query("owner", mode)), active.deps)).status, 200); assert.equal(active.calls[0].allowWrite, true);
    const paused = setup({ authenticate: f.deps.authenticate, entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
    assert.equal((await handleCorrectionDelegation(get(query("owner", mode)), paused.deps)).status, 200); assert.equal(paused.calls[0].allowWrite, false);
  }
  const closed = setup({ enabled: () => false });
  assert.equal((await handleCorrectionDelegation(get(query("owner", "catalog")), closed.deps)).status, 404);
  assert.equal((await handleCorrectionDelegation(get(query("delegate", "list")), closed.deps)).status, 404); assert.equal(closed.calls.length, 0);
});

test("exact recovery and safe revoke skip current entitlement but still require real Auth", async () => {
  let entitlements = 0; const failEntitlement = async (): Promise<never> => { entitlements++; throw Error("unavailable current entitlement"); };
  const f = setup({ entitlement: failEntitlement });
  assert.equal((await handleCorrectionDelegation(get(query("delegate", "recover")), f.deps)).status, 200);
  assert.equal(f.calls[0].allowWrite, false); assert.equal(f.calls[0].authUserId, id(3));
  const owner = setup({ entitlement: failEntitlement, authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }) });
  assert.equal((await handleCorrectionDelegation(post(query("owner", "detail"), { action: "revoke", operationId: id(30), grantId: id(10), expectedRevision: 1, reason: "Safe revoke" }), owner.deps)).status, 200);
  assert.equal(owner.calls[0].allowWrite, false); assert.equal(entitlements, 0);
  assert.equal((await handleCorrectionDelegation(get(query("delegate", "recover")), { ...f.deps, authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } })).status, 401);
});

test("service rejects a SQL response claiming new write authority under allowWrite=false", async () => {
  const q = query("owner"), data = wire(q);
  await assert.rejects(executeCorrectionDelegation({ query: q, command: null, authUserId: id(1), allowWrite: false },
    { rpc: async () => ({ data, error: null }) }), { code: "attendance_correction_delegation_invalid" });
  const checked = await executeCorrectionDelegation({ query: q, command: null, authUserId: id(1), allowWrite: false },
    { rpc: async () => ({ data: { ...data, canWrite: false }, error: null }) }); assert.equal(checked.canWrite, false);
});
