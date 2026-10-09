import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handlePersonalRules, personalRulesDependencies } from "../app/api/merchant-enterprise/attendance/personal-rules/route-handler";
import { executePersonalRules } from "./merchantAttendancePersonalRules.server";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import type { PersonalRulesResult } from "./merchantAttendancePersonalRules";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(99), query = { siteId: "99990001", workerId: id(201), operationId: null, beforeRevision: null };
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/personal-rules";
const result = (): PersonalRulesResult => ({ protocol: "personal-rules-v1", siteId: query.siteId, actorId: owner,
  worker: { workerId: query.workerId, workerName: "合成人员", workerNo: "SYNTHETIC", employeeId: id(101), employeeAuthUserId: id(1), version: 1, active: true, employeeActive: true },
  settingsVersion: 1, timeZone: "UTC", revision: 0, items: [], nextBeforeRevision: null, receipt: null, readAt: "2026-10-04T00:00:00.000000Z" });
const approve = () => ({ operationId: id(9001), action: "approve", expectedRevision: 0, reason: "合成核准",
  expectedWorkerVersion: 1, expectedSettingsVersion: 1, employeeId: id(101), employeeAuthUserId: id(1),
  timeZone: "UTC", startsOn: "2026-10-10", endsOn: "2026-10-11", rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 0 } } });
const get = () => new Request(`${url}?siteId=${query.siteId}&workerId=${query.workerId}`);
const post = (body: unknown = { query, command: approve() }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(patch: Partial<typeof personalRulesDependencies> = {}) {
  const calls: Parameters<typeof personalRulesDependencies.execute>[0][] = [];
  const deps: typeof personalRulesDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof personalRulesDependencies.entitlement>>,
    // Route-boundary only; receipt/SQL success is verified by the native suite.
    execute: async input => { calls.push(input); return result(); }, ...patch };
  return { calls, deps };
}

test("personal rule endpoint defaults closed, validates origin/method before auth", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED; else process.env.FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED = old; });
  delete process.env.FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED;
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  assert.equal((await handlePersonalRules(get(), { ...f.deps, enabled: personalRulesDependencies.enabled })).status, 404);
  for (const r of [new Request(url, { method: "DELETE" }), new Request(url.replace("www.", "merchant.")), new Request(url, { method: "POST", headers: { origin: "https://evil.invalid" } })]) {
    assert([403, 405].includes((await handlePersonalRules(r, f.deps)).status));
  }
  assert.equal(auth, 0);
});
test("unverified sessions cannot use personal exception authority; authenticated rate limit applies", async () => {
  for (const methods of [[], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handlePersonalRules(post(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  const f = setup({ allow: actor => { assert.equal(actor, owner); return false; } });
  const r = await handlePersonalRules(get(), f.deps);
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});
test("pause is server-owned and passed to RPC, preserving authenticated recovery path and no-store", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof personalRulesDependencies.entitlement>> });
  const r = await handlePersonalRules(get(), f.deps); await handlePersonalRules(post(), f.deps);
  assert.deepEqual(f.calls.map(c => [c.authUserId, c.allowWrite]), [[owner, false], [owner, false]]);
  assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await r.json()).moduleEnabled, false);
});
test("untrusted authority, duplicate keys, POST query, media type and oversized bodies rejected before RPC", async () => {
  const f = setup();
  for (const body of [{ query, command: approve(), allowWrite: true }, { query, command: { ...approve(), actorId: owner } },
    { query: { ...query, operationId: id(9001) }, command: approve() }, { query, command: { ...approve(), endsOn: "2026-12-01" } }]) {
    assert.equal((await handlePersonalRules(post(body), f.deps)).status, 400);
  }
  assert.equal((await handlePersonalRules(new Request(get().url + "&siteId=99990002"), f.deps)).status, 400);
  assert.equal((await handlePersonalRules(new Request(url + "?extra=1", post()), f.deps)).status, 400);
  const wrong = post(); wrong.headers.set("content-type", "text/plain");
  assert.equal((await handlePersonalRules(wrong, f.deps)).status, 415);
  assert.equal((await handlePersonalRules(post({ huge: "x".repeat(5000) }), f.deps)).status, 413); assert.equal(f.calls.length, 0);
});
test("known conflict/identity failures keep status, auth failures propagate, private failures redact", async () => {
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_personal_rule_overlap", 409],
    ["attendance_personal_rule_future_required", 409], ["attendance_personal_rule_identity_changed", 409],
    ["attendance_personal_rule_already_withdrawn", 409], ["attendance_personal_rule_invalid", 503]] as const) {
    const r = await handlePersonalRules(post(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps);
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: code });
  }
  const f = setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } });
  assert.equal((await handlePersonalRules(get(), f.deps)).status, 401); assert.equal(f.calls.length, 0);
  assert.deepEqual(await (await handlePersonalRules(get(), setup({ execute: async () => { throw Error("private SQL detail"); } }).deps)).json(), { ok: false, error: "attendance_unavailable" });
});
test("service binds exact dedicated RPC and current actor, rejects unrelated or invalid response", async () => {
  const input = { query, command: null, authUserId: owner, allowWrite: false };
  assert.deepEqual(await executePersonalRules(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_personal_rules_v1");
    assert.deepEqual(args, { p_query: query, p_auth_user_id: owner, p_command: null, p_allow_write: false });
    return { data: result(), error: null };
  } }), result());
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { worker: { ...result().worker, workerId: id(202) } }, { extra: true }, { revision: 1 }]) {
    await assert.rejects(executePersonalRules(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_unavailable/);
  }
  for (const service of [null, { rpc: async () => { throw Error("secret"); } }, { rpc: async () => ({ data: null, error: { message: "private SQL detail" } }) }]) {
    await assert.rejects(executePersonalRules(input, service), /attendance_unavailable/);
  }
});
