import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAccountSuspension, accountSuspensionDependencies as defaults } from "../app/api/merchant-enterprise/attendance/account-suspensions/route-handler";
import { executeAccountSuspension, accountSuspensionEnabled } from "./merchantAttendanceAccountSuspension.server";
import { accountSuspensionQueryString } from "./merchantAttendanceAccountSuspension";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { accountSuspensionQuery as query, accountSuspensionResult as result, accountSuspensionOwner as owner, accountSuspensionCommand as command,
  accountSuspensionReceiptHttp as receipt, accountSuspensionId as id } from "../../scripts/fixtures/attendance-account-suspension-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/account-suspensions", headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${accountSuspensionQueryString(q)}`, { headers });
const post = () => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("detail"), command: command() }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof defaults.execute>[0][] = []; const deps: typeof defaults = {
  authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }), allow: () => true, bodyTimeoutMs: 5000,
  entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
  execute: async input => { calls.push(input); if (!input.command) return result(input.query.mode); const { ok: _ok, ...r } = await receipt(); void _ok; return { ...r, mode: input.query.mode }; }, ...patch }; return { deps, calls }; }
test("rollout is exact1 but existing pause list/detail and original recovery are available while off", async () => {
  for (const v of [undefined, "true", " 1", "1\n", "0"]) assert.equal(accountSuspensionEnabled({ NODE_ENV: "test", FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED: v }), false);
  assert.equal(accountSuspensionEnabled({ NODE_ENV: "test", FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED: "1" }), true);
  const f = setup(); assert.equal((await handleAccountSuspension(get(), f.deps)).status, 200); assert.equal((await handleAccountSuspension(get(query("detail")), f.deps)).status, 200);
  const recover = setup({ entitlement: async () => { throw Error("must not depend on revoked employee permission/platform for minimum recovery"); } });
  for (const mode of ["recover", "recover-status"] as const) assert.equal((await handleAccountSuspension(get(query(mode)), recover.deps)).status, 200);
  assert.ok(recover.calls.every(x => x.command === null && !x.allowRestore));
});
test("same/canonical origin, method, strong auth and limiter protect every read/write", async () => {
  const f = setup(); assert.equal((await handleAccountSuspension(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const r of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://evil.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleAccountSuspension(r, f.deps)).status, 403);
  for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) assert.equal((await handleAccountSuspension(get(), { ...f.deps, authenticate: async () => ({ user: { id: owner } as User, accessToken: "", authenticationMethods }) })).status, 403);
  const r = await handleAccountSuspension(get(), { ...f.deps, allow: () => false }); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});
test("strict query and bounded fatal-UTF8 duplicate-free body cannot inject identities or mix restore targets", async () => {
  const f = setup({ bodyTimeoutMs: 10 });
  for (const r of [new Request(get().url + "&actorId=" + owner, { headers }), new Request(get().url + "&mode=list", { headers }), new Request(url + "?x=1", post()),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("detail"), command: { ...command(), suspensionId: id(99) } }) }),
    new Request(url, { method: "POST", headers, body: '{"query":{},"query":{},"command":{}}' }), new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) })]) assert.equal((await handleAccountSuspension(r, f.deps)).status, 400);
  assert.equal((await handleAccountSuspension(new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), f.deps)).status, 413);
  assert.equal((await handleAccountSuspension(new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), f.deps)).status, 415);
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled = true; } });
  assert.equal((await handleAccountSuspension(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400); assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
});
test("actual handler/service sends one exact four-argument RPC and validates fingerprint without exposing saved command", async () => {
  const calls: unknown[] = [], f = setup({ execute: input => executeAccountSuspension(input, { rpc: async (name, args) => { calls.push({ name, args }); const { ok: _ok, ...r } = await receipt(); void _ok; return { data: { ...r, mode: "detail" }, error: null }; } }) });
  const r = await handleAccountSuspension(post(), f.deps); assert.equal(r.status, 200); const value = await r.json(); assert.equal(value.receipt.command, undefined); assert.equal(value.statusReceipt, null); assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [{ name: "faolla_attendance_account_suspensions_v1", args: { p_query: query("detail"), p_auth_user_id: owner, p_command: command(), p_allow_restore: true } }]);
  const paused = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
  assert.equal((await handleAccountSuspension(post(), paused.deps)).status, 200); assert.equal(paused.calls[0].allowRestore, false); // SQL retains exact replay authority, not route-created fresh success.
});
test("service checks owner receipt/whole reply and redacts unknown database error text", async () => {
  const input = { query: query("detail"), command: command(), authUserId: owner, allowRestore: true };
  for (const patch of [{ commandFingerprint: "0".repeat(64) }, { actorId: id(99) }]) { const { ok: _ok, ...r } = await receipt(); void _ok;
    await assert.rejects(executeAccountSuspension(input, { rpc: async () => ({ data: { ...r, mode: "detail", receipt: { ...r.receipt!, ...patch } }, error: null }) }), { code: "attendance_account_suspension_invalid" }); }
  for (const data of [{ ...result(), private: "secret" }, { ...result(), private: "x".repeat(131073) }]) await assert.rejects(executeAccountSuspension({ ...input, query: query(), command: null }, { rpc: async () => ({ data, error: null }) }), { code: "attendance_account_suspension_invalid" });
  for (const message of ["secret", "constructor", "toString"]) await assert.rejects(executeAccountSuspension(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  const known = await handleAccountSuspension(post(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_account_suspension_changed"); } }).deps); assert.equal(known.status, 409);
  const unknown = await handleAccountSuspension(get(), setup({ execute: async () => { throw Error("private raw SQL"); } }).deps); assert.deepEqual(await unknown.json(), { ok: false, error: "attendance_unavailable" });
});
