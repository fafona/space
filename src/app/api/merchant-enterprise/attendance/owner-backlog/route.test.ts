import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOwnerBacklog, ownerBacklogDependencies } from "./route-handler";
import type { OwnerBacklogInput } from "@/lib/merchantAttendanceOwnerBacklog.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/owner-backlog?siteId=99990001&kind=all";
function setup(patch: Partial<typeof ownerBacklogDependencies> = {}) {
  const calls: OwnerBacklogInput[] = [];
  const deps: typeof ownerBacklogDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof ownerBacklogDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { protocol: "owner-backlog-v1", readOnly: true, siteId: input.query.siteId, ownerId: input.authUserId,
      asOf: "2026-10-03T10:00:00.000000Z", scanned: 0, items: [], nextCursor: null }; }, ...patch };
  return { deps, calls };
}
test("owner backlog is default closed, GET only and same-origin canonical before auth", async () => {
  const f = setup({ authenticate: async () => { throw Error("unexpected authentication"); } });
  const closed = await handleOwnerBacklog(new Request(url), { ...f.deps, enabled: () => false });
  assert.equal(closed.status, 404); assert.equal(closed.headers.get("cache-control"), "private, no-store");
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) assert.equal((await handleOwnerBacklog(new Request(url, { method }), f.deps)).status, 405);
  assert.equal((await handleOwnerBacklog(new Request(url.replace("www.faolla.com", "foreign.test")), f.deps)).status, 403);
  for (const headers of [new Headers({ origin: "https://foreign.test" }), new Headers({ "sec-fetch-site": "cross-site" })])
    assert.equal((await handleOwnerBacklog(new Request(url, { headers }), f.deps)).status, 403);
});
test("owner backlog accepts normal owner login methods, rejects recovery and never trusts query actor", async () => {
  for (const methods of [[], ["password"], ["oauth"], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic-only", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    assert.equal((await handleOwnerBacklog(new Request(url), f.deps)).status, allowed ? 200 : 403);
    assert.equal(f.calls.length, allowed ? 1 : 0); if (allowed) assert.equal(f.calls[0].authUserId, id(99));
  }
  const f = setup();
  for (const suffix of ["&access=self", "&authUserId=" + id(1), "&ownerId=" + id(1), "&limit=500", "&siteId=99990001", "&cursorKind=missing", "&status=submitted"])
    assert.equal((await handleOwnerBacklog(new Request(url + suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("paused backlog remains private readonly and current-owner denial propagates without details", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof ownerBacklogDependencies.entitlement>> });
  const response = await handleOwnerBacklog(new Request(url), f.deps);
  assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  assert.match(response.headers.get("vary")!, /Cookie, Authorization, x-merchant-access-token/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_settings_required", 409], ["attendance_owner_backlog_invalid", 503], ["private SQL", 503]] as const) {
    const g = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }), reply = await handleOwnerBacklog(new Request(url), g.deps);
    assert.equal(reply.status, status); assert.doesNotMatch(await reply.text(), /private SQL/);
  }
});
test("owner backlog and admin switches both independently fail closed without enabling existing writers", () => {
  const keys = ["FAOLLA_ATTENDANCE_OWNER_BACKLOG_ENABLED", "FAOLLA_ATTENDANCE_ADMIN_ENABLED"], saved = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => process.env[key] = "1"); assert.equal(ownerBacklogDependencies.enabled(), true);
    for (const key of keys) { delete process.env[key]; assert.equal(ownerBacklogDependencies.enabled(), false); process.env[key] = "1"; }
  } finally { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
});
test("owner backlog checks enterprise entitlement and limiter before querying private SQL", async () => {
  const f = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleOwnerBacklog(new Request(url), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  const g = setup({ allow: () => false }), reply = await handleOwnerBacklog(new Request(url), g.deps);
  assert.equal(reply.status, 429); assert.equal(reply.headers.get("retry-after"), "60"); assert.equal(g.calls.length, 0);
});
