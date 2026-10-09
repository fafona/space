import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceSelfScheduleAdoption, attendanceSelfScheduleAdoptionDependencies as defaults } from "../app/api/merchant-enterprise/attendance/self-schedule-adoption/route-handler";
import { attendanceSelfScheduleAdoptionEnabled, executeAttendanceSelfScheduleAdoption,
  type AttendanceSelfScheduleAdoptionInput } from "./merchantAttendanceSelfScheduleAdoption.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { selfScheduleAdoptionActor as actor, selfScheduleAdoptionSite as siteId, selfScheduleAdoptionBody as body,
  selfScheduleAdoptionCommand as command, selfScheduleAdoptionInput as input, selfScheduleAdoptionWire as wire,
  selfScheduleAdoptionSelection as selection, selfScheduleAdoptionId as id } from "../../scripts/fixtures/attendance-self-schedule-adoption-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/self-schedule-adoption";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (operationId: string | null = null) => new Request(`${url}?siteId=${siteId}${operationId ? "&operationId=" + operationId : ""}`, { headers });
const post = (value: unknown = body()) => new Request(url, { method: "POST", headers, body: JSON.stringify(value) });
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { baseEnabled: () => true, featureEnabled: () => true, bindRules: () => false, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async value => { calls.push(value); const result = wire(value.command !== null || value.operationId !== null);
      if (!value.allowWrite) result.choices.entries = []; return result; }, ...patch };
  return { calls, deps };
}
const serviceInput = (write = false): AttendanceSelfScheduleAdoptionInput => ({ ...input(write), authUserId: actor,
  moduleEnabled: true, allowWrite: true, bindRules: false });

test("feature requires both exact gates and finite explicit site lists, never widens old137 permission", () => {
  const enabled = { FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED: "1", FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS: siteId,
    FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_ENABLED: "1", FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_SITE_IDS: siteId };
  assert.equal(attendanceSelfScheduleAdoptionEnabled(siteId, {}), false); assert.equal(attendanceSelfScheduleAdoptionEnabled(siteId, enabled), true);
  assert.equal(attendanceSelfScheduleAdoptionEnabled(siteId + "\n", enabled), false);
  for (const key of ["FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED", "FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_ENABLED"])
    for (const flag of ["true", " 1", "1 ", "0", undefined]) assert.equal(attendanceSelfScheduleAdoptionEnabled(siteId, { ...enabled, [key]: flag }), false);
  for (const key of ["FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS", "FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_SITE_IDS"])
    for (const list of [undefined, "", "*", siteId + ",*", siteId + ",", "99990002", Array(101).fill(siteId).join(","), "1".repeat(4097)])
      assert.equal(attendanceSelfScheduleAdoptionEnabled(siteId, { ...enabled, [key]: list }), false);
  assert.equal(attendanceSelfScheduleAdoptionEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_SITE_IDS: " 99990001,99990002 " }), true);
});

test("disabled base, other methods and noncanonical or cross-origin requests stop before authentication", async () => {
  let authCalls = 0; const f = setup({ authenticate: async () => { authCalls++; throw Error("unexpected"); } });
  assert.equal((await handleAttendanceSelfScheduleAdoption(get(), { ...f.deps, baseEnabled: () => false })).status, 404);
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const response = await handleAttendanceSelfScheduleAdoption(new Request(url, { method }), f.deps);
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, POST");
  }
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")),
    new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "cross-site" } })])
    assert.equal((await handleAttendanceSelfScheduleAdoption(request, f.deps)).status, 403);
  assert.equal(authCalls, 0); assert.equal(f.calls.length, 0);
});

