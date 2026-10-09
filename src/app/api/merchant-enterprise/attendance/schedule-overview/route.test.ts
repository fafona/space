import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { handleScheduleOverview, scheduleOverviewDependencies } from "./route-handler";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = `https://www.faolla.com/api/merchant-enterprise/attendance/schedule-overview?siteId=99990001&workerIds=${id(201)},${id(202)}&fromDate=2026-10-01&throughDate=2026-10-31`;
function setup(patch: Partial<typeof scheduleOverviewDependencies> = {}) {
  const calls: Parameters<typeof scheduleOverviewDependencies.execute>[0][] = [];
  const deps: typeof scheduleOverviewDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof scheduleOverviewDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { protocol: "schedule-overview-v1", readOnly: true, siteId: input.query.siteId, ownerId: input.authUserId,
      workerIds: input.query.workerIds, fromDate: input.query.fromDate, throughDate: input.query.throughDate,
      revision: input.query.revision ?? 5, scanned: 0, items: [], nextCursor: null }; }, ...patch };
  return { deps, calls };
}

test("overview and schedule switches independently fail closed; no writer is enabled by the overview flag", t => {
  const keys = ["FAOLLA_ATTENDANCE_SCHEDULE_OVERVIEW_ENABLED", "FAOLLA_ATTENDANCE_SCHEDULE_ENABLED"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }));
  keys.forEach(key => { delete process.env[key]; }); assert.equal(scheduleOverviewDependencies.enabled(), false);
  keys.forEach(key => { process.env[key] = "1"; }); assert.equal(scheduleOverviewDependencies.enabled(), true);
  for (const key of keys) { process.env[key] = "true"; assert.equal(scheduleOverviewDependencies.enabled(), false); process.env[key] = "1"; }
});

test("default-off, GET-only and canonical same-origin guards execute before private authentication", async () => {
  let authenticated = 0; const f = setup({ authenticate: async () => { authenticated++; throw Error("must not authenticate"); } });
  const closed = await handleScheduleOverview(new Request(url), { ...f.deps, enabled: () => false });
  assert.equal(closed.status, 404); assert.equal(closed.headers.get("cache-control"), "private, no-store");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await handleScheduleOverview(new Request(url, { method }), f.deps)).status, 405);
  assert.equal((await handleScheduleOverview(new Request(url.replace("www.faolla.com", "merchant.faolla.com")), f.deps)).status, 403);
  for (const headers of [new Headers({ origin: "https://evil.invalid" }), new Headers({ "sec-fetch-site": "cross-site" })])
    assert.equal((await handleScheduleOverview(new Request(url, { headers }), f.deps)).status, 403);
  assert.equal(authenticated, 0);
});

test("normal password/OAuth sessions may read but invitation/recovery sessions and actor/query injection cannot", async () => {
  for (const methods of [["password"], ["oauth"], [], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    assert.equal((await handleScheduleOverview(new Request(url), f.deps)).status, allowed ? 200 : 403);
    assert.equal(f.calls.length, allowed ? 1 : 0); if (allowed) assert.equal(f.calls[0].authUserId, id(99));
  }
  const f = setup();
  for (const suffix of ["&ownerId=" + id(98), "&authUserId=" + id(98), "&access=self", "&limit=51", "&siteId=99990001", "&cursorId=" + id(500)])
    assert.equal((await handleScheduleOverview(new Request(url + suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("paused admission remains private read-only while current enterprise entitlement is checked on each page", async () => {
  const sites: string[] = []; const f = setup({ entitlement: async site => { sites.push(site);
    return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof scheduleOverviewDependencies.entitlement>>;
  } });
  const response = await handleScheduleOverview(new Request(url), f.deps);
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.moduleEnabled, false); assert.equal(body.readOnly, true);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary")!, /Authorization/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await handleScheduleOverview(new Request(url + `&revision=5&cursorDate=2026-10-03&cursorStart=2026-10-03T07:00:00.000Z&cursorId=${id(500)}`), f.deps)).status, 200);
  assert.deepEqual(sites, ["99990001", "99990001"]);
  assert.deepEqual(Object.keys(f.calls[1]).sort(), ["authUserId", "query"]);
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleScheduleOverview(new Request(url), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});

test("identity-bound limiter, typed denials and sanitized failures never expose SQL internals or retry private reads", async () => {
  const actors: string[] = [], f = setup({ allow: actor => { actors.push(actor); return false; } });
  const limited = await handleScheduleOverview(new Request(url), f.deps);
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60"); assert.deepEqual(actors, [id(99)]); assert.equal(f.calls.length, 0);
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_settings_required", 409], ["private SQL parameters", 503]] as const) {
    const g = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleScheduleOverview(new Request(url), g.deps); assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private SQL parameters/);
  }
  const unexpected = setup({ execute: async () => { throw Error("private database credentials"); } });
  const response = await handleScheduleOverview(new Request(url), unexpected.deps);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
});
