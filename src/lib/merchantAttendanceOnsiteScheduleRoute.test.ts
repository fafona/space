import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceOnsiteSchedule, attendanceOnsiteScheduleDependencies as defaults } from "../app/api/merchant-enterprise/attendance/onsite-schedule/route-handler";
import { attendanceOnsiteScheduleEnabled, executeAttendanceOnsiteSchedule, type AttendanceOnsiteScheduleInput } from "./merchantAttendanceOnsiteSchedule.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { signOnsiteToken } from "./merchantAttendanceOnsiteQr.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { onsiteScheduleActor as actor, onsiteScheduleSite as siteId, onsiteScheduleBody as body, onsiteScheduleClaims as claims,
  onsiteScheduleCommand as command, onsiteScheduleInput as input, onsiteScheduleWire as wire, onsiteScheduleSelection as selection,
  onsiteScheduleId as id } from "../../scripts/fixtures/attendance-onsite-schedule-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/onsite-schedule";
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
const serviceInput = (write = false): AttendanceOnsiteScheduleInput => ({ ...input(write), authUserId: actor, token: write ? body().token : null,
  moduleEnabled: true, allowWrite: true, bindRules: false });
async function withKey(run: () => Promise<void>) {
  const previous = process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  try { process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = "35".repeat(32); await run(); }
  finally { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET; else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = previous; }
}

test("onsite selection gates require exact flag and finite explicit site list", () => {
  const enabled = { FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_ENABLED: "1", FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_SITE_IDS: siteId };
  assert.equal(attendanceOnsiteScheduleEnabled(siteId, {}), false); assert.equal(attendanceOnsiteScheduleEnabled(siteId, enabled), true);
  assert.equal(attendanceOnsiteScheduleEnabled(siteId + "\n", enabled), false);
  for (const flag of ["true", " 1", "1 ", "0", undefined]) assert.equal(attendanceOnsiteScheduleEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_ENABLED: flag }), false);
  for (const list of [undefined, "", "*", siteId + ",*", siteId + ",", "99990002", Array(101).fill(siteId).join(","), "1".repeat(4097)])
    assert.equal(attendanceOnsiteScheduleEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_SITE_IDS: list }), false);
  assert.equal(attendanceOnsiteScheduleEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_SITE_IDS: " 99990001,99990002 " }), true);
});

test("disabled base, other verbs and untrusted origin are rejected before authentication", async () => {
  let authCalls = 0; const f = setup({ authenticate: async () => { authCalls++; throw Error("unexpected authentication"); } });
  assert.equal((await handleAttendanceOnsiteSchedule(get(), { ...f.deps, baseEnabled: () => false })).status, 404);
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const response = await handleAttendanceOnsiteSchedule(new Request(url, { method }), f.deps);
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, POST");
  }
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")),
    new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "cross-site" } })])
    assert.equal((await handleAttendanceOnsiteSchedule(request, f.deps)).status, 403);
  assert.equal(authCalls, 0); assert.equal(f.calls.length, 0);
});

