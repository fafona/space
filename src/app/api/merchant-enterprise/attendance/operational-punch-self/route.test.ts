// 242 synthetic HTTP tests; no database, real account, terminal, QR or GPS.
import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleOperationalPunchSelf, type OperationalPunchRouteDependencies } from "./route-handler";
import { handleOperationalPunchLocation } from "../operational-punch-location/route-handler";
import { handleOperationalPunchPin } from "../operational-punch-pin/route-handler";
import { handleOperationalPunchOnsite } from "../operational-punch-onsite/route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { TERMINAL_COOKIE } from "@/lib/merchantAttendanceTerminal";
import type { OperationalPunchServiceInput } from "@/lib/merchantAttendanceOperationalPunch.server";
import { punchFixture, punchId as id, punchSite as siteId } from "@/lib/merchantAttendanceOperationalPunchTestFixtures";

const origin = "https://www.faolla.com", base = `${origin}/api/merchant-enterprise/attendance/operational-punch-`;
const query = { mode: "recover" as const, operationId: id(20) }, command = { clock: { expectedWorkerId: id(1), operationId: id(20), locationId: id(4), action: "clock_out" as const, expectedSequence: 1 }, choice: { kind: "finish" as const } };
const body = { siteId, query, command }, secret = "A".repeat(43), cookie = `${TERMINAL_COOKIE}=${siteId}.${id(9)}.${secret}`;
function post(channel: string, value: unknown = body, headers: Record<string, string> = {}) {
  return new Request(base + channel, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}
async function setup(overrides: Partial<OperationalPunchRouteDependencies> = {}) {
  const calls: OperationalPunchServiceInput[] = [], auth: string[] = [], rates: string[] = [], entitlements: string[] = [], f = await punchFixture();
  const d: OperationalPunchRouteDependencies = { baseEnabled: () => true, featureEnabled: () => false, scheduleEnabled: () => false, bindRules: () => false, bodyTimeoutMs: 5000,
    authenticate: async () => { auth.push(id(3)); return { user: { id: id(3) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }; },
    entitlement: async site => { entitlements.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<OperationalPunchRouteDependencies["entitlement"]>>; },
    allow: key => { rates.push(key); return true; }, execute: async input => { calls.push(input); return f.result; }, ...overrides };
  return { d, calls, auth, rates, entitlements };
}

test("242 old base gate and hostile origin reject before Auth and service; methods stay channel-specific", async () => {
  const s = await setup(); assert.equal((await handleOperationalPunchSelf(post("self"), { ...s.d, baseEnabled: () => false })).status, 404);
  for (const headers of [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) assert.equal((await handleOperationalPunchSelf(post("self", body, headers), s.d)).status, 403);
  assert.equal((await handleOperationalPunchPin(new Request(base + "pin"), s.d)).status, 405);
  assert.equal((await handleOperationalPunchSelf(new Request(base + "self", { method: "PUT" }), s.d)).status, 405);
  assert.equal(s.auth.length, 0); assert.equal(s.calls.length, 0);
});

test("242 actual password Auth and server gates bind self read/write; new flag off does not remove recovery", async () => {
  const s = await setup(); const response = await handleOperationalPunchSelf(post("self"), s.d); assert.equal(response.status, 200);
  assert.deepEqual(s.calls[0], { ...body, channel: "self", authUserId: id(3), moduleEnabled: false, allowOperationalStart: false, allowSchedule: false, bindRules: false });
  assert.deepEqual(s.entitlements, [siteId]); assert.deepEqual(s.rates, [id(3)]);
  assert.match(response.headers.get("cache-control")!, /private.*no-store/); assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await handleOperationalPunchSelf(new Request(base + `self?siteId=${siteId}&mode=recover&operationId=${id(20)}`), s.d)).status, 200);
  assert.equal(s.calls[1].command, null); assert.deepEqual(s.calls[1].query, query);
  const bad = await setup({ authenticate: async () => ({ user: { id: id(3) } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) });
  assert.equal((await handleOperationalPunchSelf(post("self"), bad.d)).status, 403); assert.equal(bad.calls.length, 0);
});

test("242 all authority fields, duplicate JSON/query keys and mode/operation inconsistencies reject", async () => {
  const s = await setup();
  for (const extra of [{ authUserId: id(99) }, { moduleEnabled: true }, { allowOperationalStart: true }, { source: {} }, { p_allow_new_sessions: true }]) assert.equal((await handleOperationalPunchSelf(post("self", { ...body, ...extra }), s.d)).status, 400);
  for (const value of [{ ...body, command: null }, { ...body, query: { mode: "prepare" } }, { ...body, query: { mode: "recover", operationId: id(99) } }]) assert.equal((await handleOperationalPunchSelf(post("self", value), s.d)).status, 400);
  const duplicate = new Request(base + "self", { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"siteId":"99990001","siteId":"99990001"}' });
  assert.equal((await handleOperationalPunchSelf(duplicate, s.d)).status, 400);
  for (const suffix of [`siteId=${siteId}&mode=prepare&mode=prepare`, `siteId=${siteId}&mode=prepare&secret=x`, `siteId=${siteId}&mode=recover`, `siteId=${siteId}&mode=prepare&operationId=${id(20)}`]) assert.equal((await handleOperationalPunchSelf(new Request(base + "self?" + suffix), s.d)).status, 400);
  assert.equal(s.calls.length, 0);
});

test("242 PIN prepare/recover are authenticated POSTs using unique original terminal cookie, never web Auth", async () => {
  const s = await setup({ authenticate: async () => { assert.fail("PIN must not fabricate web Auth"); } });
  const pinBody = { workerNo: "PIN-01", pin: "01738264", query, command: null };
  assert.equal((await handleOperationalPunchPin(post("pin", pinBody, { cookie }), s.d)).status, 200);
  assert.deepEqual(s.calls[0], { ...pinBody, channel: "pin", siteId, terminalId: id(9), secret, moduleEnabled: false, allowOperationalStart: false, allowSchedule: false, bindRules: false });
  assert.deepEqual(s.rates, [`${siteId}:${id(9)}`]);
  for (const badCookie of ["", cookie + "; " + cookie]) assert.equal((await handleOperationalPunchPin(post("pin", pinBody, { cookie: badCookie }), s.d)).status, 403);
  for (const more of [{ siteId }, { secret }, { verified: true }]) assert.equal((await handleOperationalPunchPin(post("pin", { ...pinBody, ...more }, { cookie }), s.d)).status, 400);
  assert.equal(s.calls.length, 1);
});

test("242 location keeps original notice/CAS and ephemeral position outside durable intent", async () => {
  const s = await setup(), locationCommand = { ...command, clock: { ...command.clock, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false } };
  const value = { siteId, query, command: locationCommand, position: null, positionFailure: "denied" };
  assert.equal((await handleOperationalPunchLocation(post("location", value), s.d)).status, 200);
  assert.deepEqual(s.calls[0], { ...value, channel: "location", authUserId: id(3), expectedWorkerId: id(1), moduleEnabled: false, allowOperationalStart: false, allowSchedule: false, bindRules: false });
  assert.equal((await handleOperationalPunchLocation(new Request(base + `location?siteId=${siteId}&mode=prepare&expectedWorkerId=${id(1)}`), s.d)).status, 200);
  assert.equal((await handleOperationalPunchLocation(new Request(base + `location?siteId=${siteId}&mode=prepare`), s.d)).status, 400);
  assert.equal((await handleOperationalPunchLocation(post("location", { ...value, assertion: { reason: "inside" } }), s.d)).status, 400);
});

test("242 onsite write token remains transport-only; recovery is ordinary authenticated GET with no token", async () => {
  const s = await setup(), token = "aq1.AA." + "A".repeat(43), c = { ...command, clock: { ...command.clock, expectedEmployeeId: id(2) } };
  assert.equal((await handleOperationalPunchOnsite(post("onsite", { siteId, query, command: c, token }), s.d)).status, 200);
  assert.equal(s.calls[0].channel, "onsite"); assert.deepEqual(s.calls[0].command, c);
  assert.equal((await handleOperationalPunchOnsite(post("onsite", { siteId, query, command: c, token, claims: {} }), s.d)).status, 400);
  assert.equal((await handleOperationalPunchOnsite(new Request(base + `onsite?siteId=${siteId}&mode=recover&operationId=${id(20)}`), s.d)).status, 200);
  const recovered = s.calls[1]; assert.equal(recovered.channel, "onsite"); if (recovered.channel === "onsite") assert.equal(recovered.token, null);
});

test("242 body byte limit, malformed UTF8, stalled stream and abort stay bounded without dispatch", async () => {
  const s = await setup({ bodyTimeoutMs: 15 });
  assert.equal((await handleOperationalPunchSelf(post("self", { ...body, padding: "x".repeat(4096) }), s.d)).status, 413);
  assert.equal((await handleOperationalPunchSelf(post("self", body, { "content-type": "text/plain" }), s.d)).status, 415);
  const bytes = new Request(base + "self", { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0xff]) });
  assert.equal((await handleOperationalPunchSelf(bytes, s.d)).status, 400);
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const stalled = new Request(base + "self", { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleOperationalPunchSelf(stalled, s.d)).status, 400); assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort(); const aborted = new Request(post("self"), { signal: controller.signal });
  assert.equal((await handleOperationalPunchSelf(aborted, s.d)).status, 400); assert.equal(s.calls.length, 0);
});

test("242 shared bucket rate gate, known failure wire, Auth failure and unknown transport expose no details", async () => {
  const s = await setup(); const limited = await handleOperationalPunchSelf(post("self"), { ...s.d, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  for (const [code, status] of [["attendance_operational_punch_changed", 409], ["attendance_operation_conflict", 409], ["attendance_access_denied", 403]] as const) {
    const response = await handleOperationalPunchSelf(post("self"), { ...s.d, execute: async () => { throw new MerchantAttendanceError(code); } });
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: { code, message: code } });
  }
  const bad = await handleOperationalPunchSelf(post("self"), { ...s.d, execute: async () => { throw Error("private secret " + secret); } }); assert.equal(bad.status, 503); assert.equal((await bad.text()).includes(secret), false);
  const auth = await handleOperationalPunchSelf(post("self"), { ...s.d, authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 401); } }); assert.equal(auth.status, 401);
});
