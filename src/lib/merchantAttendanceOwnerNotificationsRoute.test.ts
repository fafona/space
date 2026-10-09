import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOwnerNotifications as handle, ownerNotificationsDependencies as defaults } from "../app/api/merchant-enterprise/attendance/owner-notifications/route-handler";
import { executeOwnerNotifications as execute, ownerNotificationsEnabled as enabled } from "./merchantAttendanceOwnerNotifications.server";
import { ownerNotificationsQueryString as qs } from "./merchantAttendanceOwnerNotifications";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ownerNoticeId as id, ownerNoticeQuery as query, ownerNoticeCommand as command, ownerNoticeWire as wire, ownerNoticeActor as actor } from "../../scripts/fixtures/attendance-owner-notifications-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/owner-notifications";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q = query()) => new Request(`${url}?${qs(q)}`, { headers });
const post = () => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("detail"), command: command() }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return wire(input.query, input.command); }, ...patch }; return { deps, calls }; }
test("capture/read independently default off with unique bounded exact site lists", () => {
  const env = { FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED: "1", FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_SITES: "99990001" };
  assert(enabled("99990001", "capture", env)); assert(!enabled("99990001", "read", env)); assert(!enabled("99990001", "capture", {}));
  for (const sites of ["*", "99990001,", "99990002", "99990001,99990001", "99990001,x", Array(65).fill("99990001").join(",")]) assert(!enabled("99990001", "capture", { ...env, FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_SITES: sites }));
  assert(!enabled("99990001", "capture", { ...env, FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED: "true" }));
});
test("feature/entitlement off blocks regular reads and POST but exact GET recovery avoids both gates", async () => {
  const f = setup({ enabled: () => false, entitlement: async () => { throw Error("do not consult former entitlement for receipt"); } });
  const r = await handle(get(query("recover")), f.deps); assert.equal(r.status, 200); assert.equal(f.calls[0].allowWrite, false);
  const off = setup({ enabled: () => false }); for (const request of [get(), get(query("detail")), post()]) assert.equal((await handle(request, off.deps)).status, 403); assert.equal(off.calls.length, 0);
});
test("canonical same-origin, authenticated identity and rate checks precede execution", async () => {
  const f = setup(); assert.equal((await handle(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handle(request, f.deps)).status, 403);
  for (const methods of [[], ["invite"], ["password", "magiclink"], ["recovery"]]) assert.equal((await handle(get(), { ...f.deps, authenticate: async () => ({ user: { id: actor } as User, accessToken: "", authenticationMethods: methods }) })).status, 403);
  assert.equal((await handle(get(), { ...f.deps, allow: () => false })).status, 429); assert.equal(f.calls.length, 0);
  const r = await handle(get(), f.deps); assert.equal(r.status, 200); assert.equal(f.calls[0].authUserId, actor); assert.equal(f.calls[0].command, null);
  assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});
test("GET cannot mutate; exact URL/body rejects duplicates, actor/recipient overrides and mismatched message", async () => {
  const f = setup(), payload = JSON.stringify({ query: query("detail"), command: command() });
  for (const request of [new Request(get().url + "&actorId=" + actor, { headers }), new Request(get().url + "&siteId=99990001", { headers }), new Request(url + "?siteId=99990001", post()),
    new Request(url, { method: "POST", headers, body: payload.replace('"action":', '"action":"bad","action":') }), new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("recover"), command: command() }) })]) assert.equal((await handle(request, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("bounded body decoding and absolute read deadline fail without reaching SQL", async () => {
  const f = setup({ bodyTimeoutMs: 10 });
  for (const [request, status] of [[new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "4097" }, body: "{}" }), 413], [new Request(url, { method: "POST", headers, body: " ".repeat(4097) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0xff]) }), 400]] as const) assert.equal((await handle(request, f.deps)).status, status);
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });
  assert.equal((await handle(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400); assert.equal(f.calls.length, 0);
});
test("service dispatch is exact; response and command receipts cannot forge actor or include source payload", async () => {
  const input = { query: query("detail"), command: command(), authUserId: actor, allowWrite: true }, value = wire(input.query, input.command); const calls: unknown[] = [];
  assert.deepEqual(await execute(input, { rpc: async (name, args) => { calls.push([name, args]); return { data: value, error: null }; } }), value);
  assert.deepEqual(calls, [["faolla_attendance_owner_notifications_v1", { p_query: input.query, p_auth_user_id: actor, p_command: input.command, p_allow_write: true }]]);
  for (const data of [{ ...value, actorId: id(2) }, { ...value, private: true }, { ...value, receipt: null }]) await assert.rejects(execute(input, { rpc: async () => ({ data, error: null }) }), { code: "attendance_owner_notification_invalid" });
  for (const message of ["constructor", "private SQL detail", "23514"]) await assert.rejects(execute(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  await assert.rejects(execute({ ...input, allowWrite: false }, { rpc: async () => { throw Error("must not reach"); } }), { code: "attendance_owner_notification_disabled" });
});
test("safe errors and strict handler response hide arbitrary internal details", async () => {
  assert.equal((await handle(get(), setup({ execute: async () => { throw new MerchantAttendanceError("attendance_owner_notification_not_found"); } }).deps)).status, 404);
  for (const error of [Error("secret"), new MerchantAttendanceError("constructor")]) { const r = await handle(get(), setup({ execute: async () => { throw error; } }).deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" }); }
  assert.equal((await handle(get(), setup({ execute: async input => ({ ...wire(input.query), actorId: id(99) }) }).deps)).status, 503);
});