test("password-only current authorization and rate limiting remain required", async () => {
  for (const authenticationMethods of [[], ["invite"], ["password", "magiclink"], ["recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: actor } as User, accessToken: "", authenticationMethods }) });
    assert.equal((await handleAttendanceOnsiteSchedule(get(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  const f = setup({ allow: () => false }); const response = await handleAttendanceOnsiteSchedule(get(), f.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
  for (const [error, status, code] of [
    [new MerchantEnterpriseAccessError("authentication_required", 401), 401, "authentication_required"],
    [new MerchantEnterpriseAccessError("enterprise_auth_unavailable", 503), 503, "enterprise_auth_unavailable"],
    [new MerchantEnterpriseAccessError("authentication_required", 403), 503, "attendance_unavailable"],
  ] as const) {
    const denied = await handleAttendanceOnsiteSchedule(get(), setup({ authenticate: async () => { throw error; } }).deps);
    assert.equal(denied.status, status); assert.deepEqual(await denied.json(), { ok: false, error: code });
  }
});

test("feature rollback and module pause forbid POST but allow token-free original-number GET", async () => {
  for (const moduleEnabled of [true, false]) {
    const f = setup({ featureEnabled: () => false,
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: moduleEnabled } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
    const response = await handleAttendanceOnsiteSchedule(get(command().operationId), f.deps); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.selectionEnabled, false); assert.equal(data.adoption.status, "adopted");
    assert.equal(f.calls[0].token, null); assert.equal(f.calls[0].command, null); assert.equal(Object.hasOwn(f.calls[0], "selection"), false);
    const denied = await handleAttendanceOnsiteSchedule(post(), f.deps); assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, moduleEnabled ? "attendance_onsite_schedule_disabled" : "attendance_platform_paused"); assert.equal(f.calls.length, 1);
  }
});

test("strict HTTP input rejects query tricks, duplicate JSON, non-starts and uploaded policy", async () => {
  const f = setup();
  for (const request of [new Request(get().url + "&siteId=" + siteId, { headers }), new Request(get().url + "&token=capability", { headers }),
    new Request(get().url + "&selection=null", { headers }), new Request(url + "?siteId=" + siteId, post()),
    post({ ...body(), source: {} }), post({ ...body(), command: { ...command(), action: "clock_out" } }), post({ ...body(), selection: undefined }),
    new Request(url, { method: "POST", headers, body: JSON.stringify(body()).replace('"siteId":', '"siteId":"99990001","siteId":') }),
    new Request(url, { method: "POST", headers, body: "{" })])
    assert.equal((await handleAttendanceOnsiteSchedule(request, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("8 KiB is enforced for declared and streamed bytes and UTF-8 decoding is fatal", async () => {
  const f = setup();
  for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "1x" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([123, 255, 125]) }), 400],
  ] as const) assert.equal((await handleAttendanceOnsiteSchedule(request, f.deps)).status, status);
  assert.equal(f.calls.length, 0);
  const json = JSON.stringify(body()), bytes = new TextEncoder().encode(json + " ".repeat(8192 - new TextEncoder().encode(json).byteLength));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 100)); controller.enqueue(bytes.slice(100)); controller.close(); } });
  const valid = await handleAttendanceOnsiteSchedule(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps);
  assert.equal(valid.status, 200); assert.equal(f.calls.length, 1);
});

test("request deadline and abort cancel the body and never reach a command", async () => {
  let cancelled = 0; const f = setup({ bodyTimeoutMs: 15 });
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel() { cancelled++; } });
  const timeout = await handleAttendanceOnsiteSchedule(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps);
  assert.equal(timeout.status, 400); assert.equal(cancelled, 1);
  const abort = new AbortController(); abort.abort();
  assert.equal((await handleAttendanceOnsiteSchedule(new Request(post(), { signal: abort.signal }), f.deps)).status, 400); assert.equal(f.calls.length, 0);
});

test("real signing and actual handler/service produce exactly one atomic wrapper RPC and a public flat response", async () => withKey(async () => {
  const token = signOnsiteToken(claims()), calls: Record<string, unknown>[] = [];
  const rpc: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, "faolla_attendance_onsite_schedule_v1"); calls.push(args); return { data: wire(true), error: null }; } };
  const f = setup({ execute: value => executeAttendanceOnsiteSchedule(value, rpc) });
  const response = await handleAttendanceOnsiteSchedule(post({ ...body(), token }), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, ...wire(true), moduleEnabled: true, selectionEnabled: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { p_site: siteId, p_auth: actor, p_claims: claims(), p_command: command(), p_operation: null,
    p_allow_new: true, p_selection: selection, p_allow_schedule: true, p_bind_rules: false });
  assert.equal(Object.hasOwn(calls[0], "token"), false);
}));

test("service GET needs no QR secret, keeps original IDs and preserves legacy null sidecars", async () => {
  const previous = process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  try {
    delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
    let calls = 0; const old = wire(true); old.association = null; old.adoption = null;
    const result = await executeAttendanceOnsiteSchedule({ ...serviceInput(), operationId: command().operationId, moduleEnabled: false, allowWrite: false },
      { rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_onsite_schedule_v1"); assert.equal(args.p_claims, null);
        assert.equal(args.p_command, null); assert.equal(args.p_operation, command().operationId); assert.equal(args.p_selection, null);
        assert.equal(args.p_allow_new, false); assert.equal(args.p_allow_schedule, false); return { data: old, error: null }; } });
    assert.equal(calls, 1); assert.equal(result.adoption, null);
  } finally { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET; else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = previous; }
});

