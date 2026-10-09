import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { executeCalendar } from "@/lib/merchantAttendanceCalendar.server";
import type { CalendarResult } from "@/lib/merchantAttendanceCalendar";
import { handleCalendar, calendarDependencies } from "./route-handler";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/calendar";
const query = { siteId: "99990001", locationId: null, fromDate: null, throughDate: null, entryId: null, operationId: null, beforeAt: null, beforeId: null };
const command = { operationId: id(501), action: "create" as const, reason: "Manual calendar notice", kind: "holiday" as const, title: "Local holiday",
  fromDate: "2026-10-05", throughDate: "2026-10-06", expectedSettingsVersion: 1, locationId: null, expectedLocationVersion: null, timeZone: "Europe/Madrid" };
const result = (): CalendarResult => ({ protocol: "calendar-v1", siteId: query.siteId, actorId: id(99), settingsVersion: 1,
  locationId: null, locationName: null, locationVersion: null, timeZone: "Europe/Madrid", canCreate: true, items: [], nextCursor: null, detail: null, receipt: null });
const get = () => new Request(`${url}?siteId=99990001`);
const post = (body: unknown = { query, command }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(patch: Partial<typeof calendarDependencies> = {}) {
  const calls: Parameters<typeof calendarDependencies.execute>[0][] = [];
  const deps: typeof calendarDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof calendarDependencies.entitlement>>,
    execute: async input => { calls.push(input); return result(); }, ...patch };
  return { deps, calls };
}

