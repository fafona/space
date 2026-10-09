import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleShiftCheckAdoption, shiftCheckAdoptionDependencies as shiftDefaults } from "../app/api/merchant-enterprise/attendance/shift-check-adoption/route-handler";
import { handlePlanCoverageAdoptions, planCoverageAdoptionsDependencies as planDefaults } from "../app/api/merchant-enterprise/attendance/plan-coverage-adoptions/route-handler";
import { planAdoptionViewSiteEnabled, projectShiftCheckAdoption, projectPlanCoverageAdoptions,
  executeShiftCheckAdoption, executePlanCoverageAdoptions } from "./merchantAttendancePlanAdoptionView.server";
import { PLAN_ADOPTION_VIEW_BYTE_LIMIT, shiftCheckAdoptionQueryString, planCoverageAdoptionsQueryString,
  type ShiftCheckAdoptionData, type PlanCoverageAdoptionsData } from "./merchantAttendancePlanAdoptionView";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { planAdoptionViewActor as actor, planAdoptionViewId as id, shiftCheckAdoptionQuery as shiftQuery,
  shiftCheckAdoptionSource as shiftSource, shiftCheckAdoptionWire as shiftWire, planCoverageAdoptionsQuery as planQuery,
  planCoverageAdoptionsSource as planSource, planCoverageAdoptionsWire as planWire } from "../../scripts/fixtures/attendance-plan-adoption-view-model";

type Hooks = Partial<Omit<typeof shiftDefaults, "execute">> & { execute?: (input: { query: unknown; authUserId: string }) => Promise<unknown> };
const base: Omit<typeof shiftDefaults, "execute"> = { enabled: () => true, siteEnabled: () => true, allow: () => true,
  authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
  entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof shiftDefaults.entitlement>> };
const shiftRun = (request: Request, hooks: Hooks = {}) => handleShiftCheckAdoption(request, { ...base, ...hooks,
  execute: async input => hooks.execute ? await hooks.execute(input) as ShiftCheckAdoptionData : shiftWire() });
const planRun = (request: Request, hooks: Hooks = {}) => handlePlanCoverageAdoptions(request, { ...base, ...hooks,
  execute: async input => hooks.execute ? await hooks.execute(input) as PlanCoverageAdoptionsData : planWire() });
const shiftUrl = "https://www.faolla.com/api/merchant-enterprise/attendance/shift-check-adoption";
const planUrl = "https://www.faolla.com/api/merchant-enterprise/attendance/plan-coverage-adoptions";
const shiftGet = (suffix = "") => new Request(`${shiftUrl}?${shiftCheckAdoptionQueryString(shiftQuery)}${suffix}`);
const planGet = (suffix = "") => new Request(`${planUrl}?${planCoverageAdoptionsQueryString(planQuery)}${suffix}`);
const variants = [
  { name: "shift-check-adoption", url: shiftUrl, query: shiftQuery, get: shiftGet, run: shiftRun, wire: shiftWire, source: shiftSource,
    rpcName: "faolla_attendance_shift_check_adoption_v1", project: (raw: unknown, auth = actor) => projectShiftCheckAdoption(raw, shiftQuery, auth),
    execute: (service: AttendanceSelfRpc | null, auth = actor) => executeShiftCheckAdoption({ query: shiftQuery, authUserId: auth }, service) },
  { name: "plan-coverage-adoptions", url: planUrl, query: planQuery, get: planGet, run: planRun, wire: planWire, source: planSource,
    rpcName: "faolla_attendance_plan_coverage_adoptions_v1", project: (raw: unknown, auth = actor) => projectPlanCoverageAdoptions(raw, planQuery, auth),
    execute: (service: AttendanceSelfRpc | null, auth = actor) => executePlanCoverageAdoptions({ query: planQuery, authUserId: auth }, service) },
];
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
}

