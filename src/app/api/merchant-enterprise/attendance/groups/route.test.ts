import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { executeGroups } from "@/lib/merchantAttendanceGroups.server";
import type { GroupsResult } from "@/lib/merchantAttendanceGroups";
import { handleGroups, groupsDependencies } from "./route-handler";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/groups";
const query = { siteId: "99990001", view: "context" as const, groupId: null, workerId: null, onDate: null, assignmentId: null, operationId: null, cursorId: null };
const command = { operationId: id(501), action: "save_group" as const, groupId: id(501), expectedRevision: 0, name: "Morning team", description: "", active: true, reason: "Create group" };
const result = (): GroupsResult => ({ protocol: "groups-v1", siteId: query.siteId, actorId: id(99), settingsVersion: 1,
  timeZone: "Europe/Madrid", view: "context", group: null, worker: null, items: [], nextCursor: null, detail: null, receipt: null });
const get = () => new Request(`${url}?siteId=99990001&view=context`);
const post = (body: unknown = { query, command }) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(patch: Partial<typeof groupsDependencies> = {}) {
  const calls: Parameters<typeof groupsDependencies.execute>[0][] = [];
  const deps: typeof groupsDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof groupsDependencies.entitlement>>,
    execute: async input => { calls.push(input); return result(); }, ...patch };
  return { deps, calls };
}