test("password auth, entitlement and rate checks remain mandatory even for recovery", async () => {
  for (const authenticationMethods of [[], ["invite"], ["password", "magiclink"], ["recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: actor } as User, accessToken: "", authenticationMethods }) });
    assert.equal((await handleAttendanceSelfScheduleAdoption(get(command().operationId), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  const rate = setup({ allow: () => false }); const response = await handleAttendanceSelfScheduleAdoption(get(), rate.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(rate.calls.length, 0);
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleAttendanceSelfScheduleAdoption(get(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
  for (const [error, status, code] of [
    [new MerchantEnterpriseAccessError("authentication_required", 401), 401, "authentication_required"],
    [new MerchantEnterpriseAccessError("enterprise_auth_unavailable", 503), 503, "enterprise_auth_unavailable"],
    [new MerchantEnterpriseAccessError("authentication_required", 403), 503, "attendance_unavailable"],
  ] as const) {
    const rejected = await handleAttendanceSelfScheduleAdoption(get(), setup({ authenticate: async () => { throw error; } }).deps);
    assert.equal(rejected.status, status); assert.deepEqual(await rejected.json(), { ok: false, error: code });
  }
});

test("all new POSTs are paused or disabled at HTTP boundary while authenticated original GET remains", async () => {
  for (const moduleEnabled of [true, false]) for (const featureEnabled of [true, false]) {
    const f = setup({ featureEnabled: () => featureEnabled,
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: moduleEnabled } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
    const response = await handleAttendanceSelfScheduleAdoption(get(command().operationId), f.deps); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.selectionEnabled, moduleEnabled && featureEnabled); assert.equal(data.adoption.status, "adopted");
    assert.equal(f.calls[0].command, null); assert.equal(f.calls[0].operationId, command().operationId);
    assert.equal(Object.hasOwn(f.calls[0], "selection"), false); assert.equal(f.calls[0].allowWrite, moduleEnabled && featureEnabled);
    const sent = await handleAttendanceSelfScheduleAdoption(post(), f.deps);
    if (moduleEnabled && featureEnabled) { assert.equal(sent.status, 200); assert.equal(f.calls.length, 2); }
    else { assert.equal(sent.status, 403); assert.equal((await sent.json()).error,
      moduleEnabled ? "attendance_self_schedule_adoption_disabled" : "attendance_platform_paused"); assert.equal(f.calls.length, 1); }
  }
});

test("HTTP exact grammar rejects query injection, duplicate keys and uploaded identity or rules", async () => {
  const f = setup();
  for (const request of [new Request(get().url + "&siteId=" + siteId, { headers }), new Request(get().url + "&employeeId=" + id(2), { headers }),
    new Request(get().url + "&selection=null", { headers }), new Request(url + "?siteId=" + siteId, post()),
    post({ ...body(), source: {} }), post({ ...body(), command: { ...command(), action: "clock_out" } }), post({ ...body(), selection: undefined }),
    post({ ...body(), command: { ...command(), expectedEmployeeId: id(2) } }),
    new Request(url, { method: "POST", headers, body: JSON.stringify(body()).replace('"siteId":', '"siteId":"99990001","siteId":') }),
    new Request(url, { method: "POST", headers, body: "{" })])
    assert.equal((await handleAttendanceSelfScheduleAdoption(request, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("declared and streamed 8 KiB limit, fatal UTF-8 and exact content type are enforced", async () => {
  const f = setup();
  for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "1x" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([123, 255, 125]) }), 400],
  ] as const) assert.equal((await handleAttendanceSelfScheduleAdoption(request, f.deps)).status, status);
  assert.equal(f.calls.length, 0);
  const json = JSON.stringify(body()), bytes = new TextEncoder().encode(json + " ".repeat(8192 - new TextEncoder().encode(json).byteLength));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 100)); controller.enqueue(bytes.slice(100)); controller.close(); } });
  const valid = await handleAttendanceSelfScheduleAdoption(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps);
  assert.equal(valid.status, 200); assert.equal(f.calls.length, 1);
});

test("body deadline and request abort cancel the stream without executing", async () => {
  let cancelled = 0; const f = setup({ bodyTimeoutMs: 15 });
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel() { cancelled++; } });
  const timeout = await handleAttendanceSelfScheduleAdoption(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps);
  assert.equal(timeout.status, 400); assert.equal(cancelled, 1);
  const abort = new AbortController(); abort.abort();
  assert.equal((await handleAttendanceSelfScheduleAdoption(new Request(post(), { signal: abort.signal }), f.deps)).status, 400); assert.equal(f.calls.length, 0);
});

test("actual handler and service send one exact seven-argument RPC with unchanged command", async () => {
  const calls: Record<string, unknown>[] = [];
  const rpc: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, "faolla_attendance_self_schedule_adoption_v1"); calls.push(args); return { data: wire(true), error: null }; } };
  const response = await handleAttendanceSelfScheduleAdoption(post(), setup({ execute: value => executeAttendanceSelfScheduleAdoption(value, rpc) }).deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, ...wire(true), moduleEnabled: true, selectionEnabled: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { p_site_id: siteId, p_auth_user_id: actor, p_command: command(), p_selection: selection,
    p_operation_id: null, p_allow_write: true, p_bind_rules: false });
});

