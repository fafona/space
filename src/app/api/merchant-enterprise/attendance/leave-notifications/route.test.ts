import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { executeLeaveNotifications } from "@/lib/merchantAttendanceLeaveNotifications.server";
import { NOTIFICATION_ERRORS, notificationQueryString, type NotificationCommand, type NotificationDetail,
  type NotificationQuery, type NotificationsResult } from "@/lib/merchantAttendanceLeaveNotifications";
import { handleLeaveNotifications, leaveNotificationsDependencies } from "./route-handler";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/leave-notifications";
const siteId = "99990001", actorId = id(99), employeeId = id(101), workerId = id(201);
const query: NotificationQuery = { siteId, expectedEmployeeId: employeeId, expectedWorkerId: null,
  notificationId: null, beforeAt: null, beforeId: null };
const selected: NotificationQuery = { ...query, expectedWorkerId: workerId, notificationId: id(501) };
const command: NotificationCommand = { action: "mark_read", notificationId: id(501) };
const detail = (): NotificationDetail => ({ notificationId: id(501), requestId: id(401), revision: 2, type: "approved",
  decidedAt: "2026-10-04T09:00:00.123456Z", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z",
  timeZone: "Europe/Madrid", readAt: "2026-10-04T10:00:00.000001Z", currentStatus: "approved", currentRevision: 2 });
const result = (): NotificationsResult => ({ protocol: "leave-notifications-v1", siteId, actorId, employeeId, workerId,
  items: [], nextCursor: null, detail: null });
const get = (value = query) => new Request(`${url}?${notificationQueryString(value)}`);
const post = (body: unknown = { query: selected, command }) => new Request(url, { method: "POST",
  headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(patch: Partial<typeof leaveNotificationsDependencies> = {}) {
  const calls: Parameters<typeof leaveNotificationsDependencies.execute>[0][] = [];
  const deps: typeof leaveNotificationsDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: actorId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof leaveNotificationsDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { ...result(), detail: input.query.notificationId ? detail() : null }; }, ...patch };
  return { deps, calls };
}

test("notification API is default-off independently of the public flag and rejects unsupported or cross-origin requests before auth", async t => {
  const names = ["FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED", "NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED"] as const;
  const previous = names.map(name => process.env[name]);
  t.after(() => { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); });
  delete process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;
  process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = "1";
  assert.equal(leaveNotificationsDependencies.enabled(), false);
  let authenticated = 0;
  const f = setup({ enabled: leaveNotificationsDependencies.enabled, authenticate: async () => { authenticated++; throw Error("unexpected auth"); } });
  for (const request of [get(), post()]) {
    const response = await handleLeaveNotifications(request, f.deps); assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_not_available" });
  }
  process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = "true"; assert.equal(leaveNotificationsDependencies.enabled(), false);
  process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = "1"; assert.equal(leaveNotificationsDependencies.enabled(), true);
  for (const method of ["DELETE", "PUT", "PATCH"]) assert.equal((await handleLeaveNotifications(new Request(url, { method }), f.deps)).status, 405);
  assert.equal((await handleLeaveNotifications(new Request(get().url.replace("www.", "merchant.")), f.deps)).status, 403);
  const foreign = post(); foreign.headers.set("origin", "https://evil.invalid");
  assert.equal((await handleLeaveNotifications(foreign, f.deps)).status, 403); assert.equal(authenticated, 0);
});

test("ordinary auth methods pass real auth ID separately from employee ID; weak invitation/recovery sessions cannot read or mark", async () => {
  for (const methods of [["password"], ["oauth"], [], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: actorId } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    for (const request of [get(), post()]) assert.equal((await handleLeaveNotifications(request, f.deps)).status, allowed ? 200 : 403);
    assert.equal(f.calls.length, allowed ? 2 : 0);
    if (allowed) for (const call of f.calls) { assert.equal(call.authUserId, actorId); assert.equal(call.query.expectedEmployeeId, employeeId); }
  }
});

