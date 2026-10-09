import test from "node:test";
import assert from "node:assert/strict";
import { handlePlanExceptions, planExceptionsDependencies } from "./route-handler";
import type { User } from "@supabase/supabase-js";
import { planExceptionQueryString } from "@/lib/merchantAttendancePlanExceptions";
import { executePlanExceptions } from "@/lib/merchantAttendancePlanExceptions.server";
import { exceptionUiQuery, exceptionUiWire, exceptionUiOwner, exceptionUiEmployee, exceptionUiAuth, exceptionUiDecisionCommand } from "../../../../../../scripts/fixtures/attendance-plan-exception-ui-model";
const entitlement = (enabled = true) => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: enabled } }) as Awaited<ReturnType<typeof planExceptionsDependencies.entitlement>>;
const auth = (id = exceptionUiOwner, methods = ["password"]) => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods });
const deps = () => ({ enabled: () => true, siteEnabled: () => true, authenticate: async () => auth(), entitlement: async () => entitlement(), allow: () => true });
function req(method = "GET", body?: unknown, extra: Record<string, string> = {}, access: "owner" | "self" = "owner") {
  const url = "https://www.faolla.com/api/merchant-enterprise/attendance/plan-exceptions" + (method === "GET" ? "?" + planExceptionQueryString(exceptionUiQuery(access, "list")) : "");
  return new Request(url, { method, headers: { host: "www.faolla.com", origin: "https://www.faolla.com", "sec-fetch-site": "same-origin", ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}
test("exceptions owner GET is private and exactly scoped; source read is not a POST", async () => {
  const calls: unknown[] = []; const r = await handlePlanExceptions(req(), { ...deps(), execute: async i => { calls.push(i); return exceptionUiWire({ mode: "list" }); } });
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { query: exceptionUiQuery("owner", "list"), authUserId: exceptionUiOwner, command: null, moduleEnabled: true });
});
test("exceptions flags, origin, auth and method fail before business RPC", async () => {
  let calls = 0; const base = { ...deps(), execute: async () => { calls++; return exceptionUiWire({ mode: "list" }); } };
  assert.equal((await handlePlanExceptions(req(), { ...base, enabled: () => false })).status, 404);
  assert.equal((await handlePlanExceptions(req(), { ...base, siteEnabled: () => false })).status, 404);
  assert.equal((await handlePlanExceptions(req("DELETE"), base)).status, 405);
  assert.equal((await handlePlanExceptions(req("GET", undefined, { origin: "https://wrong.invalid" }), base)).status, 403);
  assert.equal((await handlePlanExceptions(req(), { ...base, authenticate: async () => auth(exceptionUiOwner, ["recovery"]) })).status, 403);
  assert.equal((await handlePlanExceptions(req(), { ...base, allow: () => false })).status, 429); assert.equal(calls, 0);
});
test("exceptions rejects duplicate JSON, oversize and unsupported content before execute", async () => {
  let calls = 0; const base = { ...deps(), execute: async () => { calls++; return exceptionUiWire(); } };
  assert.equal((await handlePlanExceptions(req("POST", '{"query":{},"query":{},"command":{}}'), base)).status, 400);
  assert.equal((await handlePlanExceptions(req("POST", "a".repeat(8200)), base)).status, 413);
  assert.equal((await handlePlanExceptions(req("POST", "{}", { "content-type": "text/plain" }), base)).status, 415); assert.equal(calls, 0);
});
test("exceptions POST decision uses exact Auth/body, no browser-issued candidate", async () => {
  const query = exceptionUiQuery("owner", "decide"), command = exceptionUiDecisionCommand(); let calls = 0;
  const response = await handlePlanExceptions(req("POST", { query, command }), { ...deps(), execute: async i => { calls++; assert.deepEqual(i.command, command); assert.equal(i.authUserId, exceptionUiOwner); return exceptionUiWire({ mode: "decide", command }); } });
  assert.equal(response.status, 200, JSON.stringify(await response.json())); assert.equal(calls, 1);
  assert.equal((await handlePlanExceptions(req("POST", { query, command: { ...command, eligible: true } }), { ...deps(), execute: async () => { calls++; return exceptionUiWire(); } })).status, 400); assert.equal(calls, 1);
});
test("exceptions self employee and auth IDs stay distinct and mismatched server response is redacted", async () => {
  const response = await handlePlanExceptions(req("GET", undefined, {}, "self"), { ...deps(), authenticate: async () => auth(exceptionUiAuth), execute: async () => exceptionUiWire({ access: "self", mode: "list" }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).data.employeeId, exceptionUiEmployee);
  const wrong = await handlePlanExceptions(req(), { ...deps(), execute: async () => ({ ...exceptionUiWire({ mode: "list" }), actorId: exceptionUiAuth }) });
  assert.equal(wrong.status, 503); assert.deepEqual(await wrong.json(), { ok: false, error: "attendance_plan_exception_review_invalid" });
});
test("exceptions paused mode still reaches SQL for original receipt recovery", async () => {
  let enabled = true; const r = await handlePlanExceptions(req(), { ...deps(), entitlement: async () => entitlement(false), execute: async i => { enabled = i.moduleEnabled!; return exceptionUiWire({ mode: "list" }); } });
  assert.equal(r.status, 200); assert.equal(enabled, false); assert.equal((await r.json()).moduleEnabled, false);
});

test("exceptions exact SQL sealed error survives the real service as a private 409, unknown details remain503", async () => {
  const query = exceptionUiQuery("owner", "decide"), command = exceptionUiDecisionCommand();
  for (const message of ["attendance_period_sealed", "attendance_period_sealed: private details"]) {
    let calls = 0;
    const response = await handlePlanExceptions(req("POST", { query, command }), { ...deps(),
      execute: input => executePlanExceptions(input, { rpc: async (name, args) => {
        calls++; assert.equal(name, "faolla_attendance_plan_exception_posthoc_review_v1");
        assert.deepEqual(args.p_command, command); assert.equal(args.p_auth_user_id, exceptionUiOwner);
        return { data: null, error: { message } };
      } }),
    });
    const exact = message === "attendance_period_sealed";
    assert.equal(calls, 1); assert.equal(response.status, exact ? 409 : 503);
    assert.deepEqual(await response.json(), { ok: false, error: exact ? message : "attendance_unavailable" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