test("HMAC and claims scope reject before RPC, while SQL remains the freshness and nonce authority", async () => withKey(async () => {
  let calls = 0; const rpc: AttendanceSelfRpc = { rpc: async () => { calls++; return { data: wire(true), error: null }; } };
  for (const token of [body().token, signOnsiteToken({ ...claims(), siteId: "99990002" }), signOnsiteToken({ ...claims(), locationId: id(99) })])
    await assert.rejects(executeAttendanceOnsiteSchedule({ ...serviceInput(true), token }, rpc), { code: "attendance_qr_invalid" });
  assert.equal(calls, 0);
  const oldClaims = { ...claims(), pairedAtMs: 0, issuedAtMs: 1000, expiresAtMs: 46000 }, token = signOnsiteToken(oldClaims);
  for (const code of ["attendance_qr_expired", "attendance_qr_used", "attendance_terminal_denied"]) {
    let once = 0; await assert.rejects(executeAttendanceOnsiteSchedule({ ...serviceInput(true), token }, { rpc: async (_, args) => {
      once++; assert.deepEqual(args.p_claims, oldClaims); return { data: null, error: { message: code } };
    } }), { code }); assert.equal(once, 1);
  }
}));

test("service input validation rejects ambiguous recovery, missing selection, disabled writes and bad options before RPC", async () => withKey(async () => {
  let calls = 0; const rpc: AttendanceSelfRpc = { rpc: async () => { calls++; throw Error("unexpected RPC"); } };
  const token = signOnsiteToken(claims());
  for (const value of [{ ...serviceInput(true), token, operationId: command().operationId }, { ...serviceInput(true), token, selection: undefined },
    { ...serviceInput(), token }, { ...serviceInput(), selection: null }, { ...serviceInput(), siteId: siteId + "\n" },
    { ...serviceInput(), authUserId: "not-uuid" }, { ...serviceInput(), moduleEnabled: undefined }])
    await assert.rejects(executeAttendanceOnsiteSchedule(value as AttendanceOnsiteScheduleInput, rpc), { code: "attendance_invalid_request" });
  await assert.rejects(executeAttendanceOnsiteSchedule({ ...serviceInput(true), token, allowWrite: false }, rpc), { code: "attendance_onsite_schedule_disabled" });
  await assert.rejects(executeAttendanceOnsiteSchedule({ ...serviceInput(true), token, moduleEnabled: false }, rpc), { code: "attendance_platform_paused" });
  assert.equal(calls, 0);
}));

test("response binding, SQL error allowlist and unknown-error sanitization never trigger fallback", async () => withKey(async () => {
  const token = signOnsiteToken(claims());
  for (const code of ["attendance_operation_conflict", "attendance_access_denied", "attendance_onsite_schedule_invalid"]) {
    let calls = 0; await assert.rejects(executeAttendanceOnsiteSchedule({ ...serviceInput(true), token }, { rpc: async () => {
      calls++; return { data: null, error: { message: code } };
    } }), { code }); assert.equal(calls, 1);
  }
  const bad = wire(true); bad.adoption!.employeeAuthUserId = id(99);
  await assert.rejects(executeAttendanceOnsiteSchedule({ ...serviceInput(true), token }, { rpc: async () => ({ data: bad, error: null }) }), { code: "attendance_onsite_schedule_invalid" });
  for (const message of ["constructor", "secret SQL text"]) await assert.rejects(executeAttendanceOnsiteSchedule(serviceInput(),
    { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  await assert.rejects(executeAttendanceOnsiteSchedule(serviceInput(), { rpc: async () => { throw Error("private connection data"); } }), { code: "attendance_unavailable" });
  for (const error of [Error("private details"), new MerchantAttendanceError("constructor"), new MerchantEnterpriseAccessError("secret", 403)]) {
    const response = await handleAttendanceOnsiteSchedule(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const response = await handleAttendanceOnsiteSchedule(get(), setup({ execute: async () => ({ ...wire(), token }) }).deps);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /aq1\./);
}));