test("calendar is default-off and rejects unsupported methods and noncanonical/cross-origin requests before auth", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_CALENDAR_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_CALENDAR_ENABLED; else process.env.FAOLLA_ATTENDANCE_CALENDAR_ENABLED = previous; });
  delete process.env.FAOLLA_ATTENDANCE_CALENDAR_ENABLED; assert.equal(calendarDependencies.enabled(), false);
  let authenticated = 0; const f = setup({ enabled: calendarDependencies.enabled, authenticate: async () => { authenticated++; throw Error("unexpected authentication"); } });
  assert.equal((await handleCalendar(get(), f.deps)).status, 404);
  process.env.FAOLLA_ATTENDANCE_CALENDAR_ENABLED = "true"; assert.equal(calendarDependencies.enabled(), false);
  process.env.FAOLLA_ATTENDANCE_CALENDAR_ENABLED = "1"; assert.equal(calendarDependencies.enabled(), true);
  assert.equal((await handleCalendar(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  assert.equal((await handleCalendar(new Request(get().url.replace("www.", "merchant.")), f.deps)).status, 403);
  const foreign = post(); foreign.headers.set("origin", "https://evil.invalid");
  assert.equal((await handleCalendar(foreign, f.deps)).status, 403); assert.equal(authenticated, 0);
});

test("ordinary password/OAuth sessions bind authenticated identity while invitation, recovery and missing assurance cannot read or write", async () => {
  for (const methods of [["password"], ["oauth"], [], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const valid = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    for (const request of [get(), post()]) assert.equal((await handleCalendar(request, f.deps)).status, valid ? 200 : 403);
    assert.equal(f.calls.length, valid ? 2 : 0); if (valid) assert.ok(f.calls.every(call => call.authUserId === id(99)));
  }
  const nonOwner = setup({ execute: async () => { throw new MerchantAttendanceError("attendance_access_denied"); } });
  for (const request of [get(), post()]) {
    const response = await handleCalendar(request, nonOwner.deps); assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_access_denied" });
  }
});

test("fresh platform entitlement alone controls allowWrite and paused context/recovery never grant write authority", async () => {
  const sites: string[] = [], f = setup({ entitlement: async site => { sites.push(site);
    return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof calendarDependencies.entitlement>>;
  } });
  const response = await handleCalendar(get(), f.deps); assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  await handleCalendar(post(), f.deps); assert.deepEqual(f.calls.map(call => call.allowWrite), [false, false]); assert.deepEqual(sites, [query.siteId, query.siteId]);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary")!, /Authorization/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleCalendar(post(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});

test("exact single-scope query and command authority, duplicates, content type and body size are rejected before RPC", async () => {
  const f = setup();
  for (const body of [{ query, command, allowWrite: true }, { query, command, authUserId: id(99) }, { query, command: { ...command, ownerId: id(99) } },
    { query: { ...query, locationId: id(201) }, command }, { query: { ...query, operationId: id(501) }, command },
    { query: { ...query, locationIds: [id(201), id(202)] }, command }, { query, command: { ...command, payroll: true } }])
    assert.equal((await handleCalendar(post(body), f.deps)).status, 400);
  assert.equal((await handleCalendar(new Request(get().url + "&siteId=99990001"), f.deps)).status, 400);
  assert.equal((await handleCalendar(new Request(get().url + "&ownerId=" + id(99)), f.deps)).status, 400);
  assert.equal((await handleCalendar(new Request(url + "?extra=1", post()), f.deps)).status, 400);
  const wrong = post(); wrong.headers.set("content-type", "text/plain"); assert.equal((await handleCalendar(wrong, f.deps)).status, 415);
  assert.equal((await handleCalendar(post({ query, command, huge: "x".repeat(5000) }), f.deps)).status, 413);
  assert.equal(f.calls.length, 0);
});

test("bad dates, impossible cursor instants, too-long ranges and unknown IANA zones are 400, never private server failures", async () => {
  const f = setup();
  for (const patch of [{ fromDate: "2026-02-30" }, { throughDate: "2026-13-05" }, { fromDate: "not-a-date" },
    { fromDate: "2026-01-01", throughDate: "2027-01-02" }, { timeZone: "Bad/Zone" },
    { fromDate: "2011-12-30", throughDate: "2011-12-30", timeZone: "Pacific/Apia" }]) {
    const response = await handleCalendar(post({ query, command: { ...command, ...patch } }), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  for (const suffix of ["&fromDate=2026-02-30&throughDate=2026-03-01",
    "&fromDate=2026-10-01&throughDate=2026-10-31&beforeAt=2026-02-30T09%3A00%3A00.123456Z&beforeId=" + id(501)]) {
    const response = await handleCalendar(new Request(get().url + suffix), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  assert.equal(f.calls.length, 0);
});

test("limiting keys on authenticated identity and only typed calendar failures expose their bounded error codes", async () => {
  const actors: string[] = [], f = setup({ allow: actor => { actors.push(actor); return false; } });
  const limited = await handleCalendar(post(), f.deps); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(actors, [id(99)]); assert.equal(f.calls.length, 0);
  for (const [code, status] of [["attendance_calendar_closed", 409], ["attendance_calendar_location_inactive", 409], ["attendance_platform_paused", 403],
    ["attendance_calendar_not_found", 404], ["attendance_calendar_invalid", 503]] as const) {
    const rejected = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleCalendar(post(), rejected.deps); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  const broken = setup({ execute: async () => { throw Error("private database details"); } });
  const response = await handleCalendar(get(), broken.deps); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
});

test("server uses only the new calendar RPC with authenticated owner and explicit write gate, validating every result identity", async () => {
  const input = { query, command: null, authUserId: id(99), allowWrite: false };
  assert.deepEqual(await executeCalendar(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_calendar_v1");
    assert.deepEqual(args, { p_query: query, p_auth_user_id: id(99), p_command: null, p_allow_write: false });
    return { data: result(), error: null };
  } }), result());
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { locationId: id(201) }, { privateData: "not allowed" }])
    await assert.rejects(executeCalendar(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeCalendar({ ...input, command }, { rpc: async () => ({ data: result(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeCalendar(input, null), /attendance_unavailable/);
  for (const code of ["attendance_access_denied", "attendance_version_conflict", "attendance_calendar_location_inactive", "private SQL detail"])
    await assert.rejects(executeCalendar(input, { rpc: async () => ({ data: null, error: { message: code } }) }),
      new RegExp(code.startsWith("attendance_") ? code : "attendance_unavailable"));
  await assert.rejects(executeCalendar(input, { rpc: async () => { throw Error("private connection details"); } }), /attendance_unavailable/);
});
