import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleShiftCheck, shiftCheckDependencies } from "./route-handler";
import { executeShiftCheck } from "@/lib/merchantAttendanceShiftCheck.server";
import { shiftCheckQueryString, type ShiftCheckData } from "@/lib/merchantAttendanceShiftCheck";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { shiftCheckWire as wire, shiftCheckQuery as query, shiftCheckActor as actor, shiftCheckSource } from "../../../../../../scripts/fixtures/attendance-shift-check-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/shift-check";
const get = (suffix = "") => new Request(`${url}?${shiftCheckQueryString(query)}${suffix}`);
function setup(patch: Partial<typeof shiftCheckDependencies> = {}) {
  const calls: unknown[] = [], entitlements: string[] = [];
  const deps: typeof shiftCheckDependencies = { enabled: () => true,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async siteId => { entitlements.push(siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof shiftCheckDependencies.entitlement>>; },
    allow: () => true, execute: async input => { calls.push(input); return wire(); }, ...patch };
  return { calls, entitlements, deps };
}
function privateHeaders(response: Response) { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token"); }

test("independent route uses its exact default-off flag and permits GET only before auth", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED = old; });
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const flag of [undefined, "0", "true", " 1"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED = flag;
    const response = await handleShiftCheck(get(), { ...f.deps, enabled: shiftCheckDependencies.enabled }); assert.equal(response.status, 404); privateHeaders(response);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) { const response = await handleShiftCheck(new Request(url, { method }), f.deps); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8"); assert.match(route, /export const GET/); assert.doesNotMatch(route, /export const (POST|PATCH|PUT|DELETE)/);
});

test("canonical origin/fetch-site and strong authentication gates precede reads", async () => {
  const f = setup();
  for (const req of [new Request(get().url.replace("www.faolla.com", "evil.invalid")), new Request(get(), { headers: { origin: "null" } }), new Request(get(), { headers: { origin: "https://evil.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } })]) assert.equal((await handleShiftCheck(req, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]]) assert.equal((await handleShiftCheck(get(), { ...f.deps,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
});

test("rate and exact query gates reject before entitlement/SQL and never forward actor overrides", async () => {
  const f = setup(), limited = await handleShiftCheck(get(), { ...f.deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  for (const suffix of ["&workerId=" + query.workerId, "&actorId=" + actor, "&sourceText=x", "&command={}", "&limit=1", "&__proto__=x"]) assert.equal((await handleShiftCheck(get(suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0); assert.equal(f.entitlements.length, 0);
});

test("paused actual handler/service projection reads exact138 only and never exposes sourceText", async () => {
  const calls: unknown[] = [], f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof shiftCheckDependencies.entitlement>>,
    execute: input => executeShiftCheck(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: shiftCheckSource(), error: null }; } }) });
  const response = await handleShiftCheck(get(), f.deps); assert.equal(response.status, 200); privateHeaders(response); const body = await response.json();
  assert.deepEqual(body, { ok: true, moduleEnabled: false, data: wire() }); assert.equal(JSON.stringify(body).includes("sourceText"), false);
  assert.deepEqual(Object.keys(body.data).sort(), ["protocol", "algorithmVersion", "readOnly", "formalReady", "asOf", "rule", "events", "effect", "relation"].sort());
  assert(!Object.hasOwn(body.data.rule.binding!, "source")); assert(!Object.hasOwn(body.data, "checks"));
  assert(!JSON.stringify(body).includes("Saved personal choice")); assert(!JSON.stringify(body).includes("canonicalFormat"));
  assert.deepEqual(calls, [{ name: "faolla_attendance_shift_check_v1", args: { p_query: query, p_auth_user_id: actor } }]);
});

test("known denied/identity/missing-reader errors retain safe status; unknown errors never expose private detail", async () => {
  for (const [code, status] of [["attendance_shift_rule_binding_not_found", 404], ["attendance_shift_rule_binding_identity_changed", 409], ["attendance_access_denied", 403], ["attendance_shift_check_invalid", 503], ["attendance_shift_rule_binding_invalid", 503]] as const) {
    const response = await handleShiftCheck(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); privateHeaders(response);
  }
  for (const error of [Error("private SQL"), new MerchantAttendanceError("secret"), new MerchantEnterpriseAccessError("authentication_required", 500)]) {
    const response = await handleShiftCheck(get(), setup({ authenticate: async () => { throw error; } }).deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  assert.equal((await handleShiftCheck(get(), setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } }).deps)).status, 401);
});

test("handler revalidates injected service projections and refuses accidental raw138 output", async () => {
  for (const raw of [shiftCheckSource(), { ...wire(), sourceText: "private" }, { ...wire(), formalReady: true }, { ...wire(), checks: { open: "normal" } }]) {
    const response = await handleShiftCheck(get(), setup({ execute: async () => raw as unknown as ShiftCheckData }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_shift_check_invalid" });
  }
});
test("actual handler/service rejects corrupted original bytes or RPC errors after one call, never falling back", async () => {
  const corrupted = shiftCheckSource(); corrupted.binding.binding!.source!.sourceText += " ";
  for (const [data, error, expected, status] of [
    [corrupted, null, "attendance_shift_check_invalid", 503],
    [null, { message: "attendance_shift_rule_binding_identity_changed" }, "attendance_shift_rule_binding_identity_changed", 409],
    [null, { message: "SQL private table / secret source" }, "attendance_unavailable", 503],
  ] as const) {
    let calls = 0; const f = setup({ execute: input => executeShiftCheck(input, { rpc: async () => { calls++; return { data, error }; } }) });
    const response = await handleShiftCheck(get(), f.deps); assert.equal(response.status, status); assert.equal(calls, 1); privateHeaders(response);
    assert.deepEqual(await response.json(), { ok: false, error: expected });
  }
});
test("entitlement denial blocks service and strict query requires all three canonical identity keys", async () => {
  const f = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  const denied = await handleShiftCheck(get(), f.deps); assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { ok: false, error: "enterprise_management_disabled" }); assert.equal(f.calls.length, 0);
  const clean = setup();
  for (const key of Object.keys(query)) { const url = new URL(get().url); url.searchParams.delete(key);
    assert.equal((await handleShiftCheck(new Request(url), clean.deps)).status, 400); }
  for (const key of ["workerId", "startEventId"]) { const url = new URL(get().url); url.searchParams.set(key, "invalid");
    assert.equal((await handleShiftCheck(new Request(url), clean.deps)).status, 400); }
  assert.equal(clean.calls.length, 0); assert.equal(clean.entitlements.length, 0);
});
