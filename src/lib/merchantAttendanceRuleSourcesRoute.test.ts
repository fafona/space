import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleRuleSources, ruleSourcesDependencies } from "../app/api/merchant-enterprise/attendance/rule-sources/route-handler";
import { executeRuleSources } from "./merchantAttendanceRuleSources.server";
import { parseRuleSourcesResponse } from "./merchantAttendanceRuleSources";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(99), query = { siteId: "99990001", workerId: id(201), fromDate: "2026-10-05", throughDate: "2026-10-05" };
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/rule-sources";
const result = () => ({ protocol: "rule-sources-v1", siteId: query.siteId, actorId: owner, fromDate: query.fromDate, throughDate: query.throughDate,
  worker: { workerId: query.workerId, workerName: "合成人员", workerNo: "SYNTHETIC", employeeId: id(101), employeeAuthUserId: id(1), version: 1, active: true, employeeActive: true },
  settingsVersion: 1, timeZone: "UTC", fromAt: "2026-10-05T00:00:00.000Z", toAt: "2026-10-06T00:00:00.000Z", readAt: "2026-10-04T10:00:00.000000Z",
  assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] }, personal: { revision: 0, limited: false, items: [] } });
const get = (suffix = "") => new Request(url + "?" + new URLSearchParams(query) + suffix);
function setup(patch: Partial<typeof ruleSourcesDependencies> = {}) {
  const calls: Parameters<typeof ruleSourcesDependencies.execute>[0][] = [];
  const deps: typeof ruleSourcesDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof ruleSourcesDependencies.entitlement>>,
    execute: async input => { calls.push(input); return result(); }, ...patch };
  return { calls, deps };
}

test("rule-source endpoint defaults closed and exposes no write method or alternate origin", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED; else process.env.FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED = old; });
  delete process.env.FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED;
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected authentication"); } });
  assert.equal((await handleRuleSources(get(), { ...f.deps, enabled: ruleSourcesDependencies.enabled })).status, 404);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal((await handleRuleSources(new Request(url, { method }), f.deps)).status, 405);
  for (const request of [new Request(get().url.replace("www.", "merchant.")), new Request(get(), { headers: { origin: "https://evil.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } })]) {
    assert.equal((await handleRuleSources(request, f.deps)).status, 403);
  }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
});
test("rule-source reads require strong authenticated identity and apply bounded per-actor admission", async () => {
  for (const methods of [[], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleRuleSources(get(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  const f = setup({ allow: actor => { assert.equal(actor, owner); return false; } });
  const response = await handleRuleSources(get(), f.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});
test("paused rule-source read stays owner-bound and no-store without receiving any write authority", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof ruleSourcesDependencies.entitlement>> });
  const response = await handleRuleSources(get(), f.deps), body = await response.json();
  assert.deepEqual(f.calls, [{ query, authUserId: owner }]); assert.deepEqual(body, { ok: true, moduleEnabled: false, data: result() });
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("vary") ?? "", /Authorization/);
  assert.equal(parseRuleSourcesResponse(body, query, owner).moduleEnabled, false);
});
test("duplicate query, forged actor, oversized date range or pagination is rejected before SQL", async () => {
  const f = setup();
  for (const request of [get("&siteId=99990002"), get("&authUserId=" + owner), get("&beforeRevision=1"),
    new Request(url + "?" + new URLSearchParams({ ...query, throughDate: "2026-10-12" })),
    new Request(url + "?" + new URLSearchParams({ ...query, workerId: "not-an-id" }))]) {
    assert.equal((await handleRuleSources(request, f.deps)).status, 400);
  }
  assert.equal(f.calls.length, 0);
});
test("read failures redact private details and preserve identity/limit/auth status without data", async () => {
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_personal_rule_identity_changed", 409],
    ["attendance_rule_sources_invalid", 503], ["attendance_rule_sources_too_large", 422]] as const) {
    const response = await handleRuleSources(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  const f = setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } });
  assert.equal((await handleRuleSources(get(), f.deps)).status, 401); assert.equal(f.calls.length, 0);
  assert.deepEqual(await (await handleRuleSources(get(), setup({ execute: async () => { throw Error("private SQL details"); } }).deps)).json(), { ok: false, error: "attendance_unavailable" });
});
test("service makes exactly one dedicated read RPC and validates raw response before returning it", async () => {
  const input = { query, authUserId: owner }; let calls = 0;
  assert.deepEqual(await executeRuleSources(input, { rpc: async (name, args) => {
    calls++; assert.equal(name, "faolla_attendance_rule_sources_v1"); assert.deepEqual(args, { p_query: query, p_auth_user_id: owner });
    return { data: result(), error: null };
  } }), result()); assert.equal(calls, 1);
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { worker: { ...result().worker, workerId: id(202) } },
    { extra: true }, { personal: undefined }, { personal: { revision: 0, limited: true, items: [{ approval: {} }] } }]) {
    await assert.rejects(executeRuleSources(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_rule_sources_invalid/);
  }
  for (const service of [null, { rpc: async () => { throw Error("secret"); } }, { rpc: async () => ({ data: null, error: { message: "private detail" } }) }]) {
    await assert.rejects(executeRuleSources(input, service), /attendance_unavailable/);
  }
  await assert.rejects(executeRuleSources(input, { rpc: async () => ({ data: null, error: { message: "attendance_personal_rule_identity_changed" } }) }), /attendance_personal_rule_identity_changed/);
});
