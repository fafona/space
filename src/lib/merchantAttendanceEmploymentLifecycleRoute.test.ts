import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleEmploymentLifecycle, employmentLifecycleDependencies as defaults } from "../app/api/merchant-enterprise/attendance/employment-lifecycle/route-handler";
import { executeEmploymentLifecycle, employmentLifecycleEnabled } from "./merchantAttendanceEmploymentLifecycle.server";
import { employmentLifecycleQueryString } from "./merchantAttendanceEmploymentLifecycle";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { employmentLifecycleQuery as query, employmentLifecycleResult as result, employmentLifecycleOwner as owner, employmentLifecycleSite as site,
  employmentLifecycleCommand as command, employmentLifecycleReceiptHttp as receipt, employmentLifecycleId as id } from "../../scripts/fixtures/attendance-employment-lifecycle-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/employment-lifecycle", headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${employmentLifecycleQueryString(q)}`, { headers });
const post = () => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(), command: command() }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof defaults.execute>[0][] = []; const deps: typeof defaults = {
  authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }), allow: () => true, bodyTimeoutMs: 5000, enabled: () => true,
  entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
  execute: async input => { calls.push(input); if (!input.command) return result(input.query.mode); const { ok: _ok, ...r } = await receipt(input.command, "detail"); void _ok; return r; }, ...patch }; return { deps, calls }; }
test("lifecycle write rollout is exact switch AND bounded merchant allowlist, never wildcard", () => {
  const env = { NODE_ENV: "test" as const, FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED: "1", FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_SITES: site };
  assert(employmentLifecycleEnabled(site, env)); assert(!employmentLifecycleEnabled("99990002", env));
  for (const v of [undefined, "true", " 1", "1\n", "0"]) assert(!employmentLifecycleEnabled(site, { ...env, FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED: v }));
  for (const v of [undefined, "", "*", site + ",*", site + ",", site + "\n99990002", Array(65).fill(site).join(","), "x".repeat(4097)]) assert(!employmentLifecycleEnabled(site, { ...env, FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_SITES: v }));
});
test("lifecycle recovery remains minimal while entitlement and rollout unavailable; off write flag reaches SQL for exact replay", async () => {
  const f = setup({ enabled: () => false }); assert.equal((await handleEmploymentLifecycle(post(), f.deps)).status, 200); assert.equal(f.calls[0].allowWrite, false);
  const recovery = setup({ enabled: () => { throw Error("must not inspect"); }, entitlement: async () => { throw Error("must not require"); } });
  assert.equal((await handleEmploymentLifecycle(get(query("recover")), recovery.deps)).status, 200); assert.equal(recovery.calls[0].allowWrite, false); assert.equal(recovery.calls[0].command, null);
});
test("lifecycle canonical origin, strong auth, method and rate guard protect all requests", async () => {
  const f = setup(); assert.equal((await handleEmploymentLifecycle(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const r of [new Request(get().url.replace("www.faolla.com", "evil.invalid")), new Request(get(), { headers: { ...headers, origin: "https://evil.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleEmploymentLifecycle(r, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) assert.equal((await handleEmploymentLifecycle(get(), { ...f.deps, authenticate: async () => ({ user: { id: owner } as User, accessToken: "", authenticationMethods: methods }) })).status, 403);
  const r = await handleEmploymentLifecycle(get(), { ...f.deps, allow: () => false }); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});
test("lifecycle strict bounded streaming body rejects duplicate JSON, foreign targets, query injection and invalid UTF8", async () => {
  const f = setup({ bodyTimeoutMs: 10 });
  for (const r of [new Request(get().url + "&actorId=" + owner, { headers }), new Request(get().url + "&mode=detail", { headers }), new Request(url + "?x=1", post()),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(), command: { ...command(), workerId: id(99) } }) }),
    new Request(url, { method: "POST", headers, body: '{"query":{},"query":{},"command":{}}' }), new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) })]) assert.equal((await handleEmploymentLifecycle(r, f.deps)).status, 400);
  assert.equal((await handleEmploymentLifecycle(new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), f.deps)).status, 413);
  assert.equal((await handleEmploymentLifecycle(new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), f.deps)).status, 415);
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled = true; } });
  assert.equal((await handleEmploymentLifecycle(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400); assert(cancelled); assert.equal(f.calls.length, 0);
});
test("lifecycle handler/service emits exactly one authenticated RPC and verifies receipt fingerprint", async () => {
  const calls: unknown[] = [], f = setup({ execute: input => executeEmploymentLifecycle(input, { rpc: async (name, args) => { calls.push({ name, args }); const { ok: _ok, ...r } = await receipt(input.command!, "detail"); void _ok; return { data: r, error: null }; } }) });
  const r = await handleEmploymentLifecycle(post(), f.deps); assert.equal(r.status, 200); const value = await r.json(); assert.equal(value.receipt.command, undefined); assert.equal(value.detail, null); assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [{ name: "faolla_attendance_employment_lifecycle_v1", args: { p_query: query(), p_auth_user_id: owner, p_command: command(), p_allow_write: true } }]);
});
test("lifecycle service rejects substituted receipts and redacts unknown SQL messages", async () => {
  const input = { query: query(), command: command(), authUserId: owner, allowWrite: true };
  for (const patch of [{ commandFingerprint: "0".repeat(64) }, { actorId: id(99) }]) { const { ok: _ok, ...r } = await receipt(command(), "detail"); void _ok;
    await assert.rejects(executeEmploymentLifecycle(input, { rpc: async () => ({ data: { ...r, receipt: { ...r.receipt!, ...patch } }, error: null }) }), { code: "attendance_employment_lifecycle_invalid" }); }
  for (const message of ["private SQL", "constructor", "toString"]) await assert.rejects(executeEmploymentLifecycle(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  const known = await handleEmploymentLifecycle(post(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_employment_lifecycle_blocked"); } }).deps); assert.equal(known.status, 409);
  const unknown = await handleEmploymentLifecycle(get(), setup({ execute: async () => { throw Error("raw private SQL"); } }).deps); assert.deepEqual(await unknown.json(), { ok: false, error: "attendance_unavailable" });
});
