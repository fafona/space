import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleWorkArrangement, workArrangementDependencies as defaults } from "../app/api/merchant-enterprise/attendance/work-arrangements/route-handler";
import { executeWorkArrangement } from "./merchantAttendanceWorkArrangement.server";
import { workArrangementQueryString, type WorkArrangementCommand, type WorkArrangementResult } from "./merchantAttendanceWorkArrangement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { workArrangementQuery as query, workArrangementCommand as command, workArrangementResult as result, workArrangementReceiptHttp as receipt,
  workArrangementAuth as auth, workArrangementId as id } from "../../scripts/fixtures/attendance-work-arrangement-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/work-arrangements";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (operationId: string | null = null) => new Request(`${url}?${workArrangementQueryString({ ...query(), operationId })}`, { headers });
const body = () => ({ query: query(), command: command() });
const post = (value: unknown = body()) => new Request(url, { method: "POST", headers, body: JSON.stringify(value) });
function rpcWire(c: WorkArrangementCommand | null): WorkArrangementResult { if (!c) return result(); const { ok, moduleEnabled, ...wire } = receipt(c); void ok; void moduleEnabled; return wire; }
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: auth } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return rpcWire(input.command); }, ...patch };
  return { deps, calls };
}

test("default-off blocks new work before auth but original GET recovery is explicitly authenticated", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED; else process.env.FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED = previous; });
  for (const value of [undefined, "true", " 1", "0"]) {
    if (value === undefined) delete process.env.FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED; else process.env.FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED = value;
    assert.equal(defaults.enabled(), false);
  }
  let authenticated = 0; const f = setup({ enabled: () => false, authenticate: async () => { authenticated++; return { user: { id: auth } as User, accessToken: "", authenticationMethods: ["password"] }; } });
  assert.equal((await handleWorkArrangement(get(), f.deps)).status, 404); assert.equal((await handleWorkArrangement(post(), f.deps)).status, 404); assert.equal(authenticated, 0);
  assert.equal((await handleWorkArrangement(get(id(10)), f.deps)).status, 200); assert.equal(authenticated, 1); assert.equal(f.calls[0].allowWrite, false); assert.equal(f.calls[0].command, null);
});

test("method/origin/canonical/strong auth/rate/entitlement fail before SQL", async () => {
  const f = setup();
  assert.equal((await handleWorkArrangement(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleWorkArrangement(request, f.deps)).status, 403);
  for (const authenticationMethods of [[], ["invite"], ["password", "magiclink"], ["recovery"]])
    assert.equal((await handleWorkArrangement(get(), { ...f.deps, authenticate: async () => ({ user: { id: auth } as User, accessToken: "", authenticationMethods }) })).status, 403);
  const rate = await handleWorkArrangement(get(), { ...f.deps, allow: () => false }); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60");
  assert.equal((await handleWorkArrangement(get(), { ...f.deps, entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } })).status, 403);
  assert.equal(f.calls.length, 0);
});

test("exact query and request reject duplicate keys/uploaded identities and do not call RPC", async () => {
  const f = setup();
  for (const request of [new Request(get().url + "&siteId=99990001", { headers }), new Request(get().url + "&actorId=" + id(1), { headers }),
    post({ ...body(), source: {} }), post({ query: query("owner"), command: command() }), new Request(url + "?siteId=99990001", post()),
    new Request(url, { method: "POST", headers, body: JSON.stringify(body()).replace('"reason":', '"reason":"one","reason":') }),
    new Request(url, { method: "POST", headers, body: "{" })]) assert.equal((await handleWorkArrangement(request, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("strict 8KiB/fatal UTF8/deadline body transport rejects without SQL", async () => {
  const f = setup({ bodyTimeoutMs: 10 });
  for (const [request, status] of [[new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) }), 400]] as const)
    assert.equal((await handleWorkArrangement(request, f.deps)).status, status);
  let canceled = 0; const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled++; } });
  assert.equal((await handleWorkArrangement(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400);
  assert.equal(canceled, 1); assert.equal(f.calls.length, 0);
});

test("actual handler→service sends exactly one four-argument RPC, flat safe response and no-store", async () => {
  const calls: Record<string, unknown>[] = []; const f = setup({ execute: value => executeWorkArrangement(value, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_work_arrangement_v1"); calls.push(args); return { data: rpcWire(value.command), error: null }; } }) });
  const response = await handleWorkArrangement(post(), f.deps); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt()); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(calls, [{ p_query: query(), p_auth_user_id: auth, p_command: command(), p_allow_write: true }]);
});

test("paused feature-on command reaches the same RPC with allowWrite false so SQL preserves exact replay", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
  const response = await handleWorkArrangement(post(), f.deps); assert.equal(response.status, 200); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].allowWrite, false);
  assert.equal((await response.json()).moduleEnabled, false);
});

test("service and handler redact unknown errors and reject private extra keys/identity changes with no fallback", async () => {
  const input = { query: query(), command: null, authUserId: auth, allowWrite: true };
  for (const data of [{ ...result(), actorId: id(55) }, { ...result(), privateSource: "secret" }, { ...result(), items: Array(26).fill({}) }]) {
    let calls = 0; await assert.rejects(executeWorkArrangement(input, { rpc: async () => { calls++; return { data, error: null }; } }), { code: "attendance_work_arrangement_invalid" }); assert.equal(calls, 1); }
  for (const message of ["private password", "constructor", "toString"]) {
    await assert.rejects(executeWorkArrangement(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  }
  const known = await handleWorkArrangement(post(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_work_arrangement_conflicts_changed"); } }).deps);
  assert.equal(known.status, 409);
  for (const error of [Error("secret"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("private secret", 403)]) {
    const response = await handleWorkArrangement(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" }); }
});