test("service GET accepts legacy137 association without adoption, preserving absent local selection expectation", async () => {
  for (const associated of [false, true]) {
    let calls = 0; const old = wire(true); old.adoption = null; if (!associated) old.association = null;
    const result = await executeAttendanceSelfScheduleAdoption({ ...serviceInput(), operationId: command().operationId, moduleEnabled: false, allowWrite: false },
      { rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_self_schedule_adoption_v1");
        assert.deepEqual(args, { p_site_id: siteId, p_auth_user_id: actor, p_command: null, p_selection: null,
          p_operation_id: command().operationId, p_allow_write: false, p_bind_rules: false }); return { data: old, error: null }; } });
    assert.equal(calls, 1); assert.equal(result.adoption, null); assert.equal(result.association?.status ?? null, associated ? "linked" : null);
  }
});

test("service rejects ambiguous input and every disabled or paused POST before RPC", async () => {
  let calls = 0; const rpc: AttendanceSelfRpc = { rpc: async () => { calls++; throw Error("unexpected RPC"); } };
  for (const value of [{ ...serviceInput(true), operationId: command().operationId }, { ...serviceInput(true), selection: undefined },
    { ...serviceInput(), selection: null }, { ...serviceInput(), siteId: siteId + "\n" }, { ...serviceInput(), authUserId: "not-uuid" },
    { ...serviceInput(), moduleEnabled: undefined }])
    await assert.rejects(executeAttendanceSelfScheduleAdoption(value as AttendanceSelfScheduleAdoptionInput, rpc), { code: "attendance_invalid_request" });
  await assert.rejects(executeAttendanceSelfScheduleAdoption({ ...serviceInput(true), allowWrite: false }, rpc), { code: "attendance_self_schedule_adoption_disabled" });
  await assert.rejects(executeAttendanceSelfScheduleAdoption({ ...serviceInput(true), moduleEnabled: false }, rpc), { code: "attendance_platform_paused" });
  assert.equal(calls, 0);
});

test("successful POST replay still requires both self sidecars and exact original selection", async () => {
  const replay = wire(true); replay.clock.replayed = true;
  const rpc: AttendanceSelfRpc = { rpc: async () => ({ data: replay, error: null }) };
  assert.equal((await executeAttendanceSelfScheduleAdoption(serviceInput(true), rpc)).clock.replayed, true);
  await assert.rejects(executeAttendanceSelfScheduleAdoption({ ...serviceInput(true), selection: null }, rpc), { code: "attendance_self_schedule_adoption_invalid" });
  replay.adoption = null;
  await assert.rejects(executeAttendanceSelfScheduleAdoption(serviceInput(true), rpc), { code: "attendance_self_schedule_adoption_invalid" });
});

test("cross-channel, private, malformed or changed identity responses fail closed with no fallback", async () => {
  for (const data of [ { ...wire(true), private: "secret" }, { ...wire(true), clock: { ...wire(true).clock, employeeId: id(2) } },
    { ...wire(true), adoption: { ...wire(true).adoption!, channel: "onsite" } },
    { ...wire(true), adoption: { ...wire(true).adoption!, employeeAuthUserId: id(99) } } ]) {
    let calls = 0; await assert.rejects(executeAttendanceSelfScheduleAdoption(serviceInput(true), { rpc: async () => {
      calls++; return { data, error: null }; } }), { code: "attendance_self_schedule_adoption_invalid" }); assert.equal(calls, 1);
  }
  for (const code of ["attendance_operation_conflict", "attendance_access_denied", "attendance_self_schedule_adoption_invalid"]) {
    let calls = 0; await assert.rejects(executeAttendanceSelfScheduleAdoption(serviceInput(true), { rpc: async () => {
      calls++; return { data: null, error: { message: code } }; } }), { code }); assert.equal(calls, 1);
  }
  for (const message of ["constructor", "secret SQL text"]) await assert.rejects(executeAttendanceSelfScheduleAdoption(serviceInput(),
    { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  await assert.rejects(executeAttendanceSelfScheduleAdoption(serviceInput(), { rpc: async () => { throw Error("private connection data"); } }), { code: "attendance_unavailable" });
  for (const error of [Error("private details"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("secret", 403)]) {
    const response = await handleAttendanceSelfScheduleAdoption(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const response = await handleAttendanceSelfScheduleAdoption(get(), setup({ execute: async () => ({ ...wire(), sourceText: "private" }) }).deps);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private|sourceText/);
});
