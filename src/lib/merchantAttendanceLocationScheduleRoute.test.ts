import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceLocationSchedule, attendanceLocationScheduleDependencies as defaults } from "../app/api/merchant-enterprise/attendance/location-schedule/route-handler";
import { executeAttendanceLocationSchedule, attendanceLocationScheduleEnabled } from "./merchantAttendanceLocationSchedule.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { locationScheduleActor as actor, locationScheduleQuery as query, locationScheduleCommand as command,
  locationScheduleInput as input, locationScheduleRaw as raw, locationScheduleWire as wire, locationScheduleSelection as selection } from "../../scripts/fixtures/attendance-location-schedule-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/location-schedule";
const headers = { Origin: "https://www.faolla.com", "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
const get = () => new Request(`${url}?siteId=${query.siteId}&expectedWorkerId=${query.expectedWorkerId}`, { headers });
const body = () => ({ siteId: query.siteId, command: command(), selection });
const post = (value: unknown = body()) => new Request(url, { method: "POST", headers, body: JSON.stringify(value) });
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { baseEnabled: () => true, featureEnabled: () => true, bindRules: () => false, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async i => { calls.push(i); const result = wire(i.command !== null); if (!i.allowWrite) result.choices.entries = []; return result; }, ...patch };
  return { calls, deps };
}
const serviceInput = (post = false) => ({ ...input(post), authUserId: actor, moduleEnabled: true, allowWrite: true, bindRules: false });

