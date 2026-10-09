import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handlePlanRuleApprovals, planRuleApprovalsDependencies } from "../app/api/merchant-enterprise/attendance/plan-rule-approvals/route-handler";
import { executePlanRuleApprovals } from "./merchantAttendancePlanRuleApprovals.server";
import { planRuleApprovalsQueryString, parsePlanRuleApprovalsResponse } from "./merchantAttendancePlanRuleApprovals";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { planRuleApprovalsActor as owner, planRuleApprovalsQuery as query, planRuleApprovalsCommand as command,
  planRuleApprovalsWire as wire } from "../../scripts/fixtures/attendance-plan-rule-approvals-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/plan-rule-approvals";
const headers = { Origin: "https://www.faolla.com", "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
const get = (mode: "preview" | "read" | "recover" | "approve" = "preview") => new Request(`${url}?${planRuleApprovalsQueryString(query(mode))}`, { headers });
const body = () => ({ query: query("approve"), command: command() });
const post = (value: unknown = body()) => new Request(url, { method: "POST", headers, body: JSON.stringify(value) });
function setup(patch: Partial<typeof planRuleApprovalsDependencies> = {}) {
  const calls: Parameters<typeof planRuleApprovalsDependencies.execute>[0][] = [];
  const deps: typeof planRuleApprovalsDependencies = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof planRuleApprovalsDependencies.entitlement>>,
    execute: async input => { calls.push(input); return wire(input.query.mode); }, ...patch };
  return { deps, calls };
}

test("plan approval route defaults off before authentication and rejects unsupported verbs", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED; else process.env.FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED = previous; });
  delete process.env.FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED;
  let authenticated = 0; const f = setup({ authenticate: async () => { authenticated++; throw Error("unexpected"); } });
  assert.equal((await handlePlanRuleApprovals(get(), { ...f.deps, enabled: planRuleApprovalsDependencies.enabled })).status, 404);
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handlePlanRuleApprovals(new Request(url, { method }), f.deps);
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), "GET, POST");
  }
  assert.equal(authenticated, 0); assert.equal(f.calls.length, 0);
});
test("plan approvals reject other origins and weak authentication without SQL", async () => {
  const f = setup();
  for (const request of [new Request(get().url.replace("www.", "merchant.")), new Request(get(), { headers: { origin: "https://other.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "cross-site" } }), new Request(get(), { headers: { "sec-fetch-site": "same-site" } })]) assert.equal((await handlePlanRuleApprovals(request, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["password", "magiclink"], ["recovery"]]) {
    assert.equal((await handlePlanRuleApprovals(get(), { ...f.deps, authenticate: async () => ({ user: { id: owner } as User, accessToken: "", authenticationMethods: methods }) })).status, 403);
  }
  const rate = await handlePlanRuleApprovals(get(), { ...f.deps, allow: () => false });
  assert.equal(rate.status, 429); assert.equal(rate.headers.get("Retry-After"), "60"); assert.equal(f.calls.length, 0);
});
test("GET cannot approve and POST requires exact body without query parameters or duplicate JSON keys", async () => {
  const f = setup();
  for (const request of [get("approve"), new Request(get().url + "&mode=read", { headers }), post({ ...body(), source: {} }),
    post({ query: query("read"), command: command() }), new Request(url + "?x=1", post()),
    new Request(url, { method: "POST", headers, body: JSON.stringify(body()).replace('"reason":', '"reason":"duplicate","reason":') })]) {
    assert.equal((await handlePlanRuleApprovals(request, f.deps)).status, 400);
  }
  assert.equal(f.calls.length, 0);
});
test("valid modes return strictly validated private uncached data; paused original POST reaches SQL", async () => {
  const f = setup();
  for (const mode of ["preview", "read", "recover", "approve"] as const) {
    const response = await handlePlanRuleApprovals(mode === "approve" ? post() : get(mode), f.deps);
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(response.headers.get("Vary")!, /Authorization/);
    parsePlanRuleApprovalsResponse(await response.json(), query(mode), owner, mode === "approve" ? command() : null);
  }
  const paused = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof planRuleApprovalsDependencies.entitlement>> });
  const response = await handlePlanRuleApprovals(post(), paused.deps); assert.equal(response.status, 200); assert.equal(paused.calls[0].moduleEnabled, false);
});
test("body reader bounds actual bytes and rejects malformed UTF8 and content types", async () => {
  const f = setup();
  for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "Content-Length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([123, 34, 0xff, 34, 58, 49, 125]) }), 400],
    [new Request(url, { method: "POST", headers, body: "{" }), 400],
  ] as const) assert.equal((await handlePlanRuleApprovals(request, f.deps)).status, status);
  assert.equal(f.calls.length, 0);
});
test("stalled or aborted request bodies are cancelled under one total deadline", async () => {
  let cancelled = 0; const f = setup({ bodyTimeoutMs: 15 });
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled++; } });
  const stalled = new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  assert.equal((await handlePlanRuleApprovals(stalled, f.deps)).status, 400); assert.equal(cancelled, 1);
  const controller = new AbortController(); controller.abort();
  assert.equal((await handlePlanRuleApprovals(new Request(url, { method: "POST", headers, body: JSON.stringify(body()), signal: controller.signal }), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("handler does not echo upstream details prototype errors or invalid service success", async () => {
  for (const thrown of [Error("private secret"), new MerchantAttendanceError("constructor"), new MerchantAttendanceError("toString"), new MerchantEnterpriseAccessError("secret", 403)]) {
    const f = setup({ execute: async () => { throw thrown; } }); const response = await handlePlanRuleApprovals(get(), f.deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const malformed = setup({ execute: async () => ({ ...wire(), actorId: "invalid" }) });
  assert.equal((await handlePlanRuleApprovals(get(), malformed.deps)).status, 503);
  const known = setup({ execute: async () => { throw new MerchantAttendanceError("attendance_plan_rule_source_conflict"); } });
  assert.equal((await handlePlanRuleApprovals(post(), known.deps)).status, 409);
  const unauthorized = setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 401); } });
  assert.equal((await handlePlanRuleApprovals(get(), unauthorized.deps)).status, 401); assert.equal(unauthorized.calls.length, 0);
});
test("service calls one dedicated RPC with parsed data and validates every result", async () => {
  for (const mode of ["preview", "read", "recover", "approve"] as const) {
    let calls = 0;
    const result = await executePlanRuleApprovals({ query: query(mode), command: mode === "approve" ? command() : null, authUserId: owner, moduleEnabled: false }, {
      rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_plan_rule_approvals_v1"); assert.deepEqual(args, { p_query: query(mode), p_command: mode === "approve" ? command() : null, p_auth_user_id: owner, p_module_enabled: false }); return { data: wire(mode), error: null }; },
    });
    assert.deepEqual(result, wire(mode)); assert.equal(calls, 1);
  }
  for (const message of ["private SQL detail", "constructor", "__proto__"]) await assert.rejects(executePlanRuleApprovals({ query: query(), authUserId: owner }, {
    rpc: async () => ({ data: null, error: { message } }),
  }), { code: "attendance_unavailable" });
  await assert.rejects(executePlanRuleApprovals({ query: query(), authUserId: owner }, { rpc: async () => ({ data: { ...wire(), revision: -1 }, error: null }) }), { code: "attendance_plan_rule_invalid" });
  await assert.rejects(executePlanRuleApprovals({ query: query("approve"), authUserId: owner }), { code: "attendance_invalid_request" });
});
