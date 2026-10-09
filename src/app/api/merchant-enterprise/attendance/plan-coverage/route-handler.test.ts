import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handlePlanCoverage, planCoverageDependencies } from "./route-handler";
import { executePlanCoverage, projectPlanCoverage } from "@/lib/merchantAttendancePlanCoverage.server";
import { planCoverageQueryString, PLAN_COVERAGE_BYTE_LIMIT, type PlanCoverageData } from "@/lib/merchantAttendancePlanCoverage";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { planCoverageWire as wire, planCoverageQuery as query, planCoverageActor as actor, planCoverageSource } from "../../../../../../scripts/fixtures/attendance-plan-coverage-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/plan-coverage";
const get = (suffix = "") => new Request(`${url}?${planCoverageQueryString(query)}${suffix}`);
function setup(patch: Partial<typeof planCoverageDependencies> = {}) {
  const calls: unknown[] = [], entitlements: string[] = [];
  const deps: typeof planCoverageDependencies = { enabled: () => true,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async siteId => { entitlements.push(siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof planCoverageDependencies.entitlement>>; },
    allow: () => true, execute: async input => { calls.push(input); return wire(); }, ...patch };
  return { calls, entitlements, deps };
}
function privateHeaders(response: Response) { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token"); }

test("independent route uses its exact default-off flag and permits GET only before auth", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED; else process.env.FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED = old; });
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const flag of [undefined, "0", "true", " 1"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED; else process.env.FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED = flag;
    const response = await handlePlanCoverage(get(), { ...f.deps, enabled: planCoverageDependencies.enabled }); assert.equal(response.status, 404); privateHeaders(response);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) { const response = await handlePlanCoverage(new Request(url, { method }), f.deps); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8"); assert.match(route, /export const GET/); assert.doesNotMatch(route, /export const (POST|PATCH|PUT|DELETE)/);
});