test("platform pause leaves GET and idempotent POST verification available with server-only allowWrite=false and private no-store", async () => {
  const sites: string[] = [], f = setup({ entitlement: async site => { sites.push(site);
    return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof leaveNotificationsDependencies.entitlement>>;
  } });
  for (const request of [get(), post()]) {
    const response = await handleLeaveNotifications(request, f.deps); assert.equal(response.status, 200);
    assert.equal((await response.json()).moduleEnabled, false); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("vary")!, /Authorization/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  assert.deepEqual(sites, [siteId, siteId]); assert.deepEqual(f.calls.map(call => call.allowWrite), [false, false]);
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleLeaveNotifications(post(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});

test("exact query/body, matching notification identity, worker pin and duplicated parameters are rejected before execution", async () => {
  const f = setup();
  for (const body of [{ query: selected, command, allowWrite: true }, { query: selected, command, authUserId: actorId },
    { query: selected, command: { ...command, operationId: id(601) } }, { query: selected, command: { ...command, action: "mark_all_read" } },
    { query, command }, { query: { ...selected, notificationId: id(502) }, command },
    { query: { ...selected, expectedWorkerId: null }, command }, { query: { ...selected, employeeId }, command },
    { query: { ...selected, beforeAt: "2026-10-04T09:00:00.123456Z", beforeId: id(501) }, command }])
    assert.equal((await handleLeaveNotifications(post(body), f.deps)).status, 400, JSON.stringify(body));
  for (const suffix of [`&expectedEmployeeId=${employeeId}`, `&actorId=${actorId}`, `&employeeId=${employeeId}`, "&unread=true"])
    assert.equal((await handleLeaveNotifications(new Request(get().url + suffix), f.deps)).status, 400);
  assert.equal((await handleLeaveNotifications(new Request(url + "?extra=1", post()), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("request JSON limits, unsupported media and invalid calendar cursor dates report typed input failures", async () => {
  const f = setup();
  const wrong = post(); wrong.headers.set("content-type", "text/plain"); assert.equal((await handleLeaveNotifications(wrong, f.deps)).status, 415);
  const declared = post(); declared.headers.set("content-length", "4097"); assert.equal((await handleLeaveNotifications(declared, f.deps)).status, 413);
  assert.equal((await handleLeaveNotifications(post({ query: selected, command, huge: "x".repeat(5000) }), f.deps)).status, 413);
  const malformed = new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: "{" });
  assert.equal((await handleLeaveNotifications(malformed, f.deps)).status, 400);
  for (const instant of ["2026-02-30T09:00:00.123456Z", "2026-10-04T09:00:00.123Z", "not-a-time"]) {
    const request = new URL(get().url); request.searchParams.set("expectedWorkerId", workerId);
    request.searchParams.set("beforeAt", instant); request.searchParams.set("beforeId", id(501));
    const response = await handleLeaveNotifications(new Request(request), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  assert.equal(f.calls.length, 0);
});

test("limiter binds authenticated actor and every notification error preserves status without exposing database details", async () => {
  const actors: string[] = [], f = setup({ allow: actor => { actors.push(actor); return false; } });
  const limited = await handleLeaveNotifications(post(), f.deps); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(actors, [actorId]); assert.equal(f.calls.length, 0);
  for (const [code, status] of Object.entries(NOTIFICATION_ERRORS)) {
    const rejected = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleLeaveNotifications(post(), rejected.deps); assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  for (const failure of [Error("private SQL details"), new MerchantAttendanceError("attendance_leave_invalid")]) {
    const broken = setup({ execute: async () => { throw failure; } });
    const response = await handleLeaveNotifications(get(), broken.deps); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
});

test("service executor uses only the notification RPC and validates Auth, employee, worker and exact returned DTOs", async () => {
  const input = { query, command: null, authUserId: actorId, allowWrite: false };
  assert.deepEqual(await executeLeaveNotifications(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_leave_notifications_v1");
    assert.deepEqual(args, { p_query: query, p_auth_user_id: actorId, p_command: null, p_allow_write: false });
    return { data: result(), error: null };
  } }), result());
  for (const patch of [{ actorId: employeeId }, { employeeId: actorId }, { siteId: "99990002" }, { privateData: "not allowed" }])
    await assert.rejects(executeLeaveNotifications(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeLeaveNotifications({ ...input, query: selected },
    { rpc: async () => ({ data: { ...result(), workerId: id(202), detail: detail() }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeLeaveNotifications({ ...input, query: selected, command },
    { rpc: async () => ({ data: { ...result(), detail: { ...detail(), readAt: null } }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeLeaveNotifications(input, null), /attendance_unavailable/);
  for (const code of [...Object.keys(NOTIFICATION_ERRORS), "attendance_leave_invalid", "private SQL detail"])
    await assert.rejects(executeLeaveNotifications(input, { rpc: async () => ({ data: null, error: { message: code } }) }),
      new RegExp(Object.hasOwn(NOTIFICATION_ERRORS, code) ? code : "attendance_unavailable"));
  await assert.rejects(executeLeaveNotifications(input, { rpc: async () => { throw Error("private connection details"); } }), /attendance_unavailable/);
});

test("mark-read executor passes source identity unchanged and validates the first-read timestamp even in paused replay", async () => {
  const input = { query: selected, command, authUserId: actorId, allowWrite: false }, expected = { ...result(), detail: detail() };
  let calls = 0;
  const service = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls++; assert.equal(name, "faolla_attendance_leave_notifications_v1");
    assert.deepEqual(args, { p_query: selected, p_auth_user_id: actorId, p_command: command, p_allow_write: false });
    return { data: expected, error: null };
  } };
  assert.deepEqual(await executeLeaveNotifications(input, service), expected);
  assert.deepEqual(await executeLeaveNotifications(input, service), expected); assert.equal(calls, 2);
  // This boundary test does not claim DB idempotence; the native SQL suite proves immutable first-read storage.
});
