import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handlePlanPosthocEvaluation, planPosthocEvaluationDependencies } from "./route-handler";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { parsePlanPosthocEvaluation } from "@/lib/merchantAttendancePlanPosthocEvaluation";
import { PLAN_POSTHOC_EVALUATION_API, PLAN_POSTHOC_EVALUATION_HTTP_ERRORS, planPosthocEvaluationQueryString, parsePlanPosthocEvaluationHttpQuery, parsePlanPosthocEvaluationResponse, planPosthocEvaluationFacts } from "@/lib/merchantAttendancePlanPosthocEvaluationHttp";
import type { PlanPosthocEvaluationFacts, PlanPosthocEvaluationQuery } from "@/lib/merchantAttendancePlanPosthocEvaluationContract";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../../../../../scripts/fixtures/attendance-plan-exception-ui-model";

function facts(): PlanPosthocEvaluationFacts {
  const old = exceptionUiEligibleSource();
  return { protocol: "plan-posthoc-evaluation-v1", siteId: old.siteId, actorId: old.actorId, worker: old.worker, slot: old.slot, readAt: old.readAt, fingerprint: old.fingerprint,
    source: { protocol: "posthoc-evaluation-evidence-v1", basis: old.source, posthoc: { revision: 0, current: null, selected: [], approval: null }, observations: [], approval: old.source.approval,
      leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: ["posthoc_inactive"] } };
}
const query = (): PlanPosthocEvaluationQuery => ({ siteId: facts().siteId, workerId: facts().worker.workerId, slotId: facts().slot.id });
const value = () => parsePlanPosthocEvaluation(facts(), query(), facts().actorId);
const entitlement = (on = true) => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: on } }) as Awaited<ReturnType<typeof planPosthocEvaluationDependencies.entitlement>>;
const base = () => ({ authenticate: async () => ({ user: { id: facts().actorId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }), entitlement: async () => entitlement(), allow: () => true, execute: async () => value() });
function request(options: { method?: string; tail?: string; headers?: Record<string, string>; origin?: string } = {}) {
  return new Request((options.origin ?? "https://www.faolla.com") + PLAN_POSTHOC_EVALUATION_API + "?" + (options.tail ?? planPosthocEvaluationQueryString(query())), {
    method: options.method ?? "GET", headers: { host: "www.faolla.com", origin: "https://www.faolla.com", "sec-fetch-site": "same-origin", ...options.headers },
  });
}
test("GET passes actual authenticated actor and exact3 query, returning only8 facts under private no-store", async () => {
  let calls = 0;
  const response = await handlePlanPosthocEvaluation(request(), { ...base(), execute: async input => {
    calls++; assert.deepEqual(input, { query: query(), authUserId: facts().actorId }); return value();
  } });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
  const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ["data", "ok"]);
  assert.deepEqual(Object.keys(body.data).sort(), ["actorId", "fingerprint", "protocol", "readAt", "siteId", "slot", "source", "worker"]);
  assert.equal(parsePlanPosthocEvaluationResponse(body, query(), facts().actorId).state, "not_active");
});
test("POST/PUT/DELETE/HEAD cannot invoke authentication or business service", async () => {
  let calls = 0;
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    const response = await handlePlanPosthocEvaluation(request({ method }), { ...base(), authenticate: async () => { calls++; return base().authenticate(); }, execute: async () => { calls++; return value(); } });
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); assert.deepEqual(await response.json(), { ok: false, error: "method_not_allowed" });
  } assert.equal(calls, 0);
});
test("canonical origin, cross-site and trusted-fetch guards run before Auth/RPC", async () => {
  let calls = 0;
  const cases: { headers?: Record<string, string>; origin?: string }[] = [{ headers: { origin: "https://evil.invalid" } }, { headers: { "sec-fetch-site": "cross-site" } }, { headers: { "sec-fetch-site": "same-site" } }, { origin: "https://evil.invalid", headers: { host: "evil.invalid" } }];
  for (const options of cases) {
    const response = await handlePlanPosthocEvaluation(request(options), { ...base(), authenticate: async () => { calls++; return base().authenticate(); } });
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "forbidden_origin" });
  } assert.equal(calls, 0);
});
test("empty/invite/recovery mixed authentication and limit refusal never reach business RPC", async () => {
  let calls = 0; const execute = async () => { calls++; return value(); };
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "recovery"]]) {
    const response = await handlePlanPosthocEvaluation(request(), { ...base(), execute, authenticate: async () => ({ ...await base().authenticate(), authenticationMethods: methods }) });
    assert.equal(response.status, 403);
  }
  const limited = await handlePlanPosthocEvaluation(request(), { ...base(), execute, allow: actor => { assert.equal(actor, facts().actorId); return false; } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60"); assert.equal(calls, 0);
});
test("module/write feature pause does not disable the independently authenticated saved read", async () => {
  let calls = 0;
  const response = await handlePlanPosthocEvaluation(request(), { ...base(), entitlement: async site => { assert.equal(site, query().siteId); return entitlement(false); }, execute: async input => {
    calls++; assert.equal("moduleEnabled" in input, false); assert.equal("allowWrite" in input, false); assert.equal("command" in input, false); return value();
  } }); assert.equal(response.status, 200); assert.equal(calls, 1);
});
test("duplicate/extra/missing parameters cannot supply actor, approval, command or frame", async () => {
  let calls = 0; const q = planPosthocEvaluationQueryString(query());
  for (const tail of [q + "&siteId=" + query().siteId, q + "&authUserId=" + id(999), q + "&command=null", q + "&approval=true", q + "&timeZone=UTC", "siteId=" + query().siteId, q + "&worker%49d=" + query().workerId]) {
    const response = await handlePlanPosthocEvaluation(request({ tail }), { ...base(), execute: async () => { calls++; return value(); } }); assert.equal(response.status, 400);
  } assert.equal(calls, 0);
  assert.deepEqual(parsePlanPosthocEvaluationHttpQuery(request().url), query());
  assert.throws(() => parsePlanPosthocEvaluationHttpQuery(request().url + "#ignored"));
  assert.throws(() => parsePlanPosthocEvaluationHttpQuery(request().url + "\n"));
});
test("SQL remains owner authority: authorization failures are preserved, unknown failures sanitized", async () => {
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_worker_changed", 409], ["attendance_plan_posthoc_evaluation_too_large", 422], ["unknown_private_body", 503]] as const) {
    const response = await handlePlanPosthocEvaluation(request(), { ...base(), execute: async () => { throw new MerchantAttendanceError(code); } });
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code === "unknown_private_body" ? "attendance_unavailable" : code });
  }
  for (const [code, status, expected] of [["unauthorized", 401, 401], ["enterprise_auth_unavailable", 503, 503], ["unauthorized", 403, 503]] as const) {
    const response = await handlePlanPosthocEvaluation(request(), { ...base(), authenticate: async () => { throw new MerchantEnterpriseAccessError(code, status); } });
    assert.equal(response.status, expected);
  }
  assert.equal(PLAN_POSTHOC_EVALUATION_HTTP_ERRORS.forbidden_origin, 403); assert.equal(PLAN_POSTHOC_EVALUATION_HTTP_ERRORS.attendance_rate_limited, 429);
});
test("response target/actor corruption fails; private sourceText/derived fields are not published", async () => {
  const corrupt = await handlePlanPosthocEvaluation(request(), { ...base(), execute: async () => ({ ...value(), actorId: id(999) }) }); assert.equal(corrupt.status, 503);
  const withPrivate = await handlePlanPosthocEvaluation(request(), { ...base(), execute: async () => ({ ...value(), sourceText: "private SQL bytes", candidate: { ...value().candidate, selected: { startAt: null, endAt: null } } }) });
  assert.equal(withPrivate.status, 200); const body = await withPrivate.json(); assert.equal("sourceText" in body.data, false); assert.equal("candidate" in body.data, false);
  assert.deepEqual(parsePlanPosthocEvaluationResponse(body, query(), facts().actorId).candidate, value().candidate);
});
test("browser response is exact, getter-safe and independently rederived rather than trusting copied candidate", () => {
  const body = { ok: true, data: planPosthocEvaluationFacts(value()) };
  assert.deepEqual(parsePlanPosthocEvaluationResponse(body, query(), facts().actorId), value());
  for (const variant of [{ ...body, canWrite: false }, { ...body, ok: 1 }, { ok: true, data: { ...body.data, candidate: value().candidate } }, { ok: true, data: { ...body.data, sourceText: "{}" } }]) assert.throws(() => parsePlanPosthocEvaluationResponse(variant, query(), facts().actorId));
  let calls = 0; Object.defineProperty(body, "data", { enumerable: true, get: () => { calls++; throw Error("getter"); } });
  assert.throws(() => parsePlanPosthocEvaluationResponse(body, query(), facts().actorId)); assert.equal(calls, 0);
});
