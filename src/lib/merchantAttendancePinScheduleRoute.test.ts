import test from "node:test";
import assert from "node:assert/strict";
import { handleAttendancePinSchedule, attendancePinScheduleDependencies as defaults } from "../app/api/merchant-enterprise/attendance/terminal-schedule/route-handler";
import { executeAttendancePinSchedule, attendancePinScheduleEnabled, type AttendancePinScheduleInput } from "./merchantAttendancePinSchedule.server";
import { deriveAttendancePin, withAttendancePinKdf, PIN_SCRYPT_OPTIONS } from "./merchantAttendancePin.server";
import { terminalHash } from "./merchantAttendanceTerminal.server";
import { TERMINAL_COOKIE } from "./merchantAttendanceTerminal";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { pinScheduleBody as body, pinScheduleWire as wire, pinScheduleCommand as command, pinScheduleId as id,
  pinScheduleSite as siteId, pinScheduleTerminal as terminalId, pinScheduleSelection as selection, pinSchedulePin as pin } from "../../scripts/fixtures/attendance-pin-schedule-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/terminal-schedule", secret = "A".repeat(43);
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: `${TERMINAL_COOKIE}=${siteId}.${terminalId}.${secret}` };
const post = (value: unknown = body()) => new Request(url, { method: "POST", headers, body: JSON.stringify(value) });
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: AttendancePinScheduleInput[] = [];
  const deps: typeof defaults = { baseEnabled: () => true, featureEnabled: () => true, bindRules: () => false, allow: () => true, bodyTimeoutMs: 5000,
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); const result = wire(input.command !== null || input.operationId !== null);
      if (!input.moduleEnabled) result.clock.canStart = false; if (!input.allowWrite || !input.moduleEnabled) result.choices.entries = []; return result; }, ...patch };
  return { calls, deps };
}
const serviceInput = (write = false): AttendancePinScheduleInput => ({ ...body(write), siteId, terminalId, secret, moduleEnabled: true, allowWrite: true, bindRules: false });
async function withPepper(run: () => Promise<void>) {
  const previous = process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;
  try { process.env.FAOLLA_ATTENDANCE_PIN_PEPPER = "A".repeat(43); await run(); }
  finally { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_PIN_PEPPER; else process.env.FAOLLA_ATTENDANCE_PIN_PEPPER = previous; }
}

