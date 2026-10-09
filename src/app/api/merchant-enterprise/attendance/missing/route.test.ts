import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceMissing, missingDependencies } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import type { MissingResult } from "@/lib/merchantAttendanceMissing";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/missing";
const id = "00000000-0000-4000-8000-000000000001";
const query = { siteId: "99990001", access: "self", requestId: id, fromDate: "2026-10-01", throughDate: "2026-10-07", operationId: null, beforeAt: null, beforeId: null };
const command = { operationId: id, expectedRevision: 1, action: "withdraw", requestId: id, reason: "测试取消" };
const post = (value: unknown = { query, command }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(value) });
const get = () => new Request(url + "?siteId=99990001&access=self&fromDate=2026-10-01&throughDate=2026-10-07");
function fixture(extra: Partial<typeof missingDependencies> = {}) {
  const calls: Parameters<typeof missingDependencies.execute>[0][] = [];
  const deps: typeof missingDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof missingDependencies.entitlement>>,
    execute: async value => { calls.push(value); return {} as MissingResult; }, ...extra };
  return { deps, calls };
}
test("missing gate/method/origin are checked before authentication", async () => {
  let used = false; const { deps } = fixture({ enabled: () => false, authenticate: async () => { used = true; throw Error("unreachable"); } });
  assert.equal((await handleAttendanceMissing(get(), deps)).status, 404); deps.enabled = () => true;
  assert.equal((await handleAttendanceMissing(new Request(url, { method: "DELETE" }), deps)).status, 405);
  assert.equal((await handleAttendanceMissing(new Request(get().url.replace("www.", "merchant.")), deps)).status, 403);
  const badOrigin = post(); badOrigin.headers.set("origin", "https://evil.invalid"); assert.equal((await handleAttendanceMissing(badOrigin, deps)).status, 403); assert.equal(used, false);
});
test("missing full authentication and current platform entitlement are server controlled", async () => {
  for (const methods of [[], ["recovery"], ["invite"], ["password", "magiclink"]]) {
    const { deps, calls } = fixture({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleAttendanceMissing(post(), deps)).status, 403); assert.equal(calls.length, 0);
  }
  const { deps, calls } = fixture(); const response = await handleAttendanceMissing(post(), deps);
  assert.equal(response.status, 200); assert.equal(calls[0].authUserId, id); assert.equal(calls[0].allowWrite, false); assert.equal((await response.json()).moduleEnabled, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("missing self lookup cannot inject another worker or approve; invalid payloads never reach executor", async () => {
  const { deps, calls } = fixture(); assert.equal((await handleAttendanceMissing(get(), deps)).status, 200);
  assert.equal(calls[0].query.requestId, null); assert.equal(calls[0].command, null); calls.length = 0;
  assert.equal((await handleAttendanceMissing(new Request(get().url + "&workerId=" + id), deps)).status, 400);
  for (const value of [{ query: { ...query, access: "owner" }, command }, { query, command, allowWrite: true }, { query, command: { ...command, actor: id } }]) assert.equal((await handleAttendanceMissing(post(value), deps)).status, 400);
  assert.equal((await handleAttendanceMissing(post({ query, command: { ...command, reason: "x".repeat(5000) } }), deps)).status, 413); assert.equal(calls.length, 0);
});
test("missing rate limit/conflict and unexpected database failures have bounded public responses", async () => {
  const limited = fixture({ allow: () => false }); const r = await handleAttendanceMissing(get(), limited.deps); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
  const conflict = fixture({ execute: async () => { throw new MerchantAttendanceError("attendance_missing_conflict"); } }); assert.equal((await handleAttendanceMissing(post(), conflict.deps)).status, 409);
  const failure = fixture({ execute: async () => { throw Error("secret internal relation"); } }); const failed = await handleAttendanceMissing(get(), failure.deps);
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false, error: "attendance_unavailable" });
});
