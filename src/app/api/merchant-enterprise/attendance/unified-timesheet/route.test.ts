import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleUnifiedTimesheet as handle, unifiedTimesheetDependencies as defaults } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { parseUnifiedSource, unifiedQueryString, type UnifiedQuery } from "@/lib/merchantAttendanceUnifiedTimesheet";
import { firstApprovalSourceV2, sheetWire, timesheetQuery, timesheetOwner } from "../../../../../../scripts/fixtures/attendance-timesheet-model";
import { scopedSelfQuery, scopedManagerQuery, scopedSheetWire } from "../../../../../../scripts/fixtures/attendance-scoped-timesheet-model";
const owner: UnifiedQuery = { ...timesheetQuery, access: "owner" }, queries = [owner, scopedSelfQuery, scopedManagerQuery];
const url = (query: UnifiedQuery = owner) => `https://www.faolla.com/api/merchant-enterprise/attendance/unified-timesheet?${unifiedQueryString(query)}`;
function setup(extra: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = {
    enabled: () => true, accessEnabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: timesheetOwner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => {
      calls.push(input);
      const base = input.query.access === "owner" ? firstApprovalSourceV2(sheetWire()) : firstApprovalSourceV2(scopedSheetWire(input.query.access));
      return parseUnifiedSource({ version: "attendance-unified-v1", access: input.query.access, base, missing: [], complete: true, payrollReady: false }, input.query);
    }, ...extra,
  };
  return { deps, calls };
}

test("unified route is independently default-off, GET-only and canonical same-origin before authentication", async () => {
  let authenticated = false;
  const { deps } = setup({ enabled: () => false, authenticate: async () => { authenticated = true; throw Error("should not authenticate"); } });
  assert.equal((await handle(new Request(url()), deps)).status, 404);
  deps.enabled = () => true; deps.accessEnabled = () => false;
  for (const q of queries) assert.equal((await handle(new Request(url(q)), deps)).status, 404);
  deps.accessEnabled = () => true;
  for (const method of ["POST", "PATCH", "DELETE"]) assert.equal((await handle(new Request(url(), { method }), deps)).status, 405);
  for (const req of [new Request(url().replace("www.", "merchant.")), new Request(url(), { headers: { origin: "https://foreign.invalid" } }), new Request(url(), { headers: { "sec-fetch-site": "cross-site" } })]) assert.equal((await handle(req, deps)).status, 403);
  assert.equal(authenticated, false);
});

test("all combined report scopes require full password authentication, not invitation/recovery/OAuth", async () => {
  for (const q of queries) for (const authenticationMethods of [[], ["oauth"], ["invite"], ["magiclink"], ["recovery"], ["password", "recovery"]]) {
    const { deps, calls } = setup({ authenticate: async () => ({ user: { id: timesheetOwner } as User, accessToken: "synthetic", authenticationMethods }) });
    assert.equal((await handle(new Request(url(q)), deps)).status, 403); assert.equal(calls.length, 0);
  }
});

test("combined report sends only server identity and validated scope; paused history is read-only and never cached", async () => {
  for (const q of queries) {
    const { deps, calls } = setup(), r = await handle(new Request(url(q)), deps);
    assert.equal(r.status, 200); assert.deepEqual(calls, [{ query: q, authUserId: timesheetOwner }]);
    assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.match(r.headers.get("vary")!, /Cookie.*Authorization/);
    const body = await r.json(); assert.equal(body.version, "attendance-unified-v1"); assert.equal(body.moduleEnabled, false); assert.equal(body.payrollReady, false);
    if (q.access !== "owner") assert.equal(Object.hasOwn(body.base, "employeeId"), false);
  }
});

test("combined route rejects identity injection, duplicate access, missing scoped pair and overlong date span", async () => {
  const { deps, calls } = setup();
  for (const request of [url() + "&authUserId=" + timesheetOwner, url() + "&access=self", url() + "&expectedWorkerId=" + owner.workerId,
    url(scopedManagerQuery).replace(/&locationId=[^&]+/, ""), url().replace("2026-09-30", "2026-10-02")]) assert.equal((await handle(new Request(request), deps)).status, 400);
  assert.equal(calls.length, 0);
});

test("combined route maps reconciliation, revocation and limits without private SQL or a misleading successful total", async () => {
  const revoked = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handle(new Request(url()), revoked.deps)).status, 403); assert.equal(revoked.calls.length, 0);
  for (const [code, status] of [["attendance_report_reconciliation_required", 422], ["attendance_report_too_large", 422], ["attendance_worker_changed", 409], ["attendance_access_denied", 403]] as const) {
    const r = await handle(new Request(url()), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps);
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: code }); assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
  const rate = setup({ allow: () => false }), r = await handle(new Request(url()), rate.deps);
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60"); assert.equal(rate.calls.length, 0);
  const failure = await handle(new Request(url()), setup({ execute: async () => { throw Error("private SQL fixture"); } }).deps);
  assert.equal(failure.status, 503); assert.deepEqual(await failure.json(), { ok: false, error: "attendance_unavailable" });
});

test("unified feature and existing owner/self/manager switches are required independently", () => {
  const keys = ["FAOLLA_ATTENDANCE_UNIFIED_REPORT_ENABLED", "FAOLLA_ATTENDANCE_TIMESHEET_ENABLED", "FAOLLA_ATTENDANCE_ADMIN_ENABLED", "FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED", "FAOLLA_ATTENDANCE_SELF_ENABLED", "FAOLLA_ATTENDANCE_RECORDS_ENABLED"], saved = keys.map(k => process.env[k]);
  try {
    keys.forEach(k => process.env[k] = "1"); assert(defaults.enabled());
    for (const q of queries) assert(defaults.accessEnabled(q.access));
    for (let i = 0; i < keys.length; i++) {
      delete process.env[keys[i]];
      if (i < 2) assert.equal(defaults.enabled(), false);
      else for (const q of queries) assert.equal(defaults.accessEnabled(q.access), !(i === 2 && q.access === "owner" || i === 3 && q.access !== "owner" || i === 4 && q.access === "self" || i === 5 && q.access === "manager"));
      process.env[keys[i]] = "1";
    }
  } finally { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); }
});
