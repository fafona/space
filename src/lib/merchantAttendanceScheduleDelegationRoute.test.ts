import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleScheduleDelegation, scheduleDelegationDependencies as defaults } from "../app/api/merchant-enterprise/attendance/schedule-delegation/route-handler";
import { executeScheduleDelegation, scheduleDelegationEnabled } from "./merchantAttendanceScheduleDelegation.server";
import { scheduleDelegationQueryString, parseScheduleDelegationResult, type ScheduleDelegationQuery, type ScheduleDelegationCommand } from "./merchantAttendanceScheduleDelegation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { scheduleDelegationQuery as query, scheduleDelegationCommand as command, scheduleDelegationGrantCommand as grant,
  scheduleDelegationWire as wire, scheduleDelegationReceiptHttp as receipt, scheduleDelegationId as id } from "../../scripts/fixtures/attendance-schedule-delegation-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/schedule-delegation";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${scheduleDelegationQueryString(q)}`, { headers });
const post = (q = query("delegate", "schedule"), c: ScheduleDelegationCommand = command()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: q, command: c }) });
async function rpcWire(q: ScheduleDelegationQuery, c: ScheduleDelegationCommand | null) { if (!c) return wire(q); const { ok, ...data } = await receipt(q, c); void ok; return parseScheduleDelegationResult(data, q, {}, c); }
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return rpcWire(input.query, input.command); }, ...patch };
  return { deps, calls };
}
test("explicit server switch AND bounded exact site allowlist; malformed or wildcard rollout fails closed", () => {
  for (const env of [{}, { FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED: "true", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES: "98400198" },
    { FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES: "*" },
    { FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES: "98400198," },
    { FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES: Array(65).fill("98400198").join(",") },
    { FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES: "98400199" }]) assert.equal(scheduleDelegationEnabled("98400198", { NODE_ENV: "test", ...env }), false);
  assert.equal(scheduleDelegationEnabled("98400198", { NODE_ENV: "test", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES: "98400199, 98400198" }), true);
});
test("GET recovery and owner revoke skip entitlement; owner off-flag reading remains SQL-authorized", async () => {
  let entitlements = 0; const f = setup({ enabled: () => false, entitlement: async () => { entitlements++; throw Error("unavailable"); } });
  assert.equal((await handleScheduleDelegation(get(query("delegate", "recover")), f.deps)).status, 200); assert.equal(entitlements, 0); assert.equal(f.calls[0].allowWrite, false);
  const owner = setup({ enabled: () => false, authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "", authenticationMethods: ["password"] }), entitlement: f.deps.entitlement });
  assert.equal((await handleScheduleDelegation(post(query("owner", "detail"), { action: "revoke", operationId: id(30), grantId: id(10), expectedRevision: 1, reason: "撤销" }), owner.deps)).status, 200);
  assert.equal(entitlements, 0); assert.equal(owner.calls[0].allowWrite, false);
  const reading = setup({ enabled: () => false, authenticate: owner.deps.authenticate }); assert.equal((await handleScheduleDelegation(get(query("owner")), reading.deps)).status, 200); assert.equal(reading.calls[0].allowWrite, false);
});
test("method/origin/strong-auth/rate guards precede RPC, with no-store and exact realAuth", async () => {
  const f = setup(); assert.equal((await handleScheduleDelegation(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleScheduleDelegation(request, f.deps)).status, 403);
  for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) assert.equal((await handleScheduleDelegation(get(), { ...f.deps,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "", authenticationMethods }) })).status, 403);
  const rate = await handleScheduleDelegation(get(), { ...f.deps, allow: () => false }); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
  const response = await handleScheduleDelegation(get(), f.deps); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(f.calls[0].authUserId, id(3));
});
test("GET cannot mutate; duplicate/unknown selectors, injected identities and exact body mismatch rejected", async () => {
  const f = setup(); for (const request of [new Request(get().url + "&siteId=98400198", { headers }), new Request(get().url + "&actorId=" + id(3), { headers }),
    new Request(get().url + "&command=%7B%7D", { headers }), new Request(url + "?siteId=98400198", post()),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("owner"), command: command() }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate", "schedule"), command: { ...command(), actorId: id(1) } }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate", "schedule"), command: command() }).replace('"reason":', '"reason":"first","reason":') }),
    new Request(url, { method: "POST", headers, body: "{" })]) assert.equal((await handleScheduleDelegation(request, f.deps)).status, 400, request.url);
  assert.equal(f.calls.length, 0);
});
test("body bound/fatal UTF8/deadline apply before auth and SQL", async () => {
  const f = setup({ bodyTimeoutMs: 10 }); for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) }), 400]] as const) assert.equal((await handleScheduleDelegation(request, f.deps)).status, status);
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled = true; } });
  assert.equal((await handleScheduleDelegation(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400);
  assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
});
test("owner and delegate both use one dedicated RPC with exact four args and verified fingerprint", async () => {
  for (const access of ["owner", "delegate"] as const) { const q = access === "owner" ? query("owner") : query("delegate", "schedule"), c = access === "owner" ? grant() : command(), auth = access === "owner" ? id(1) : id(3);
    const calls: { name: string; args: Record<string, unknown> }[] = [], f = setup({ authenticate: async () => ({ user: { id: auth } as User, accessToken: "", authenticationMethods: ["password"] }),
      execute: input => executeScheduleDelegation(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: await rpcWire(input.query, input.command), error: null }; } }) });
    const r = await handleScheduleDelegation(post(q, c), f.deps); assert.equal(r.status, 200); assert.deepEqual(await r.json(), await receipt(q, c));
    assert.deepEqual(calls, [{ name: "faolla_attendance_schedule_delegation_v1", args: { p_query: q, p_auth_user_id: auth, p_command: c, p_allow_write: true } }]); }
});
test("service rejects tampered actor/hash/private replies and sanitizes unknown SQL failures", async () => {
  const input = { query: query("delegate", "schedule"), command: command(), authUserId: id(3), allowWrite: true };
  for (const kind of ["hash", "actor", "private", "large"] as const) { const data: Record<string, unknown> = structuredClone(await rpcWire(input.query, input.command));
    if (kind === "hash") (data.receipt as Record<string, unknown>).commandFingerprint = "0".repeat(64); if (kind === "actor") data.actorId = id(77);
    if (kind === "private") data.command = command(); if (kind === "large") data.private = "x".repeat(131073);
    await assert.rejects(executeScheduleDelegation(input, { rpc: async () => ({ data, error: null }) }), { code: "attendance_schedule_delegation_invalid" }); }
  for (const message of ["private password", "constructor", "toString"]) await assert.rejects(executeScheduleDelegation(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  const known = await handleScheduleDelegation(post(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_schedule_delegation_changed"); } }).deps); assert.equal(known.status, 409);
  for (const error of [Error("secret"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("private", 403)]) {
    const r = await handleScheduleDelegation(get(), setup({ execute: async () => { throw error; } }).deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" }); }
});