test("canonical origin/fetch-site and strong authentication gates precede reads", async () => {
  const f = setup();
  for (const req of [new Request(get().url.replace("www.faolla.com", "evil.invalid")), new Request(get(), { headers: { origin: "null" } }), new Request(get(), { headers: { origin: "https://evil.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } })]) assert.equal((await handlePlanCoverage(req, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]]) assert.equal((await handlePlanCoverage(get(), { ...f.deps,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
});

test("rate and exact query gates reject before entitlement/SQL and never forward actor overrides", async () => {
  const f = setup(), limited = await handlePlanCoverage(get(), { ...f.deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  for (const suffix of ["&workerId=" + query.workerId, "&actorId=" + actor, "&sourceText=x", "&command={}", "&limit=1", "&__proto__=x"]) assert.equal((await handlePlanCoverage(get(suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0); assert.equal(f.entitlements.length, 0);
});

test("paused actual handler/service projection reads exact139 only and never exposes sourceText", async () => {
  const calls: unknown[] = [], f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof planCoverageDependencies.entitlement>>,
    execute: input => executePlanCoverage(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: planCoverageSource(), error: null }; } }) });
  const response = await handlePlanCoverage(get(), f.deps); assert.equal(response.status, 200); privateHeaders(response); const body = await response.json();
  assert.deepEqual(body, { ok: true, moduleEnabled: false, data: wire() }); assert.equal(JSON.stringify(body).includes("sourceText"), false);
  assert.deepEqual(Object.keys(body.data).sort(), ["protocol", "algorithmVersion", "readOnly", "formalReady", "siteId", "actorId", "worker", "slot", "readStartedAt", "readCompletedAt", "sessions"].sort());
  assert(!Object.hasOwn(body.data.sessions[0].rule.binding!, "source")); assert(!Object.hasOwn(body.data, "checks"));
  assert(!JSON.stringify(body).includes("Saved personal choice")); assert(!JSON.stringify(body).includes("canonicalFormat"));
  assert.deepEqual(calls, [{ name: "faolla_attendance_plan_coverage_v1", args: { p_query: query, p_auth_user_id: actor } }]);
});

test("known denied/identity/missing-reader errors retain safe status; unknown errors never expose private detail", async () => {
  for (const [code, status] of [["attendance_shift_rule_binding_not_found", 404], ["attendance_shift_rule_binding_identity_changed", 409], ["attendance_access_denied", 403], ["attendance_shift_check_invalid", 503], ["attendance_shift_rule_binding_invalid", 503]] as const) {
    const response = await handlePlanCoverage(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); privateHeaders(response);
  }
  for (const error of [Error("private SQL"), new MerchantAttendanceError("secret"), new MerchantAttendanceError("__proto__"), new MerchantAttendanceError("constructor"), new MerchantAttendanceError("toString"), new MerchantEnterpriseAccessError("authentication_required", 500)]) {
    const response = await handlePlanCoverage(get(), setup({ authenticate: async () => { throw error; } }).deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  assert.equal((await handlePlanCoverage(get(), setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } }).deps)).status, 401);
});

test("handler revalidates injected service projections and refuses accidental raw139 output", async () => {
  for (const raw of [planCoverageSource(), { ...wire(), sourceText: "private" }, { ...wire(), formalReady: true }, { ...wire(), checks: { open: "normal" } }]) {
    const response = await handlePlanCoverage(get(), setup({ execute: async () => raw as unknown as PlanCoverageData }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_plan_coverage_invalid" });
  }
});
test("actual handler/service rejects corrupted original bytes or RPC errors after one call, never falling back", async () => {
  const corrupted = planCoverageSource(); corrupted.sessions[0].binding.binding!.source!.sourceText += " ";
  for (const [data, error, expected, status] of [
    [corrupted, null, "attendance_plan_coverage_invalid", 503],
    [null, { message: "attendance_shift_rule_binding_identity_changed" }, "attendance_shift_rule_binding_identity_changed", 409],
    [null, { message: "SQL private table / secret source" }, "attendance_unavailable", 503],
  ] as const) {
    let calls = 0; const f = setup({ execute: input => executePlanCoverage(input, { rpc: async () => { calls++; return { data, error }; } }) });
    const response = await handlePlanCoverage(get(), f.deps); assert.equal(response.status, status); assert.equal(calls, 1); privateHeaders(response);
    assert.deepEqual(await response.json(), { ok: false, error: expected });
  }
});
test("entitlement denial blocks service and strict query requires all three canonical identity keys", async () => {
  const f = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  const denied = await handlePlanCoverage(get(), f.deps); assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { ok: false, error: "enterprise_management_disabled" }); assert.equal(f.calls.length, 0);
  const clean = setup();
  for (const key of Object.keys(query)) { const url = new URL(get().url); url.searchParams.delete(key);
    assert.equal((await handlePlanCoverage(new Request(url), clean.deps)).status, 400); }
  for (const key of ["workerId", "slotId"]) { const url = new URL(get().url); url.searchParams.set(key, "invalid");
    assert.equal((await handlePlanCoverage(new Request(url), clean.deps)).status, 400); }
  assert.equal(clean.calls.length, 0); assert.equal(clean.entitlements.length, 0);
});
test("one service call projects zero or multiple sessions and preserves independent read cutoffs without mutating raw input", async () => {
  for (const count of [0, 2] as const) {
    const raw = planCoverageSource(count), before = structuredClone(raw); let calls = 0;
    const data = await executePlanCoverage({ query, authUserId: actor }, { rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_attendance_plan_coverage_v1"); assert.deepEqual(args, { p_query: query, p_auth_user_id: actor }); return { data: raw, error: null };
    } });
    assert.equal(calls, 1); assert.equal(data.sessions.length, count); assert.equal(data.readStartedAt, raw.readStartedAt); assert.equal(data.readCompletedAt, raw.readCompletedAt);
    assert.deepEqual(data.sessions.map(s => s.asOf), raw.sessions.map(s => s.asOf)); assert.deepEqual(raw, before);
    assert(Object.isFrozen(data)); assert(!JSON.stringify(data).includes("sourceText")); assert(!Object.hasOwn(data, "coverage"));
  }
});
test("every raw child is independently byte-verified and wrong scope/relation/extra fields fail before any public projection", () => {
  const fail = (change: (raw: ReturnType<typeof planCoverageSource>) => void) => { const raw = planCoverageSource(2); change(raw);
    assert.throws(() => projectPlanCoverage(raw, query, actor), (error: unknown) => error instanceof MerchantAttendanceError && error.code === "attendance_plan_coverage_invalid"); };
  fail(raw => { raw.sessions[1].binding.binding!.source!.sourceSha256 = "0".repeat(64); });
  fail(raw => { raw.sessions[1].binding.actorId = query.workerId; });
  fail(raw => { raw.sessions[1].binding.worker.workerId = actor; });
  fail(raw => { raw.sessions[1].relation!.selection!.slotId = actor; });
  fail(raw => { Object.assign(raw, { hiddenPrivateValue: "do not forward" }); });
  fail(raw => { Object.assign(raw.sessions[1], { extra: "private" }); });
  fail(raw => { raw.sessions[1] = structuredClone(raw.sessions[0]); });
});
test("tree, byte and aggregate limits are checked before source projection; accessors are never invoked", () => {
  const oversized = planCoverageSource(); Object.assign(oversized, { padding: "x".repeat(PLAN_COVERAGE_BYTE_LIMIT) });
  assert.throws(() => projectPlanCoverage(oversized, query, actor), (error: unknown) => error instanceof MerchantAttendanceError && error.code === "attendance_plan_coverage_too_large");
  const tooMany = planCoverageSource(); tooMany.sessions = Array.from({ length: 11 }, () => structuredClone(tooMany.sessions[0]));
  assert.throws(() => projectPlanCoverage(tooMany, query, actor), /attendance_plan_coverage_too_large/);
  const events = planCoverageSource(2); events.sessions.forEach(child => { child.events = Array.from({ length: 1002 }, () => ({ ...child.events[0] })); });
  assert.throws(() => projectPlanCoverage(events, query, actor), /attendance_plan_coverage_too_large/);
  const accessor = planCoverageSource(); let reads = 0;
  Object.defineProperty(accessor, "worker", { enumerable: true, get: () => { reads++; return {}; } });
  assert.throws(() => projectPlanCoverage(accessor, query, actor), /attendance_plan_coverage_invalid/); assert.equal(reads, 0);
  const sparse = planCoverageSource(2); Reflect.deleteProperty(sparse.sessions, "0"); assert.throws(() => projectPlanCoverage(sparse, query, actor), /attendance_plan_coverage_invalid/);
});
test("missing/throwing service fails safely and malformed query never calls the injected RPC", async () => {
  await assert.rejects(() => executePlanCoverage({ query, authUserId: actor }, null), /attendance_unavailable/);
  let calls = 0; const service = { rpc: async () => { calls++; throw Error("private transport details"); } };
  await assert.rejects(() => executePlanCoverage({ query, authUserId: actor }, service), /attendance_unavailable/); assert.equal(calls, 1);
  await assert.rejects(() => executePlanCoverage({ query: { ...query, slotId: "invalid" }, authUserId: actor }, service), /attendance_invalid_request/);
  assert.equal(calls, 1);
});