test("site gate is strict, explicit, bounded and off by default", () => {
  const enabled = { FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_SITE_IDS: shiftQuery.siteId };
  assert.equal(planAdoptionViewSiteEnabled(shiftQuery.siteId, {}), false); assert.equal(planAdoptionViewSiteEnabled(shiftQuery.siteId, enabled), true);
  assert.equal(planAdoptionViewSiteEnabled(shiftQuery.siteId + "\n", enabled), false);
  for (const flag of [undefined, "0", "true", " 1", "1 "]) assert.equal(planAdoptionViewSiteEnabled(shiftQuery.siteId,
    { ...enabled, FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED: flag }), false);
  for (const list of [undefined, "", "*", shiftQuery.siteId + ",*", shiftQuery.siteId + ",", "99990001", Array(101).fill(shiftQuery.siteId).join(","), "1".repeat(4097)])
    assert.equal(planAdoptionViewSiteEnabled(shiftQuery.siteId, { ...enabled, FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_SITE_IDS: list }), false);
  assert.equal(planAdoptionViewSiteEnabled(shiftQuery.siteId, { ...enabled, FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_SITE_IDS: ` ${shiftQuery.siteId},99990001 ` }), true);
});

test("default handlers require their old read gate and the new gate; methods remain GET only", async t => {
  const keys = ["FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED", "FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED", "FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));
  for (const oldFlag of [undefined, "0", "1"]) for (const newFlag of [undefined, "true", "1"]) {
    for (const key of keys.slice(0, 2)) { if (oldFlag === undefined) delete process.env[key]; else process.env[key] = oldFlag; }
    if (newFlag === undefined) delete process.env[keys[2]]; else process.env[keys[2]] = newFlag;
    assert.equal(shiftDefaults.enabled(), oldFlag === "1" && newFlag === "1");
    assert.equal(planDefaults.enabled(), oldFlag === "1" && newFlag === "1");
  }
  let auth = 0; const hooks: Hooks = { authenticate: async () => { auth++; throw Error("unexpected"); } };
  for (const v of variants) {
    const off = await v.run(v.get(), { ...hooks, enabled: () => false }); assert.equal(off.status, 404); privateHeaders(off);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const response = await v.run(new Request(v.url, { method }), hooks); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET");
    }
    const route = readFileSync(new URL(`../app/api/merchant-enterprise/attendance/${v.name}/route.ts`, import.meta.url), "utf8");
    assert.match(route, /export (?:const|async function) GET/); assert.doesNotMatch(route, /export (?:const|async function) (POST|PATCH|PUT|DELETE)/);
  }
  assert.equal(auth, 0);
});

test("canonical origin and strong current authentication reject before any reading", async () => {
  let reads = 0, entitlements = 0;
  const hooks: Hooks = { execute: async () => { reads++; throw Error("unexpected"); }, entitlement: async () => { entitlements++; throw Error("unexpected"); } };
  for (const v of variants) {
    for (const request of [new Request(v.get().url.replace("www.faolla.com", "evil.invalid")), new Request(v.get(), { headers: { origin: "null" } }),
      new Request(v.get(), { headers: { origin: "https://evil.invalid" } }), new Request(v.get(), { headers: { "sec-fetch-site": "same-site" } }),
      new Request(v.get(), { headers: { "sec-fetch-site": "cross-site" } })]) assert.equal((await v.run(request, hooks)).status, 403);
    for (const authenticationMethods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]])
      assert.equal((await v.run(v.get(), { ...hooks, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods }) })).status, 403);
  }
  assert.equal(reads, 0); assert.equal(entitlements, 0);
});

test("rate, site and exact query admission precede entitlement and never forward actor overrides", async () => {
  let reads = 0, entitlements = 0;
  const hooks: Hooks = { execute: async () => { reads++; throw Error("unexpected"); }, entitlement: async () => { entitlements++; throw Error("unexpected"); } };
  for (const v of variants) {
    const rate = await v.run(v.get(), { ...hooks, allow: () => false }); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60");
    assert.equal((await v.run(v.get(), { ...hooks, siteEnabled: () => false })).status, 404);
    for (const suffix of ["&workerId=" + v.query.workerId, "&actorId=" + actor, "&sourceText=x", "&command={}", "&limit=1", "&__proto__=x"])
      assert.equal((await v.run(v.get(suffix), hooks)).status, 400);
    for (const key of Object.keys(v.query)) { const url = new URL(v.get().url); url.searchParams.delete(key); assert.equal((await v.run(new Request(url), hooks)).status, 400); }
    const url = new URL(v.get().url); url.searchParams.set("siteId", v.query.siteId + "\n"); assert.equal((await v.run(new Request(url), hooks)).status, 400);
  }
  assert.equal(reads, 0); assert.equal(entitlements, 0);
});

