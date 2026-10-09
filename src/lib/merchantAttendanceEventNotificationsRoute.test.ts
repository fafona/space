import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleEventNotifications, eventNotificationsDependencies as defaults } from "../app/api/merchant-enterprise/attendance/event-notifications/route-handler";
import { executeEventNotifications, eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";
import { eventNotificationsQueryString } from "./merchantAttendanceEventNotifications";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { eventNotificationsQuery as query, eventNotificationsWire as wire, eventNotificationsId as id, eventNotificationsTime as time } from "../../scripts/fixtures/attendance-event-notifications-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/event-notifications";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${eventNotificationsQueryString(q)}`, { headers });
const post = () => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(true), command: { action: "mark_read", notificationId: id(10) } }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); const r = wire(input.query); if (input.command) r.detail!.readAt = time; r.canMarkRead = input.allowWrite; return r; }, ...patch };
  return { deps, calls }; }
test("capture and read are independent, default off and require exact bounded all-valid site list", () => {
  const env = { FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: "1", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: "98400200" };
  assert.equal(eventNotificationsEnabled("98400200", "capture", env), true); assert.equal(eventNotificationsEnabled("98400200", "read", env), false);
  for (const sites of ["*", "98400200,", "98400201", Array(65).fill("98400200").join(","), "98400200,x"]) assert.equal(eventNotificationsEnabled("98400200", "capture", { ...env, FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: sites }), false);
  assert.equal(eventNotificationsEnabled("98400200", "capture", { ...env, FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: "true" }), false);
  assert.equal(eventNotificationsEnabled("98400200", "capture", { ...env, FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: "98400201, 98400200" }), true);
});
test("read emergency switch blocks GET and POST; module pause still passes only false write authority", async () => {
  const off = setup({ enabled: () => false }); for (const request of [get(), get(query(true)), post()]) assert.equal((await handleEventNotifications(request, off.deps)).status, 404); assert.equal(off.calls.length, 0);
  const paused = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
  const r = await handleEventNotifications(get(), paused.deps); assert.equal(r.status, 200); assert.equal(paused.calls[0].allowWrite, false); assert.equal((await r.json()).canMarkRead, false);
});
test("method/origin/strong Auth/rate guard rejects before RPC and successful GET uses actual Auth", async () => {
  const f = setup(); assert.equal((await handleEventNotifications(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const req of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleEventNotifications(req, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["password", "magiclink"], ["recovery"]]) assert.equal((await handleEventNotifications(get(), { ...f.deps, authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "", authenticationMethods: methods }) })).status, 403);
  assert.equal((await handleEventNotifications(get(), { ...f.deps, allow: () => false })).status, 429); assert.equal(f.calls.length, 0);
  const response = await handleEventNotifications(get(), f.deps); assert.equal(response.status, 200); assert.equal(f.calls[0].authUserId, id(3)); assert.equal(f.calls[0].command, null);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
test("GET is mutation-free, exact body/duplicate URL/duplicate JSON/unknown actor fields rejected", async () => {
  const f = setup(); const payload = JSON.stringify({ query: query(true), command: { action: "mark_read", notificationId: id(10) } });
  for (const req of [new Request(get().url + "&command=%7B%7D", { headers }), new Request(get().url + "&siteId=98400200", { headers }), new Request(get().url + "&actorId=" + id(3), { headers }),
    new Request(url + "?siteId=98400200", post()), new Request(url, { method: "POST", headers, body: payload.replace('"action":', '"action":"bad","action":') }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(), command: { action: "mark_read", notificationId: id(10) } }) }), new Request(url, { method: "POST", headers, body: "{" })]) assert.equal((await handleEventNotifications(req, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("body byte limit, content type, fatal UTF8 and total deadline protect authentication/SQL", async () => {
  const f = setup({ bodyTimeoutMs: 10 }); for (const [req, status] of [[new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "4097" }, body: "{}" }), 413], [new Request(url, { method: "POST", headers, body: " ".repeat(4097) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) }), 400]] as const) assert.equal((await handleEventNotifications(req, f.deps)).status, status);
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });
  assert.equal((await handleEventNotifications(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400); assert.equal(f.calls.length, 0);
});
test("dedicated service has exact four args and validates real Auth plus POST read proof", async () => {
  const input = { query: query(true), command: { action: "mark_read" as const, notificationId: id(10) }, authUserId: id(3), allowWrite: true };
  const r = wire(input.query); r.detail!.readAt = time; const calls: unknown[] = [];
  assert.deepEqual(await executeEventNotifications(input, { rpc: async (name, args) => { calls.push([name, args]); return { data: r, error: null }; } }), r);
  assert.deepEqual(calls, [["faolla_attendance_event_notifications_v1", { p_query: input.query, p_command: input.command, p_auth_user_id: id(3), p_allow_write: true }]]);
  for (const data of [{ ...r, actorId: id(90) }, { ...r, private: true }, wire(input.query)]) await assert.rejects(executeEventNotifications(input, { rpc: async () => ({ data, error: null }) }), { code: "attendance_event_notification_invalid" });
  for (const message of ["constructor", "private db error", "23514"]) await assert.rejects(executeEventNotifications(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
});
test("strict handler response and known error map never disclose arbitrary service errors", async () => {
  const known = await handleEventNotifications(get(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_event_notification_not_found"); } }).deps); assert.equal(known.status, 404);
  for (const error of [Error("private"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("private", 403)]) { const r = await handleEventNotifications(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" }); }
  const tamper = await handleEventNotifications(get(), setup({ execute: async input => ({ ...wire(input.query), actorId: id(99) }) }).deps); assert.equal(tamper.status, 503);
});
