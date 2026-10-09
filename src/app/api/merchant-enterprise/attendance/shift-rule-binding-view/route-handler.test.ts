import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleShiftRuleView, shiftRuleViewDependencies } from "./route-handler";
import { executeShiftRuleView } from "@/lib/merchantAttendanceShiftRuleView.server";
import { shiftRuleViewQueryString, type ShiftRuleViewResult } from "@/lib/merchantAttendanceShiftRuleView";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { shiftRuleViewWire as wire, shiftRuleViewQuery as query, shiftRuleViewActor as actor } from "../../../../../../scripts/fixtures/attendance-shift-rule-view-model";
import { shiftRuleBindingWire } from "../../../../../../scripts/fixtures/attendance-shift-rule-binding-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/shift-rule-binding-view";
const get = (suffix = "") => new Request(`${url}?${shiftRuleViewQueryString(query)}${suffix}`);
function setup(patch: Partial<typeof shiftRuleViewDependencies> = {}) {
  const calls: unknown[] = [], entitlements: string[] = [];
  const deps: typeof shiftRuleViewDependencies = { enabled: () => true,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async siteId => { entitlements.push(siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof shiftRuleViewDependencies.entitlement>>; },
    allow: () => true, execute: async input => { calls.push(input); return wire(); }, ...patch };
  return { calls, entitlements, deps };
}
function privateHeaders(response: Response) { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token"); }

test("compact route shares155 exact default-off flag and permits GET only before auth", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED = old; });
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const flag of [undefined, "0", "true", " 1"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED = flag;
    const response = await handleShiftRuleView(get(), { ...f.deps, enabled: shiftRuleViewDependencies.enabled }); assert.equal(response.status, 404); privateHeaders(response);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) { const response = await handleShiftRuleView(new Request(url, { method }), f.deps); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8"); assert.match(route, /export const GET/); assert.doesNotMatch(route, /export const (POST|PATCH|PUT|DELETE)/);
});

test("canonical origin/fetch-site and strong authentication gates precede reads", async () => {
  const f = setup();
  for (const req of [new Request(get().url.replace("www.faolla.com", "evil.invalid")), new Request(get(), { headers: { origin: "null" } }), new Request(get(), { headers: { origin: "https://evil.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } })]) assert.equal((await handleShiftRuleView(req, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]]) assert.equal((await handleShiftRuleView(get(), { ...f.deps,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
});

test("rate and exact query gates reject before entitlement/SQL and never forward actor overrides", async () => {
  const f = setup(), limited = await handleShiftRuleView(get(), { ...f.deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  for (const suffix of ["&workerId=" + query.workerId, "&actorId=" + actor, "&sourceText=x", "&command={}", "&limit=1", "&__proto__=x"]) assert.equal((await handleShiftRuleView(get(suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0); assert.equal(f.entitlements.length, 0);
});

test("paused actual handler/service projection reads exact135 only and never exposes sourceText", async () => {
  const calls: unknown[] = [], f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof shiftRuleViewDependencies.entitlement>>,
    execute: input => executeShiftRuleView(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: shiftRuleBindingWire(), error: null }; } }) });
  const response = await handleShiftRuleView(get(), f.deps); assert.equal(response.status, 200); privateHeaders(response); const body = await response.json();
  assert.deepEqual(body, { ok: true, moduleEnabled: false, data: wire() }); assert.equal(JSON.stringify(body).includes("sourceText"), false);
  assert.deepEqual(calls, [{ name: "faolla_attendance_shift_rule_binding_v1", args: { p_query: query, p_auth_user_id: actor } }]);
});

test("known denied/identity/missing-reader errors retain safe status; unknown errors never expose private detail", async () => {
  for (const [code, status] of [["attendance_shift_rule_binding_not_found", 404], ["attendance_shift_rule_binding_identity_changed", 409], ["attendance_access_denied", 403], ["attendance_shift_rule_view_invalid", 503], ["attendance_shift_rule_binding_invalid", 503]] as const) {
    const response = await handleShiftRuleView(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); privateHeaders(response);
  }
  for (const error of [Error("private SQL"), new MerchantAttendanceError("secret"), new MerchantEnterpriseAccessError("authentication_required", 500)]) {
    const response = await handleShiftRuleView(get(), setup({ authenticate: async () => { throw error; } }).deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  assert.equal((await handleShiftRuleView(get(), setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } }).deps)).status, 401);
});

test("handler revalidates injected service projections and refuses accidental raw155 output", async () => {
  for (const raw of [shiftRuleBindingWire(), { ...wire(), sourceText: "private" }, { ...wire(), formalReady: true }]) {
    const response = await handleShiftRuleView(get(), setup({ execute: async () => raw as unknown as ShiftRuleViewResult }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_shift_rule_view_invalid" });
  }
});