test("actual handler to service makes one exact new RPC per paused read and projects no private source", async () => {
  for (const v of variants) {
    const calls: unknown[] = [];
    const response = await v.run(v.get(), {
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof shiftDefaults.entitlement>>,
      execute: input => { assert.deepEqual(input, { query: v.query, authUserId: actor }); return v.execute({ rpc: async (name, args) => {
        calls.push({ name, args }); return { data: v.source(), error: null }; } }); },
    });
    assert.equal(response.status, 200); privateHeaders(response);
    const body = await response.json(); assert.deepEqual(body, { ok: true, moduleEnabled: false, data: v.wire() });
    assert.doesNotMatch(JSON.stringify(body), /sourceText|canonicalFormat|Saved personal choice|"requestAuthUserId":"secret"/);
    assert.deepEqual(Object.keys(body.data).sort(), v.name === "shift-check-adoption" ? ["adoption", "check", "protocol"] : ["adoptions", "coverage", "protocol"]);
    assert.deepEqual(calls, [{ name: v.rpcName, args: { p_query: v.query, p_auth_user_id: actor } }]);
  }
});

test("each old133 source still undergoes real hash and byte validation before the public projection", async () => {
  const badShift = shiftSource(); badShift.check.binding.binding!.source!.sourceText += " ";
  const badPlan = planSource(); badPlan.coverage.sessions[1].binding.binding!.source!.sourceSha256 = "0".repeat(64);
  const cases = [{ v: variants[0], raw: badShift }, { v: variants[1], raw: badPlan }];
  for (const { v, raw } of cases) {
    let calls = 0; const response = await v.run(v.get(), { execute: () => v.execute({ rpc: async () => { calls++; return { data: raw, error: null }; } }) });
    assert.equal(calls, 1); assert.equal(response.status, 503); privateHeaders(response);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_plan_adoption_view_invalid" });
  }
  const bytes = shiftSource(); bytes.check.binding.binding!.source!.sourceBytes++;
  assert.throws(() => projectShiftCheckAdoption(bytes, shiftQuery, actor), /attendance_plan_adoption_view_invalid/);
});

test("both owner identity and current worker binding are verified, including empty coverage", () => {
  assert.throws(() => projectShiftCheckAdoption(shiftSource(), shiftQuery, id(999)), /attendance_plan_adoption_view_invalid/);
  assert.throws(() => projectPlanCoverageAdoptions(planSource(0), planQuery, id(999)), /attendance_plan_adoption_view_invalid/);
  const worker = planSource(); worker.coverage.sessions[1].binding.worker.workerId = id(999);
  assert.throws(() => projectPlanCoverageAdoptions(worker, planQuery, actor), /attendance_plan_adoption_view_invalid/);
  const identity = shiftSource(); identity.adoption!.employeeAuthUserId = actor;
  assert.throws(() => projectShiftCheckAdoption(identity, shiftQuery, actor), /attendance_plan_adoption_view_invalid/);
});

test("legacy null, zero or multiple sessions retain exact fixed references and independent cutoffs", async () => {
  const old = shiftSource(); old.adoption = null;
  assert.equal(projectShiftCheckAdoption(old, shiftQuery, actor).check.relation!.status, "linked");
  assert.equal(projectShiftCheckAdoption(old, shiftQuery, actor).adoption, null);
  for (const count of [0, 2] as const) {
    const raw = planSource(count); if (count) raw.adoptions[0].adoption = null;
    const before = structuredClone(raw); let calls = 0;
    const data = await executePlanCoverageAdoptions({ query: planQuery, authUserId: actor }, { rpc: async (name, args) => {
      calls++; assert.equal(name, variants[1].rpcName); assert.deepEqual(args, { p_query: planQuery, p_auth_user_id: actor }); return { data: raw, error: null }; } });
    assert.equal(calls, 1); assert.equal(data.coverage.sessions.length, count); assert.equal(data.adoptions.length, count);
    assert.deepEqual(data.adoptions, raw.adoptions); assert.deepEqual(raw, before); assert(Object.isFrozen(data));
    assert.equal(data.coverage.readStartedAt, raw.coverage.readStartedAt); assert.equal(data.coverage.readCompletedAt, raw.coverage.readCompletedAt);
    assert.deepEqual(data.coverage.sessions.map(check => check.asOf), raw.coverage.sessions.map(check => check.asOf));
  }
});

