import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { attendanceLocationClockDependencies, handleAttendanceLocationClock } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id = "00000000-0000-4000-8000-000000000001", base = "https://www.faolla.com/api/merchant-enterprise/attendance/location-clock";
const command = { siteId: "99990001", expectedWorkerId: id, operationId: id, action: "clock_in", locationId: id, expectedSequence: 0,
  settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false, position: null, positionFailure: "denied" };
const get = () => new Request(`${base}?${new URLSearchParams({ siteId: command.siteId, expectedWorkerId: id, operationId: id })}`);
const post = (body: unknown = command) => new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json" }, body: JSON.stringify(body) });
function setup(extra: Partial<typeof attendanceLocationClockDependencies> = {}) {
  const calls: Parameters<typeof attendanceLocationClockDependencies.execute>[0][] = [];
  const deps: typeof attendanceLocationClockDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof attendanceLocationClockDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { siteId: input.siteId, employeeId: id, workerId: id, locationId: id, channelEnabled: false, policy: null,
      noticeGate: { ready: false, reason: "unpublished", revision: null }, finish: null, receiptGate: null,
      state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false, locationResult: null }; }, ...extra };
  return { deps, calls };
}
test("atomic location gate is independently closed; canonical and same-origin checks precede auth", async () => {
  let auth = 0; const { deps } = setup({ enabled: () => false, authenticate: async () => { auth++; throw Error("unused"); } });
  assert.equal((await handleAttendanceLocationClock(get(), deps)).status, 404); deps.enabled = () => true;
  for (const req of [new Request(get().url.replace("www.", "merchant.")), new Request(base, { method: "POST", headers: { Origin: "https://foreign.invalid" } })])
    assert.equal((await handleAttendanceLocationClock(req, deps)).status, 403);
  assert.equal((await handleAttendanceLocationClock(new Request(base, { method: "DELETE" }), deps)).status, 405); assert.equal(auth, 0);
});
for (const authenticationMethods of [[], ["oauth"], ["magiclink"], ["password", "recovery"], ["invite"]]) test(`location punch rejects unsafe session ${authenticationMethods}`, async () => {
  const { deps, calls } = setup({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods }) });
  for (const req of [get(), post()]) assert.equal((await handleAttendanceLocationClock(req, deps)).status, 403); assert.equal(calls.length, 0);
});
test("server identity and platform permission are resolved for every read/write, never from body", async () => {
  const { deps, calls } = setup(); let auth = 0, entitlement = 0; const authenticate = deps.authenticate, access = deps.entitlement;
  deps.authenticate = async req => { auth++; return authenticate(req); }; deps.entitlement = async site => { entitlement++; return access(site); };
  for (const req of [get(), post()]) { const res = await handleAttendanceLocationClock(req, deps); assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "private, no-store"); }
  assert.equal(auth, 2); assert.equal(entitlement, 2); assert.ok(calls.every(c => c.authUserId === id && c.moduleEnabled === true));
  assert.equal(calls[1].command?.positionFailure, "denied");
  for (const extra of [{ authUserId: id }, { moduleEnabled: true }, { assertion: { reason: "inside" } }, { occurredAt: "now" }]) assert.equal((await handleAttendanceLocationClock(post({ ...command, ...extra }), deps)).status, 400);
});
test("paused module is passed to atomic decision so replays and closing can be distinguished from new starts", async () => {
  const { deps, calls } = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceLocationClockDependencies.entitlement>> });
  await handleAttendanceLocationClock(post(), deps); assert.equal(calls[0].moduleEnabled, false);
  deps.execute = async () => { throw new MerchantAttendanceError("attendance_platform_paused"); }; assert.equal((await handleAttendanceLocationClock(post(), deps)).status, 403);
});

test("receipt identity denials propagate identically for reads and writes with no partial data or cache", async () => {
  for (const [error, status] of [["attendance_access_denied", 403], ["attendance_worker_changed", 409]] as const) {
    let executions = 0;
    const { deps } = setup({ execute: async () => { executions++; throw new MerchantAttendanceError(error); } });
    for (const request of [get(), post()]) {
      const response = await handleAttendanceLocationClock(request, deps);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(await response.json(), { ok: false, error });
    }
    assert.equal(executions, 2);
  }
});
test("strict size, type, query and failure/position exclusivity precede RPC", async () => {
  const { deps, calls } = setup();
  for (const req of [new Request(get().url + "&position=1"), new Request(`${base}?x=1`, post()), post({ ...command, positionFailure: null }),
    post({ ...command, position: { latitude: 1, longitude: 1, accuracyMeters: 1, capturedAt: "2026-09-30T00:00:00.000Z" } })])
    assert.equal((await handleAttendanceLocationClock(req, deps)).status, 400);
  assert.equal((await handleAttendanceLocationClock(post({ padding: "x".repeat(5000) }), deps)).status, 413);
  assert.equal((await handleAttendanceLocationClock(new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com" }, body: "{}" }), deps)).status, 415);
  assert.equal(calls.length, 0);
});
test("only whitelisted errors are returned; denied enterprise, rate and unknown exceptions do not leak", async () => {
  for (const [override, status] of [[{ allow: () => false }, 429], [{ execute: async () => { throw new MerchantAttendanceError("attendance_location_policy_changed"); } }, 409],
    [{ execute: async () => { throw new MerchantAttendanceError("attendance_location_clock_disabled"); } }, 403],
    [{ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } }, 403],
    [{ execute: async () => { throw new MerchantAttendanceError("constructor"); } }, 503],
    [{ execute: async () => { throw Error("private coordinate data"); } }, 503]] as const) {
    const { deps } = setup(override); const res = await handleAttendanceLocationClock(post(), deps); assert.equal(res.status, status);
    assert.doesNotMatch(await res.text(), /private coordinate|constructor/); if (status === 429) assert.equal(res.headers.get("retry-after"), "60");
  }
});