test("PIN schedule gate requires exact flag and bounded explicit tenant list", () => {
  const enabled = { FAOLLA_ATTENDANCE_PIN_SCHEDULE_ENABLED: "1", FAOLLA_ATTENDANCE_PIN_SCHEDULE_SITE_IDS: siteId };
  assert.equal(attendancePinScheduleEnabled(siteId, {}), false); assert.equal(attendancePinScheduleEnabled(siteId, enabled), true);
  assert.equal(attendancePinScheduleEnabled(siteId + "\n", enabled), false);
  for (const value of ["true", " 1", "1 ", "0", undefined]) assert.equal(attendancePinScheduleEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_PIN_SCHEDULE_ENABLED: value }), false);
  for (const value of ["", "*", "99990002", siteId + ",", siteId + ",*", Array(101).fill(siteId).join(","), "1".repeat(4097), undefined])
    assert.equal(attendancePinScheduleEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_PIN_SCHEDULE_SITE_IDS: value }), false);
  assert.equal(attendancePinScheduleEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_PIN_SCHEDULE_SITE_IDS: " 99990001,99990002 " }), true);
});
test("default-off base, non-POST and foreign/same-site origins never authenticate PIN", async () => {
  const f = setup(); assert.equal((await handleAttendancePinSchedule(post(), { ...f.deps, baseEnabled: () => false })).status, 404);
  for (const method of ["GET", "PUT", "DELETE"]) { const r = await handleAttendancePinSchedule(new Request(url, { method }), f.deps); assert.equal(r.status, 405); assert.equal(r.headers.get("allow"), "POST"); }
  for (const req of [new Request(url.replace("www.faolla.com", "other.invalid"), post()),
    new Request(post(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(post(), { headers: { ...headers, "sec-fetch-site": "same-site" } }), new Request(post(), { headers: { ...headers, "sec-fetch-site": "cross-site" } })])
    assert.equal((await handleAttendancePinSchedule(req, f.deps)).status, 403);
  assert.equal(f.calls.length, 0);
});
test("a unique device cookie scopes tenant; rate/entitlement refusals leak no employee information", async () => {
  const f = setup();
  for (const cookie of ["", "other=x", headers.cookie + "; " + headers.cookie, `${TERMINAL_COOKIE}=malformed`])
    assert.equal((await handleAttendancePinSchedule(new Request(post(), { headers: { ...headers, cookie } }), f.deps)).status, 403);
  let rateKey = ""; const r = await handleAttendancePinSchedule(post(), { ...f.deps, allow: key => { rateKey = key; return false; } });
  assert.equal(rateKey, `${siteId}:${terminalId}`); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
  const denied = await handleAttendancePinSchedule(post(), { ...f.deps, entitlement: async () => { throw new MerchantEnterpriseAccessError("private entitlement", 403); } });
  assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { ok: false, error: "attendance_terminal_denied" }); assert.equal(f.calls.length, 0);
});
test("read and original-number recovery pass independent feature and admission flags", async () => {
  for (const moduleEnabled of [true, false]) for (const featureEnabled of [true, false]) {
    const f = setup({ featureEnabled: () => featureEnabled, entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: moduleEnabled } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
    const r = await handleAttendancePinSchedule(post({ ...body(), operationId: command().operationId }), f.deps);
    assert.equal(r.status, 200); const data = await r.json(); assert.equal(data.selectionEnabled, moduleEnabled && featureEnabled); assert.equal(data.adoption.status, "adopted");
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, null); assert.equal(f.calls[0].selection, null); assert.equal(f.calls[0].pin, pin);
    assert.equal(f.calls[0].allowWrite, featureEnabled); assert.equal(f.calls[0].moduleEnabled, moduleEnabled);
    const freshRead = await handleAttendancePinSchedule(post(), f.deps); assert.equal(freshRead.status, 200);
    assert.equal(f.calls[1].allowWrite, featureEnabled); assert.equal(f.calls[1].moduleEnabled, moduleEnabled);
    if (!moduleEnabled || !featureEnabled) assert.deepEqual((await freshRead.json()).choices.entries, []);
  }
});
test("paused admission with feature on reaches SQL as allowWrite true; fresh command refusal does not suppress original replay", async () => {
  const calls: AttendancePinScheduleInput[] = []; let replay = false;
  const f = setup({ featureEnabled: () => true,
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => {
      calls.push(input);
      // Only models the business outcome. Independent assertions below prove
      // the actual route arguments, rather than a hardcoded error alone.
      if (!input.allowWrite) throw new MerchantAttendanceError("attendance_pin_schedule_disabled");
      if (!input.moduleEnabled && !replay) throw new MerchantAttendanceError("attendance_platform_paused");
      const result = wire(true); result.clock.replayed = replay; result.clock.canStart = false; return result;
    } });
  const fresh = await handleAttendancePinSchedule(post(body(true)), f.deps);
  assert.equal(fresh.status, 403); assert.deepEqual(await fresh.json(), { ok: false, error: "attendance_platform_paused" });
  assert.equal(calls.length, 1); assert.equal(calls[0].allowWrite, true); assert.equal(calls[0].moduleEnabled, false);
  assert.deepEqual(calls[0].command, command()); assert.deepEqual(calls[0].selection, selection);
  replay = true; const recovered = await handleAttendancePinSchedule(post(body(true)), f.deps);
  assert.equal(recovered.status, 200); const data = await recovered.json(); assert.equal(data.clock.replayed, true);
  assert.equal(data.moduleEnabled, false); assert.equal(data.selectionEnabled, false); assert.equal(data.adoption.status, "adopted");
  assert.equal(calls.length, 2); assert.equal(calls[1].allowWrite, true); assert.equal(calls[1].moduleEnabled, false);
  assert.deepEqual(calls[1].command, calls[0].command); assert.deepEqual(calls[1].selection, calls[0].selection);
});
test("feature off passes allowWrite false for every command including a known original number", async () => {
  for (const moduleEnabled of [true, false]) {
    const calls: AttendancePinScheduleInput[] = [];
    const f = setup({ featureEnabled: () => false,
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: moduleEnabled } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
      execute: async input => { calls.push(input); if (!input.allowWrite) throw new MerchantAttendanceError("attendance_pin_schedule_disabled"); return wire(true); } });
    const denied = await handleAttendancePinSchedule(post(body(true)), f.deps);
    assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { ok: false, error: "attendance_pin_schedule_disabled" });
    assert.equal(calls.length, 1); assert.equal(calls[0].allowWrite, false); assert.equal(calls[0].moduleEnabled, moduleEnabled);
    assert.equal(calls[0].command?.operationId, command().operationId); assert.deepEqual(calls[0].selection, selection);
  }
});
test("strict request rejects URL secrets, JSON duplication, injected authority and ambiguous selection", async () => {
  const f = setup();
  for (const request of [new Request(url + "?workerNo=PIN-01", post()), post({ ...body(), siteId }), post({ ...body(), verified: true }),
    post({ ...body(), lease: id(11) }), post({ ...body(), selection }), post({ ...body(true), selection: undefined }),
    post({ ...body(true), command: { ...command(), action: "clock_out" } }), post({ ...body(), pin: pin + "\n" }),
    new Request(url, { method: "POST", headers, body: JSON.stringify(body()).replace('"pin":', '"pin":"01738264","pin":') }),
    new Request(url, { method: "POST", headers, body: "{" })]) assert.equal((await handleAttendancePinSchedule(request, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("request streaming enforces 8 KiB, strict UTF-8/content type and no execute on malformed data", async () => {
  const f = setup();
  for (const [request, status] of [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "1e3" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers, body: " ".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: Uint8Array.of(123, 255, 125) }), 400],
  ] as const) assert.equal((await handleAttendancePinSchedule(request, f.deps)).status, status);
  assert.equal(f.calls.length, 0);
  const json = JSON.stringify(body()), bytes = new TextEncoder().encode(json + " ".repeat(8192 - new TextEncoder().encode(json).byteLength));
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 80)); c.enqueue(bytes.slice(80)); c.close(); } });
  const r = await handleAttendancePinSchedule(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps);
  assert.equal(r.status, 200); assert.equal(f.calls.length, 1);
});
test("body deadline and abort cancel input before PIN verification", async () => {
  let cancelled = 0; const f = setup({ bodyTimeoutMs: 15 });
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel() { cancelled++; } });
  const r = await handleAttendancePinSchedule(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), f.deps);
  assert.equal(r.status, 400); assert.equal(cancelled, 1);
  const abort = new AbortController(); abort.abort(); assert.equal((await handleAttendancePinSchedule(new Request(post(), { signal: abort.signal }), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("real unchanged scrypt verifies read/new action/recovery, forwards a false proof and lets SQL consume feature-off refusal", async () => withPepper(async () => {
  assert.deepEqual(PIN_SCRYPT_OPTIONS, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
  const salt = "35".repeat(16), binding = { siteId, workerId: command().expectedWorkerId, employeeId: command().expectedEmployeeId };
  const verifier = await deriveAttendancePin(pin, salt, binding);
  for (const mode of ["read", "write", "recover", "wrong", "disabled"] as const) {
    const calls: { name: string; args: Record<string, unknown> }[] = [], saved = wire(mode !== "read");
    if (mode === "recover") { saved.clock.canStart = false; saved.choices.entries = []; }
    const service: AttendanceSelfRpc = { rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "faolla_attendance_pin_begin_v1") return { data: { workerId: binding.workerId, employeeId: binding.employeeId, revision: 1, salt, verifier }, error: null };
      assert.equal(name, "faolla_attendance_pin_schedule_v1"); assert.equal(args.p_verified, mode !== "wrong");
      return { data: mode === "wrong" ? { error: "attendance_pin_denied" } : mode === "disabled" ? { error: "attendance_pin_schedule_disabled" } : saved, error: null };
    } };
    const input = { ...serviceInput(mode === "write" || mode === "wrong" || mode === "disabled"), ...(mode === "wrong" ? { pin: "01738265" } : {}),
      ...(mode === "recover" ? { operationId: command().operationId, moduleEnabled: false, allowWrite: false } : {}), ...(mode === "disabled" ? { allowWrite: false } : {}) };
    if (mode === "wrong" || mode === "disabled") await assert.rejects(executeAttendancePinSchedule(input, service), { code: mode === "wrong" ? "attendance_pin_denied" : "attendance_pin_schedule_disabled" });
    else if (mode === "write") {
      const f = setup({ execute: i => executeAttendancePinSchedule(i, service) }), r = await handleAttendancePinSchedule(post(body(true)), f.deps);
      assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, ...saved, moduleEnabled: true, selectionEnabled: true });
      assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("vary"), "Cookie"); assert.equal(r.headers.get("set-cookie"), null);
    } else assert.deepEqual(await executeAttendancePinSchedule(input, service), saved);
    assert.deepEqual(calls.map(c => c.name), ["faolla_attendance_pin_begin_v1", "faolla_attendance_pin_schedule_v1"]);
    const [begin, final] = calls.map(c => c.args); assert.equal(begin.p_allow, true); assert.equal(final.p_lease, begin.p_lease); assert.equal(final.p_secret_hash, terminalHash(secret));
    assert.equal(final.p_site, siteId); assert.equal(final.p_terminal, terminalId); assert.equal(final.p_allow_schedule, input.allowWrite);
    assert.equal(final.p_allow_new, input.moduleEnabled); assert.equal(final.p_bind_rules, false);
    assert.deepEqual(final.p_request, { command: input.command, operationId: input.operationId }); assert.deepEqual(final.p_selection, input.selection);
    for (const args of [begin, final]) for (const key of ["pin", "secret", "verifier", "salt", "authUserId"]) assert.equal(Object.hasOwn(args, key), false);
  }
}));
test("new service keeps original single-KDF admission gate; invalid options never reach RPC", async () => withPepper(async () => {
  let calls = 0; const rpc: AttendanceSelfRpc = { rpc: async () => { calls++; throw Error("unexpected"); } };
  await withAttendancePinKdf(async () => { await assert.rejects(executeAttendancePinSchedule(serviceInput(), rpc), { code: "attendance_pin_busy" }); });
  for (const input of [{ ...serviceInput(), siteId: siteId + "\n" }, { ...serviceInput(), terminalId: "not-uuid" },
    { ...serviceInput(), secret: "bad" }, { ...serviceInput(), moduleEnabled: undefined }, { ...serviceInput(), pin: pin + "\n" },
    { ...serviceInput(true), operationId: id(99) }, { ...serviceInput(), selection }])
    await assert.rejects(executeAttendancePinSchedule(input as AttendancePinScheduleInput, rpc), { code: "attendance_invalid_request" });
  assert.equal(calls, 0);
  await assert.rejects(executeAttendancePinSchedule(serviceInput(), null), { code: "attendance_unavailable" });
}));
test("safe error mapping and strict public reply refuse private fields without fallback or credential echo", async () => {
  for (const [error, status, expected] of [
    [new MerchantAttendanceError("attendance_operation_conflict"), 409, "attendance_operation_conflict"],
    [new MerchantAttendanceError("attendance_pin_schedule_invalid"), 503, "attendance_pin_schedule_invalid"],
    [new MerchantAttendanceError("constructor"), 503, "attendance_unavailable"],
    [Error("private " + pin + secret), 503, "attendance_unavailable"],
  ] as const) {
    let calls = 0; const r = await handleAttendancePinSchedule(post(), setup({ execute: async () => { calls++; throw error; } }).deps);
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: expected }); assert.equal(calls, 1);
  }
  for (const result of [{ ...wire(), verifier: "private" }, { ...wire(), clock: { ...wire().clock, pin } }, { ...wire(), data: wire() }]) {
    const r = await handleAttendancePinSchedule(post(), setup({ execute: async () => result }).deps);
    assert.equal(r.status, 503); const text = await r.text(); assert.ok(!text.includes(pin)); assert.ok(!text.includes(secret));
  }
});
