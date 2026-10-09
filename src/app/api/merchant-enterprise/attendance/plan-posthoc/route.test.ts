import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handlePlanPosthoc, planPosthocDependencies } from "./route-handler";
import { planPosthocQueryString } from "@/lib/merchantAttendancePlanPosthocHttp";
import { posthocUiQuery, posthocUiValue, posthocUiSaved, posthocUiCommand, posthocUiId } from "../../../../../../scripts/fixtures/attendance-plan-posthoc-ui-model";
const entitlement = (on = true) => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: on } }) as Awaited<ReturnType<typeof planPosthocDependencies.entitlement>>;
const base = () => ({ siteEnabled: () => true, authenticate: async () => ({ user: { id: posthocUiValue().actorId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }), entitlement: async () => entitlement(), allow: () => true });
function request(method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://www.faolla.com/api/merchant-enterprise/attendance/plan-posthoc" + (method === "GET" ? "?" + planPosthocQueryString(posthocUiQuery()) : ""), {
    method, headers: { host: "www.faolla.com", origin: "https://www.faolla.com", "sec-fetch-site": "same-origin", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
test("owner route GET uses validated Auth, private no-store and exact target", async () => {
  let calls = 0;
  const response = await handlePlanPosthoc(request(), { ...base(), execute: async i => { calls++; assert.deepEqual(i.query, posthocUiQuery()); assert.equal(i.authUserId, posthocUiValue().actorId); assert.equal(i.command, null); return posthocUiValue(); } });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("site write switch and module disabled preserve owner read and original POST replay path", async () => {
  for (const mode of ["site", "module"] as const) {
    const deps = { ...base(), ...(mode === "site" ? { siteEnabled: () => false } : { entitlement: async () => entitlement(false) }) };
    let allow = true;
    const r = await handlePlanPosthoc(request(), { ...deps, execute: async i => { allow = i.moduleEnabled!; return posthocUiValue(); } });
    assert.equal(r.status, 200); assert.equal(allow, false); assert.equal((await r.json()).canWrite, false);
    const replay = await handlePlanPosthoc(request("POST", { query: posthocUiQuery(), command: posthocUiCommand() }), { ...deps, execute: async i => { assert.equal(i.moduleEnabled, false); return posthocUiSaved(i.command!); } });
    assert.equal(replay.status, 200);
  }
});
test("origin/auth/rate/method guards run before business RPC; invitation recovery cannot mutate", async () => {
  let calls = 0; const deps = { ...base(), execute: async () => { calls++; return posthocUiValue(); } };
  assert.equal((await handlePlanPosthoc(request("DELETE"), deps)).status, 405);
  assert.equal((await handlePlanPosthoc(request("GET", undefined, { origin: "https://evil.invalid" }), deps)).status, 403);
  assert.equal((await handlePlanPosthoc(request(), { ...deps, allow: () => false })).status, 429);
  assert.equal((await handlePlanPosthoc(request(), { ...deps, authenticate: async () => ({ ...await base().authenticate(), authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal(calls, 0);
});
test("exact command rejects synthetic employee/Auth overrides, duplicates, unknown keys and oversize input", async () => {
  let calls = 0; const deps = { ...base(), execute: async () => { calls++; return posthocUiSaved(); } };
  const query = posthocUiQuery(), command = posthocUiCommand();
  assert.equal((await handlePlanPosthoc(request("POST", { query, command, authUserId: posthocUiId(12) }), deps)).status, 400);
  assert.equal((await handlePlanPosthoc(request("POST", '{"query":{},"query":{},"command":{}}'), deps)).status, 400);
  assert.equal((await handlePlanPosthoc(request("POST", "a".repeat(8193)), deps)).status, 413);
  assert.equal((await handlePlanPosthoc(request("POST", "{}", { "content-type": "text/plain" }), deps)).status, 415);
  assert.equal((await handlePlanPosthoc(request("POST", { query, command: { ...command, eligible: true } }), deps)).status, 400);
  assert.equal(calls, 0);
});
test("wrong owner or target response is rejected without leaking a mismatched tree", async () => {
  const r = await handlePlanPosthoc(request(), { ...base(), execute: async () => ({ ...posthocUiValue(), actorId: posthocUiId(77) }) });
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_plan_posthoc_adoption_invalid" });
});
test("POST exact selected command is passed unchanged and checked against its saved receipt", async () => {
  const command = posthocUiCommand();
  const r = await handlePlanPosthoc(request("POST", { query: posthocUiQuery(), command }), { ...base(), execute: async i => { assert.deepEqual(i.command, command); return posthocUiSaved(command); } });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.receipt.operationId, command.operationId);
});
