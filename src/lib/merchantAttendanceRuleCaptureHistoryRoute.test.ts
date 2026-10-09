import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleRuleCaptureHistory, ruleCaptureHistoryDependencies } from "../app/api/merchant-enterprise/attendance/rule-capture-history/route-handler";
import { executeRuleCaptureHistory } from "./merchantAttendanceRuleCaptureHistory.server";
import { parseRuleCaptureHistoryResponse, ruleCaptureHistoryQueryString } from "./merchantAttendanceRuleCaptureHistory";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { ruleCaptureHistoryQuery as query, ruleCaptureHistoryResult as result } from "../../scripts/fixtures/attendance-rule-capture-history-model";
import { ruleSourcesId, ruleSourcesOwner as actor } from "../../scripts/fixtures/attendance-rule-sources-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/rule-capture-history";
const get = (suffix = "") => new Request(url + "?" + ruleCaptureHistoryQueryString(query) + suffix);
function setup(patch: Partial<typeof ruleCaptureHistoryDependencies> = {}) {
  const calls: Parameters<typeof ruleCaptureHistoryDependencies.execute>[0][] = [], entitlements: string[] = [], admitted: string[] = [];
  const deps: typeof ruleCaptureHistoryDependencies = {
    enabled: () => true, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }),
    entitlement: async site => { entitlements.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof ruleCaptureHistoryDependencies.entitlement>>; },
    allow: owner => { admitted.push(owner); return true; }, execute: async input => { calls.push(input); return result(); }, ...patch,
  };
  return { calls, entitlements, admitted, deps };
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
}

test("independent history feature is closed unless its exact server flag is one", async t => {
  const before = process.env.FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED;
  t.after(() => { if (before === undefined) delete process.env.FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED; else process.env.FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED = before; });
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const flag of [undefined, "0", "true", " 1"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED; else process.env.FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED = flag;
    const response = await handleRuleCaptureHistory(get(), { ...f.deps, enabled: ruleCaptureHistoryDependencies.enabled });
    assert.equal(response.status, 404); assert.deepEqual(await response.json(), { ok: false, error: "attendance_not_available" }); privateHeaders(response);
  }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
});

test("GET is the only handler/export; unsupported methods are rejected before auth", async () => {
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const method of ["POST", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handleRuleCaptureHistory(new Request(url, { method }), f.deps); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET"); privateHeaders(response);
  }
  const route = readFileSync(new URL("../app/api/merchant-enterprise/attendance/rule-capture-history/route.ts", import.meta.url), "utf8");
  assert.match(route, /export const GET/); assert.doesNotMatch(route, /export const (POST|PUT|PATCH|DELETE)/); assert.equal(auth, 0);
});

test("canonical host/origin and fetch-site guard run before authorization or metadata SQL", async () => {
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  for (const request of [new Request(get().url.replace("www.faolla.com", "merchant.faolla.com")),
    new Request(get(), { headers: { origin: "https://evil.invalid" } }), new Request(get(), { headers: { origin: "null" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } }),
    new Request(get(), { headers: { origin: "https://evil.invalid", "x-forwarded-host": "evil.invalid", "x-forwarded-proto": "https" } })]) {
    const response = await handleRuleCaptureHistory(request, f.deps); assert.equal(response.status, 403); privateHeaders(response);
  }
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
});

test("empty/weak auth, invalid actor and rate limit fail before entitlement or SQL", async () => {
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleRuleCaptureHistory(get(), f.deps)).status, 403); assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
  }
  const f = setup({ allow: owner => { assert.equal(owner, actor); return false; } });
  const response = await handleRuleCaptureHistory(get(), f.deps); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
  const malformed = setup({ authenticate: async () => ({ user: { id: "bad" } as User, accessToken: "synthetic", authenticationMethods: ["password"] }) });
  assert.notEqual((await handleRuleCaptureHistory(get(), malformed.deps)).status, 200); assert.equal(malformed.calls.length, 0);
});

test("paused metadata GET remains owner bound and private without forwarding any write authority", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof ruleCaptureHistoryDependencies.entitlement>> });
  const response = await handleRuleCaptureHistory(get(), f.deps), body = await response.json();
  assert.equal(response.status, 200); privateHeaders(response); assert.deepEqual(f.calls, [{ query, authUserId: actor }]);
  assert.deepEqual(body, { ok: true, moduleEnabled: false, data: result() }); assert.equal(parseRuleCaptureHistoryResponse(body, query, actor).moduleEnabled, false);
});

test("query rejects injection/duplicates/offsets/partial cursors and forwards exact continuation only", async () => {
  const f = setup();
  for (const suffix of ["&siteId=99990002", "&actorId=" + actor, "&limit=25", "&offset=25", "&pageSize=25", "&sourceText={}", "&__proto__=x", "&beforeId=" + ruleSourcesId(8)])
    assert.equal((await handleRuleCaptureHistory(get(suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0); assert.equal(f.entitlements.length, 0);
  const first = result(25, true), continuation = { ...query, ...first.nextCursor! }, empty = { ...result(0), asOf: first.asOf };
  const page = setup({ execute: async input => { assert.deepEqual(input, { query: continuation, authUserId: actor }); return empty; } });
  assert.equal((await handleRuleCaptureHistory(new Request(url + "?" + ruleCaptureHistoryQueryString(continuation)), page.deps)).status, 200);
});

test("known safe SQL/auth error codes preserve status; unknown or inconsistent errors do not leak detail", async () => {
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_rule_capture_identity_changed", 409], ["attendance_rule_capture_history_invalid", 503],
    ["attendance_rule_capture_history_too_large", 422], ["attendance_worker_not_found", 404], ["attendance_settings_required", 409]] as const) {
    const response = await handleRuleCaptureHistory(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); privateHeaders(response);
  }
  for (const error of [Error("private SQL"), new MerchantAttendanceError("secret"), new MerchantEnterpriseAccessError("secret", 403), new MerchantEnterpriseAccessError("authentication_required", 500)]) {
    const response = await handleRuleCaptureHistory(get(), setup({ authenticate: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const required = await handleRuleCaptureHistory(get(), setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } }).deps); assert.equal(required.status, 401);
});

test("handler refuses unchecked injected data and real service integration uses one metadata RPC only", async () => {
  const bad = await handleRuleCaptureHistory(get(), setup({ execute: async () => ({ ...result(), sourceText: "private" }) }).deps);
  assert.equal(bad.status, 503); assert.deepEqual(await bad.json(), { ok: false, error: "attendance_rule_capture_history_invalid" });
  const calls: unknown[] = [], f = setup({ execute: input => executeRuleCaptureHistory(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: result(), error: null }; } }) });
  const response = await handleRuleCaptureHistory(get(), f.deps); assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ name: "faolla_attendance_rule_capture_history_v1", args: { p_query: query, p_auth_user_id: actor } }]);
  assert.deepEqual(await response.json(), { ok: true, moduleEnabled: true, data: result() });
});
