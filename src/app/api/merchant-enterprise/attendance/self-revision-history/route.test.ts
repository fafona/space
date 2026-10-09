import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleSelfRevisionHistory, selfRevisionHistoryDependencies } from "./route-handler";
import type { SelfRevisionHistoryInput } from "@/lib/merchantAttendanceSelfRevisionHistory.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = `https://www.faolla.com/api/merchant-enterprise/attendance/self-revision-history?siteId=99990001&expectedWorkerId=${id(201)}&status=all`;
function setup(patch: Partial<typeof selfRevisionHistoryDependencies> = {}) {
  const calls: SelfRevisionHistoryInput[] = [];
  const deps: typeof selfRevisionHistoryDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof selfRevisionHistoryDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { protocol: "self-revision-history-v1", readOnly: true, siteId: input.query.siteId, employeeId: id(101), workerId: input.query.expectedWorkerId,
      asOf: "2026-10-03T10:00:00.000000Z", scanned: 0, items: [], nextCursor: null }; }, ...patch };
  return { deps, calls };
}
test("self revision HTTP is default gated, GET only and rejects noncanonical hosts before authentication", async () => {
  const f = setup({ authenticate: async () => { throw Error("unexpected authentication"); } });
  const closed = await handleSelfRevisionHistory(new Request(url), { ...f.deps, enabled: () => false });
  assert.equal(closed.status, 404); assert.equal(closed.headers.get("cache-control"), "private, no-store");
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) assert.equal((await handleSelfRevisionHistory(new Request(url, { method }), f.deps)).status, 405);
  assert.equal((await handleSelfRevisionHistory(new Request(url.replace("www.faolla.com", "foreign.test")), f.deps)).status, 403);
  for (const headers of [new Headers({ origin: "https://foreign.test" }), new Headers({ "sec-fetch-site": "cross-site" })])
    assert.equal((await handleSelfRevisionHistory(new Request(url, { headers }), f.deps)).status, 403);
});
test("self revision HTTP requires completed login and never forwards caller-controlled actor identity", async () => {
  for (const methods of [[], ["password"], ["oauth"], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic-only", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && methods[0] === "password";
    assert.equal((await handleSelfRevisionHistory(new Request(url), f.deps)).status, allowed ? 200 : 403);
    assert.equal(f.calls.length, allowed ? 1 : 0); if (allowed) assert.equal(f.calls[0].authUserId, id(1));
  }
  const f = setup();
  for (const suffix of ["&access=owner", "&authUserId=" + id(99), "&rootRequestId=" + id(501), "&limit=500", "&siteId=99990001", "&cursorId=" + id(601)])
    assert.equal((await handleSelfRevisionHistory(new Request(url + suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("paused attendance still allows a private readonly self history and errors stay sanitized", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof selfRevisionHistoryDependencies.entitlement>> });
  const response = await handleSelfRevisionHistory(new Request(url), f.deps);
  assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  assert.match(response.headers.get("vary")!, /Cookie, Authorization, x-merchant-access-token/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_worker_changed", 409], ["attendance_settings_required", 409], ["attendance_revision_history_invalid", 503], ["private SQL", 503]] as const) {
    const g = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }), reply = await handleSelfRevisionHistory(new Request(url), g.deps);
    assert.equal(reply.status, status); assert.doesNotMatch(await reply.text(), /private SQL/);
  }
});
test("self revision master and existing self workflow switches remain independently default closed", () => {
  const keys = ["SELF_REVISION_HISTORY", "SELF", "CORRECTIONS", "REVISION_REQUESTS", "REVISION_CYCLES"].map(k => `FAOLLA_ATTENDANCE_${k}_ENABLED`);
  const saved = keys.map(k => process.env[k]);
  try {
    keys.forEach(k => process.env[k] = "1"); assert.equal(selfRevisionHistoryDependencies.enabled(), true);
    for (const key of keys) { delete process.env[key]; assert.equal(selfRevisionHistoryDependencies.enabled(), false); process.env[key] = "1"; }
  } finally { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); }
});
test("self revision HTTP enforces enterprise entitlement and rate limiter before SQL execution", async () => {
  const f = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleSelfRevisionHistory(new Request(url), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  const g = setup({ allow: () => false }), reply = await handleSelfRevisionHistory(new Request(url), g.deps);
  assert.equal(reply.status, 429); assert.equal(reply.headers.get("retry-after"), "60"); assert.equal(g.calls.length, 0);
});