test("known SQL errors retain safe status, unknown transport and prototype-key errors never trigger fallback", async () => {
  for (const v of variants) {
    for (const [code, status] of [["attendance_shift_rule_binding_identity_changed", 409], ["attendance_access_denied", 403],
      ["attendance_plan_adoption_view_too_large", 422], ["attendance_shift_rule_binding_not_found", 404], ["attendance_pin_schedule_invalid", 503]] as const) {
      let calls = 0; const response = await v.run(v.get(), { execute: () => v.execute({ rpc: async () => {
        calls++; return { data: null, error: { message: code } }; } }) });
      assert.equal(calls, 1); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
    }
    for (const code of ["SQL private table", "__proto__", "constructor", "toString"]) {
      let calls = 0; await assert.rejects(v.execute({ rpc: async () => { calls++; return { data: null, error: { message: code } }; } }), /attendance_unavailable/);
      assert.equal(calls, 1);
    }
    let calls = 0; await assert.rejects(v.execute({ rpc: async () => { calls++; throw Error("secret transport"); } }), /attendance_unavailable/); assert.equal(calls, 1);
    await assert.rejects(v.execute(null), /attendance_unavailable/);
  }
});

test("auth errors and entitlement denial are redacted by exact code-status pair before service", async () => {
  for (const v of variants) {
    for (const error of [Error("private details"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("authentication_required", 500),
      new MerchantEnterpriseAccessError("secret", 403)]) {
      const response = await v.run(v.get(), { authenticate: async () => { throw error; } });
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
    }
    assert.equal((await v.run(v.get(), { authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } })).status, 401);
    let calls = 0; const response = await v.run(v.get(), { entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); },
      execute: async () => { calls++; return v.wire(); } });
    assert.equal(response.status, 403); assert.equal(calls, 0);
  }
});

test("handlers revalidate injected service data and cannot forward raw source, extra fields or fake conclusions", async () => {
  for (const v of variants) for (const raw of [v.source(), { ...v.wire(), sourceText: "private" }, { ...v.wire(), formalReady: true }]) {
    const response = await v.run(v.get(), { execute: async () => raw });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_plan_adoption_view_invalid" });
  }
  const crossed = planSource(); crossed.adoptions.reverse();
  assert.throws(() => projectPlanCoverageAdoptions(crossed, planQuery, actor), /attendance_plan_adoption_view_invalid/);
});

test("whole raw/public/HTTP and aggregate limits fail closed before forwarding, with no accessor invocation", async () => {
  const huge = "x".repeat(PLAN_ADOPTION_VIEW_BYTE_LIMIT - 100);
  for (const v of variants) {
    assert.throws(() => v.project({ ...v.source(), padding: huge }), /attendance_plan_adoption_view_too_large/);
    const response = await v.run(v.get(), { execute: async () => ({ ...v.wire(), padding: huge }) });
    assert.equal(response.status, 422); assert.deepEqual(await response.json(), { ok: false, error: "attendance_plan_adoption_view_too_large" });
    let reads = 0; const raw = Object.defineProperty(v.source(), "adoption", { enumerable: true, get() { reads++; return null; } });
    assert.throws(() => v.project(raw), /attendance_plan_adoption_view_invalid/); assert.equal(reads, 0);
  }
  const count = planSource(); count.coverage.sessions = Array(11).fill(count.coverage.sessions[0]);
  assert.throws(() => projectPlanCoverageAdoptions(count, planQuery, actor), /attendance_plan_adoption_view_too_large/);
  const events = planSource(); events.coverage.sessions.forEach(check => { check.events = Array.from({ length: 1002 }, () => ({ ...check.events[0] })); });
  assert.throws(() => projectPlanCoverageAdoptions(events, planQuery, actor), /attendance_plan_adoption_view_too_large/);
});

test("malformed service queries are rejected without any RPC", async () => {
  let calls = 0; const service: AttendanceSelfRpc = { rpc: async () => { calls++; throw Error("unexpected"); } };
  await assert.rejects(executeShiftCheckAdoption({ query: { ...shiftQuery, startEventId: "invalid" }, authUserId: actor }, service), /attendance_invalid_request/);
  await assert.rejects(executePlanCoverageAdoptions({ query: { ...planQuery, slotId: "invalid" }, authUserId: actor }, service), /attendance_invalid_request/);
  await assert.rejects(executePlanCoverageAdoptions({ query: planQuery, authUserId: "invalid" }, service), /attendance_invalid_request/);
  assert.equal(calls, 0);
});