test("location schedule allowlist is explicit and default off", () => {
  assert.equal(attendanceLocationScheduleEnabled(query.siteId, {}), false);
  for (const sites of [undefined, "", "*", "99990001,*", "99990001,", "99990002", "99990001,".repeat(101)]) {
    assert.equal(attendanceLocationScheduleEnabled(query.siteId, { FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_ENABLED: "1", FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_SITE_IDS: sites }), false);
  }
  assert.equal(attendanceLocationScheduleEnabled(query.siteId, { FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_ENABLED: "1", FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_SITE_IDS: " 99990001,99990002 " }), true);
});
test("location schedule rejects disabled base, other origins verbs and weak auth before execution", async () => {
  let authenticated = 0; const f = setup({ authenticate: async () => { authenticated++; throw Error("unexpected"); } });
  assert.equal((await handleAttendanceLocationSchedule(get(), { ...f.deps, baseEnabled: () => false })).status, 404);
  for (const method of ["PUT", "DELETE", "PATCH"]) assert.equal((await handleAttendanceLocationSchedule(new Request(url, { method }), f.deps)).status, 405);
  for (const req of [new Request(get().url.replace("www.", "other.")), new Request(get(), { headers: { origin: "https://other.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { "sec-fetch-site": "cross-site" } })]) {
    assert.equal((await handleAttendanceLocationSchedule(req, f.deps)).status, 403);
  }
  assert.equal(authenticated, 0);
  for (const methods of [[], ["invite"], ["password", "magiclink"], ["recovery"]]) {
    const weak = setup({ authenticate: async () => ({ user: { id: actor } as User, accessToken: "", authenticationMethods: methods }) });
    assert.equal((await handleAttendanceLocationSchedule(get(), weak.deps)).status, 403); assert.equal(weak.calls.length, 0);
  }
  const rate = setup({ allow: () => false }); const response = await handleAttendanceLocationSchedule(get(), rate.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(rate.calls.length, 0);
});
test("new POST is gated but default-off or module-paused GET remains a read-only recovery", async () => {
  for (const moduleEnabled of [true, false]) {
    const f = setup({ featureEnabled: () => false, entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: moduleEnabled } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
    const response = await handleAttendanceLocationSchedule(get(), f.deps); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await response.json()).selectionEnabled, false); assert.equal(f.calls[0].allowWrite, false); assert.equal(f.calls[0].command, null);
    assert.equal((await handleAttendanceLocationSchedule(post(), f.deps)).status, 403); assert.equal(f.calls.length, 1);
  }
});
test("strict bounded input rejects duplicate keys query tricks non-clock-in and uploaded policy", async () => {
  const f = setup();
  for (const req of [new Request(get().url + "&siteId=99990001", { headers }), new Request(get().url + "&selection=null", { headers }),
    new Request(url + "?siteId=99990001", post()), post({ ...body(), approval: {} }), post({ ...body(), command: { ...command(), action: "clock_out" } }),
    post({ ...body(), command: { ...command(), safeFinish: true } }),
    new Request(url, { method: "POST", headers, body: JSON.stringify(body()).replace('"siteId":', '"siteId":"99990001","siteId":') })]) {
    const response = await handleAttendanceLocationSchedule(req, f.deps); assert.equal(response.status, 400);
  }
  for (const [req, status] of [[new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([123, 255, 125]) }), 400]] as const) assert.equal((await handleAttendanceLocationSchedule(req, f.deps)).status, status);
  assert.equal(f.calls.length, 0);
});
test("request timeout cancels stream and request abort never executes", async () => {
  let cancelled = 0; const f = setup({ bodyTimeoutMs: 15 });
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled++; } });
  assert.equal((await handleAttendanceLocationSchedule(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps)).status, 400);
  assert.equal(cancelled, 1); const controller = new AbortController(); controller.abort();
  assert.equal((await handleAttendanceLocationSchedule(new Request(post(), { signal: controller.signal }), f.deps)).status, 400); assert.equal(f.calls.length, 0);
});
test("route projects flat public result and hides unknown upstream errors", async () => {
  const f = setup(); const response = await handleAttendanceLocationSchedule(post(), f.deps); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ...wire(true), moduleEnabled: true, selectionEnabled: true });
  for (const error of [Error("secret"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("secret", 403)]) {
    const response = await handleAttendanceLocationSchedule(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  assert.equal((await handleAttendanceLocationSchedule(get(), setup({ execute: async () => raw() }).deps)).status, 503);
});
test("adapter preserves existing location range computation and only sends assertion to atomic wrapper", async () => {
  const calls: Record<string, unknown>[] = [];
  const result = await executeAttendanceLocationSchedule(serviceInput(true), { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_location_schedule_v1"); calls.push(args);
    assert.equal(args.p_bind_rules, false); assert.equal(args.p_allow_schedule, true);
    return { data: raw(args.p_command !== null), error: null };
  } });
  assert.equal(calls.length, 2); assert.equal(calls[0].p_command, null); assert.equal(calls[0].p_operation_id, command().operationId); assert.equal(calls[0].p_selection, null);
  assert.deepEqual(calls[1].p_selection, selection); assert.equal(calls[1].p_operation_id, null);
  assert.equal((calls[1].p_command as Record<string, unknown>).position, undefined);
  assert.equal((calls[1].p_assertion as Record<string, unknown>).reason, "inside");
  assert.equal((calls[1].p_assertion as Record<string, unknown>).distanceMeters, 0);
  assert.deepEqual(result, wire(true)); assert.equal(Object.hasOwn(result.clock, "internalFence"), false);
});
test("original replay preserves selection and missing legacy sidecar cannot be adopted", async () => {
  let calls = 0;
  const rpc = { rpc: async () => { calls++; return { data: raw(true), error: null }; } };
  const result = await executeAttendanceLocationSchedule(serviceInput(true), rpc); assert.equal(result.clock.replayed, true); assert.equal(calls, 1);
  await assert.rejects(executeAttendanceLocationSchedule({ ...serviceInput(true), selection: null }, rpc), { code: "attendance_operation_conflict" });
  const legacy = raw(true); legacy.association = null; legacy.adoption = null;
  await assert.rejects(executeAttendanceLocationSchedule(serviceInput(true), { rpc: async () => ({ data: legacy, error: null }) }), { code: "attendance_operation_conflict" });
  const recovered = await executeAttendanceLocationSchedule({ ...serviceInput(), operationId: command().operationId, moduleEnabled: false, allowWrite: false }, { rpc: async () => ({ data: legacy, error: null }) });
  assert.equal(recovered.adoption, null); assert.equal(recovered.association, null);
});
test("service validates every private response and SQL errors before old service uses it", async () => {
  for (const data of [{ ...raw(), extra: "secret" }, { ...raw(), clock: { ...raw().clock, internalPolicyFingerprint: "invalid" } }]) {
    await assert.rejects(executeAttendanceLocationSchedule(serviceInput(), { rpc: async () => ({ data, error: null }) }), { code: "attendance_location_schedule_invalid" });
  }
  for (const message of ["constructor", "private error"]) await assert.rejects(executeAttendanceLocationSchedule(serviceInput(), { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  await assert.rejects(executeAttendanceLocationSchedule({ ...serviceInput(true), allowWrite: false }, { rpc: async () => { throw Error("must not call"); } }), { code: "attendance_location_schedule_disabled" });
  await assert.rejects(executeAttendanceLocationSchedule({ ...serviceInput(true), selection: undefined }, { rpc: async () => { throw Error("must not call"); } }), { code: "attendance_invalid_request" });
});
