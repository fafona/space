import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleShiftRuleBinding, shiftRuleBindingDependencies } from "./route-handler";
import { executeShiftRuleBinding } from "@/lib/merchantAttendanceShiftRuleBinding.server";
import { shiftRuleBindingQueryString } from "@/lib/merchantAttendanceShiftRuleBinding";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { shiftRuleBindingQuery as query, shiftRuleBindingActor as actor, shiftRuleBindingWire as wire } from "../../../../../../scripts/fixtures/attendance-shift-rule-binding-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/shift-rule-binding";
const get = (suffix = "") => new Request(`${url}?${shiftRuleBindingQueryString(query)}${suffix}`);
function setup(patch: Partial<typeof shiftRuleBindingDependencies> = {}) {
  const calls: unknown[] = [];
  const deps: typeof shiftRuleBindingDependencies = {
    enabled: () => true, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof shiftRuleBindingDependencies.entitlement>>,
    allow: () => true, execute: async input => { calls.push(input); return wire(); }, ...patch,
  }; return { calls, deps };
}
const headers = (response: Response) => { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token"); };

test("independent flag defaults closed and methods are GET-only before any auth", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED = old; });
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const flag of [undefined, "0", "true", " 1"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED = flag;
    const response = await handleShiftRuleBinding(get(), { ...f.deps, enabled: shiftRuleBindingDependencies.enabled }); assert.equal(response.status, 404); headers(response);
  }
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) { const response = await handleShiftRuleBinding(new Request(url, { method }), f.deps); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
});

test("host/origin/fetch-site, weak authentication and rate limiting block before reader", async () => {
  const f = setup(); for (const request of [new Request(get().url.replace("www.faolla.com", "evil.invalid")), new Request(get(), { headers: { origin: "https://evil.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } })]) assert.equal((await handleShiftRuleBinding(request, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]]) {
    const response = await handleShiftRuleBinding(get(), { ...f.deps, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) }); assert.equal(response.status, 403);
  }
  const limited = await handleShiftRuleBinding(get(), { ...f.deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});

test("exact queries disallow identity overrides, write payloads, pagination and duplicates", async () => {
  const f = setup(); for (const suffix of ["&workerId=" + query.workerId, "&actorId=" + actor, "&sourceText=x", "&command={}", "&limit=1", "&__proto__=x"])
    assert.equal((await handleShiftRuleBinding(get(suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("paused authorized GET uses handler→service→exact SQL RPC with no command/write flag", async () => {
  const calls: unknown[] = [], f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof shiftRuleBindingDependencies.entitlement>>,
    execute: input => executeShiftRuleBinding(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: wire(), error: null }; } }) });
  const response = await handleShiftRuleBinding(get(), f.deps); assert.equal(response.status, 200); headers(response);
  assert.deepEqual(await response.json(), { ok: true, moduleEnabled: false, data: wire() });
  assert.deepEqual(calls, [{ name: "faolla_attendance_shift_rule_binding_v1", args: { p_query: query, p_auth_user_id: actor } }]);
});

test("known reader/auth errors preserve safe code/status and unknown details are sanitized", async () => {
  for (const [code, status] of [["attendance_shift_rule_binding_not_found", 404], ["attendance_shift_rule_binding_identity_changed", 409], ["attendance_access_denied", 403], ["attendance_shift_rule_binding_invalid", 503]] as const) {
    const response = await handleShiftRuleBinding(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); headers(response);
  }
  for (const error of [Error("secret SQL"), new MerchantAttendanceError("secret"), new MerchantEnterpriseAccessError("authentication_required", 500)]) {
    const response = await handleShiftRuleBinding(get(), setup({ authenticate: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  assert.equal((await handleShiftRuleBinding(get(), setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } }).deps)).status, 401);
});

test("injected invalid results and service failures never bypass strict source validation", async () => {
  const bad = wire(); bad.binding!.source!.sourceSha256 = "0".repeat(64);
  const response = await handleShiftRuleBinding(get(), setup({ execute: async () => bad }).deps); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "attendance_shift_rule_binding_invalid" });
  await assert.rejects(executeShiftRuleBinding({ query, authUserId: actor }, null), /attendance_unavailable/);
  await assert.rejects(executeShiftRuleBinding({ query, authUserId: actor }, { rpc: async () => { throw Error("secret transport"); } }), /attendance_unavailable/);
  await assert.rejects(executeShiftRuleBinding({ query, authUserId: actor }, { rpc: async () => ({ data: null, error: { message: "secret SQL" } }) }), /attendance_unavailable/);
  await assert.rejects(executeShiftRuleBinding({ query, authUserId: actor }, { rpc: async () => ({ data: bad, error: null }) }), /attendance_shift_rule_binding_invalid/);
});
