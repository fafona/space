import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { handleLeave, leaveDependencies } from "./route-handler";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/leave";
const query = { siteId: "99990001", access: "self" as const, requestId: null, operationId: null, beforeAt: null, beforeId: null };
const command = { operationId: id(501), action: "submit", reason: "Personal leave", expectedWorkerId: id(201), expectedSettingsVersion: 1,
  timeZone: "Europe/Madrid", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z" };
const get = () => new Request(`${url}?siteId=99990001&access=self`);
const post = (body: unknown = { query, command }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(patch: Partial<typeof leaveDependencies> = {}) {
  const calls: Parameters<typeof leaveDependencies.execute>[0][] = [];
  const deps: typeof leaveDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof leaveDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { protocol: "leave-v1", siteId: input.query.siteId, access: input.query.access, actorId: input.authUserId,
      employeeId: id(101), workerId: id(201), timeZone: "Europe/Madrid", settingsVersion: 1, canSubmit: true, items: [], nextCursor: null, detail: null, receipt: null }; }, ...patch };
  return { deps, calls };
}

test("leave is default-off and rejects other methods or noncanonical/cross-origin requests before authentication", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED; else process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED = previous; });
  delete process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED; assert.equal(leaveDependencies.enabled(), false);
  let authenticated = 0; const f = setup({ enabled: leaveDependencies.enabled, authenticate: async () => { authenticated++; throw Error("unexpected authentication"); } });
  assert.equal((await handleLeave(get(), f.deps)).status, 404);
  process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED = "true"; assert.equal(leaveDependencies.enabled(), false);
  process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED = "1"; assert.equal(leaveDependencies.enabled(), true);
  assert.equal((await handleLeave(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  assert.equal((await handleLeave(new Request(get().url.replace("www.", "merchant.")), f.deps)).status, 403);
  const foreign = post(); foreign.headers.set("origin", "https://evil.invalid");
  assert.equal((await handleLeave(foreign, f.deps)).status, 403); assert.equal(authenticated, 0);
});

test("ordinary password/OAuth methods are accepted but weak invitation/recovery sessions cannot read or submit", async () => {
  for (const methods of [["password"], ["oauth"], [], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const valid = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    for (const request of [get(), post()]) assert.equal((await handleLeave(request, f.deps)).status, valid ? 200 : 403);
    assert.equal(f.calls.length, valid ? 2 : 0);
    if (valid) assert.equal(f.calls[1].authUserId, id(99));
  }
});

test("fresh platform entitlement is server-controlled and paused reads/replays carry allowWrite=false without granting any action", async () => {
  const sites: string[] = []; const f = setup({ entitlement: async site => { sites.push(site);
    return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof leaveDependencies.entitlement>>;
  } });
  const response = await handleLeave(get(), f.deps); assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  await handleLeave(post(), f.deps); assert.deepEqual(f.calls.map(c => c.allowWrite), [false, false]); assert.deepEqual(sites, [query.siteId, query.siteId]);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary")!, /Authorization/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleLeave(post(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});

test("exact query/body authority, role/action, duplicate parameters, JSON content type and body size are checked before execution", async () => {
  const f = setup();
  for (const body of [{ query, command, allowWrite: true }, { query, command, authUserId: id(99) },
    { query: { ...query, access: "owner" }, command }, { query, command: { ...command, actorId: id(99) } },
    { query: { ...query, operationId: id(501) }, command }]) assert.equal((await handleLeave(post(body), f.deps)).status, 400);
  assert.equal((await handleLeave(new Request(get().url + "&access=owner"), f.deps)).status, 400);
  assert.equal((await handleLeave(new Request(get().url + "&employeeId=" + id(101)), f.deps)).status, 400);
  assert.equal((await handleLeave(new Request(url + "?extra=1", post()), f.deps)).status, 400);
  const wrong = post(); wrong.headers.set("content-type", "text/plain"); assert.equal((await handleLeave(wrong, f.deps)).status, 415);
  assert.equal((await handleLeave(post({ query, command, huge: "x".repeat(5000) }), f.deps)).status, 413);
  assert.equal(f.calls.length, 0);
});

test("limiting binds authenticated identity; typed lifecycle conflicts survive but private database errors do not", async () => {
  const actors: string[] = [], f = setup({ allow: actor => { actors.push(actor); return false; } });
  const limited = await handleLeave(post(), f.deps); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(actors, [id(99)]); assert.equal(f.calls.length, 0);
  for (const [code, status] of [["attendance_leave_closed", 409], ["attendance_leave_overlap", 409], ["attendance_platform_paused", 403],
    ["attendance_leave_not_found", 404], ["attendance_leave_invalid", 503]] as const) {
    const rejected = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const r = await handleLeave(post(), rejected.deps); assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: code });
  }
  const broken = setup({ execute: async () => { throw Error("private DB details"); } });
  const r = await handleLeave(get(), broken.deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" });
});

test("bad instants, impossible calendar dates, cursor dates and unknown IANA zones are invalid input, not server unavailability", async () => {
  const f = setup();
  for (const patch of [{ startAt: "not-an-instant" }, { startAt: "2026-02-30T07:00:00.000Z" },
    { endAt: "2026-13-05T15:00:00.000Z" }, { timeZone: "Unknown/Zone" }]) {
    const response = await handleLeave(post({ query, command: { ...command, ...patch } }), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  const cursor = new URL(get().url); cursor.searchParams.set("beforeAt", "2026-02-30T09:00:00.123456Z"); cursor.searchParams.set("beforeId", id(501));
  const response = await handleLeave(new Request(cursor), f.deps);
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  assert.equal(f.calls.length, 0);
});