test("groups remains default-off and rejects unsupported methods and noncanonical/cross-origin requests before authentication", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED; else process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED = previous; });
  delete process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED; assert.equal(groupsDependencies.enabled(), false);
  let authenticated = 0; const f = setup({ enabled: groupsDependencies.enabled, authenticate: async () => { authenticated++; throw Error("unexpected authentication"); } });
  assert.equal((await handleGroups(get(), f.deps)).status, 404);
  process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED = "true"; assert.equal(groupsDependencies.enabled(), false);
  process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED = "1"; assert.equal(groupsDependencies.enabled(), true);
  assert.equal((await handleGroups(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
  assert.equal((await handleGroups(new Request(get().url.replace("www.", "merchant.")), f.deps)).status, 403);
  const foreign = post(); foreign.headers.set("origin", "https://evil.invalid");
  assert.equal((await handleGroups(foreign, f.deps)).status, 403); assert.equal(authenticated, 0);
});

test("normal password/OAuth sessions pass authenticated identity; weak sessions and service-verified nonowners cannot read or write", async () => {
  for (const methods of [["password"], ["oauth"], [], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const valid = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    for (const request of [get(), post()]) assert.equal((await handleGroups(request, f.deps)).status, valid ? 200 : 403);
    assert.equal(f.calls.length, valid ? 2 : 0); if (valid) assert.ok(f.calls.every(call => call.authUserId === id(99)));
  }
  const nonOwner = setup({ execute: async () => { throw new MerchantAttendanceError("attendance_access_denied"); } });
  for (const request of [get(), post()]) {
    const response = await handleGroups(request, nonOwner.deps); assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_access_denied" });
  }
});

test("current entitlement exclusively controls new write authority while paused reads/replays remain no-store", async () => {
  const sites: string[] = [], f = setup({ entitlement: async site => { sites.push(site);
    return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof groupsDependencies.entitlement>>;
  } });
  const response = await handleGroups(get(), f.deps); assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  await handleGroups(post(), f.deps); assert.deepEqual(f.calls.map(call => call.allowWrite), [false, false]); assert.deepEqual(sites, [query.siteId, query.siteId]);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary")!, /Authorization/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleGroups(post(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});

test("exact DTO, context scope, duplicated query fields, JSON content type and body size are enforced before RPC", async () => {
  const f = setup();
  for (const body of [{ query, command, allowWrite: true }, { query, command, authUserId: id(99) }, { query, command: { ...command, ownerId: id(99) } },
    { query: { ...query, view: ["context"] }, command }, { query: { ...query, groupId: id(501) }, command },
    { query: { ...query, operationId: id(501) }, command }, { query: { ...query, workerId: id(201) }, command },
    { query, command: { ...command, clockRules: {} } }]) assert.equal((await handleGroups(post(body), f.deps)).status, 400);
  assert.equal((await handleGroups(new Request(get().url + "&view=groups"), f.deps)).status, 400);
  assert.equal((await handleGroups(new Request(get().url + "&ownerId=" + id(99)), f.deps)).status, 400);
  assert.equal((await handleGroups(new Request(url + "?extra=1", post()), f.deps)).status, 400);
  const wrong = post(); wrong.headers.set("content-type", "text/plain"); assert.equal((await handleGroups(wrong, f.deps)).status, 415);
  assert.equal((await handleGroups(post({ query, command, huge: "x".repeat(5000) }), f.deps)).status, 413); assert.equal(f.calls.length, 0);
});

test("bad group date labels, impossible zone endpoints and invalid versions fail as 400 without entering execution", async () => {
  const f = setup(), assign = { operationId: id(601), action: "assign", reason: "Join", groupId: id(501), workerId: id(201),
    expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone: "Europe/Madrid", startsOn: "2026-10-01", endsOn: null };
  const selected = { ...query, groupId: id(501), workerId: id(201) };
  for (const patch of [{ startsOn: "2026-02-30" }, { endsOn: "2026-09-30" }, { startsOn: "1999-12-31" }, { timeZone: "Bad/Zone" },
    { startsOn: "2011-12-30", timeZone: "Pacific/Apia" }, { expectedSettingsVersion: 0 }]) {
    const response = await handleGroups(post({ query: selected, command: { ...assign, ...patch } }), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  const badDate = new Request(`${url}?siteId=99990001&view=members&groupId=${id(501)}&onDate=2026-02-30`);
  assert.equal((await handleGroups(badDate, f.deps)).status, 400); assert.equal(f.calls.length, 0);
});

test("rate limiting binds the authenticated owner and typed group errors preserve status without leaking database details", async () => {
  const actors: string[] = [], f = setup({ allow: actor => { actors.push(actor); return false; } });
  const limited = await handleGroups(post(), f.deps); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(actors, [id(99)]); assert.equal(f.calls.length, 0);
  for (const [code, status] of [["attendance_group_closed", 409], ["attendance_group_overlap", 409], ["attendance_group_inactive", 409],
    ["attendance_group_worker_inactive", 409], ["attendance_operation_conflict", 409], ["attendance_platform_paused", 403],
    ["attendance_group_not_found", 404], ["attendance_group_invalid", 503]] as const) {
    const rejected = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleGroups(post(), rejected.deps); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  const broken = setup({ execute: async () => { throw Error("private database details"); } });
  const response = await handleGroups(get(), broken.deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
});

test("the server calls only the new groups RPC with authenticated identity and write gate and refuses malformed/foreign output", async () => {
  const input = { query, command: null, authUserId: id(99), allowWrite: false };
  assert.deepEqual(await executeGroups(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_groups_v1"); assert.deepEqual(args, { p_query: query, p_auth_user_id: id(99), p_command: null, p_allow_write: false });
    return { data: result(), error: null };
  } }), result());
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { view: "groups" }, { privateData: "not allowed" }])
    await assert.rejects(executeGroups(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeGroups({ ...input, command }, { rpc: async () => ({ data: result(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeGroups(input, null), /attendance_unavailable/);
  for (const code of ["attendance_access_denied", "attendance_version_conflict", "attendance_operation_conflict", "private SQL detail"])
    await assert.rejects(executeGroups(input, { rpc: async () => ({ data: null, error: { message: code } }) }), new RegExp(code.startsWith("attendance_") ? code : "attendance_unavailable"));
  await assert.rejects(executeGroups(input, { rpc: async () => { throw Error("private connection details"); } }), /attendance_unavailable/);
});
