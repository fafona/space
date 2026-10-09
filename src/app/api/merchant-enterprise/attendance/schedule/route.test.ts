import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceSchedule, scheduleDependencies } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import type { ScheduleResult } from "@/lib/merchantAttendanceSchedule";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/schedule";
const id = "00000000-0000-4000-8000-000000000001";
const query = { siteId: "99990001", access: "owner", workerId: id, fromDate: "2026-10-01", throughDate: "2026-10-07", operationId: null };
const command = { operationId: id, expectedRevision: 0, expectedSettingsVersion: 1, action: "cancel", slotId: id, reason: "测试取消" };
const post = (value: unknown = { query, command }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(value) });
const get = () => new Request(url + "?siteId=99990001&access=self&fromDate=2026-10-01&throughDate=2026-10-07");
function fixture(extra: Partial<typeof scheduleDependencies> = {}) {
  const calls: Parameters<typeof scheduleDependencies.execute>[0][] = [];
  const deps: typeof scheduleDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof scheduleDependencies.entitlement>>,
    execute: async value => { calls.push(value); return {} as ScheduleResult; }, ...extra };
  return { deps, calls };
}
test("schedule gate/method/origin are checked before authentication", async () => {
  let used = false; const { deps } = fixture({ enabled: () => false, authenticate: async () => { used = true; throw Error("unreachable"); } });
  assert.equal((await handleAttendanceSchedule(get(), deps)).status, 404); deps.enabled = () => true;
  assert.equal((await handleAttendanceSchedule(new Request(url, { method: "DELETE" }), deps)).status, 405);
  assert.equal((await handleAttendanceSchedule(new Request(get().url.replace("www.", "merchant.")), deps)).status, 403);
  const badOrigin = post(); badOrigin.headers.set("origin", "https://evil.invalid"); assert.equal((await handleAttendanceSchedule(badOrigin, deps)).status, 403); assert.equal(used, false);
});
test("schedule full authentication and current platform entitlement are server controlled", async () => {
  for (const methods of [[], ["recovery"], ["invite"], ["password", "magiclink"]]) {
    const { deps, calls } = fixture({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleAttendanceSchedule(post(), deps)).status, 403); assert.equal(calls.length, 0);
  }
  const { deps, calls } = fixture(); const response = await handleAttendanceSchedule(post(), deps);
  assert.equal(response.status, 200); assert.equal(calls[0].authUserId, id); assert.equal(calls[0].allowWrite, false); assert.equal((await response.json()).moduleEnabled, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("schedule self lookup cannot select another worker or mutate; invalid payloads never reach executor", async () => {
  const { deps, calls } = fixture(); assert.equal((await handleAttendanceSchedule(get(), deps)).status, 200);
  assert.equal(calls[0].query.workerId, null); assert.equal(calls[0].command, null); calls.length = 0;
  assert.equal((await handleAttendanceSchedule(new Request(get().url + "&workerId=" + id), deps)).status, 400);
  for (const value of [{ query: { ...query, access: "self" }, command }, { query, command, allowWrite: true }, { query, command: { ...command, actor: id } }]) assert.equal((await handleAttendanceSchedule(post(value), deps)).status, 400);
  assert.equal((await handleAttendanceSchedule(post({ query, command: { ...command, reason: "x".repeat(5000) } }), deps)).status, 413); assert.equal(calls.length, 0);
});
test("schedule rate limit/conflict and unexpected database failures have bounded public responses", async () => {
  const limited = fixture({ allow: () => false }); const r = await handleAttendanceSchedule(get(), limited.deps); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
  const conflict = fixture({ execute: async () => { throw new MerchantAttendanceError("attendance_schedule_overlap"); } }); assert.equal((await handleAttendanceSchedule(post(), conflict.deps)).status, 409);
  const failure = fixture({ execute: async () => { throw Error("secret internal relation"); } }); const failed = await handleAttendanceSchedule(get(), failure.deps);
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false, error: "attendance_unavailable" });
});
