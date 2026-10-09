import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOperationalConsumerActivation, operationalConsumerActivationDependencies as defaults } from "../app/api/merchant-enterprise/attendance/operational-consumer-activation/route-handler";
import { executeOperationalConsumerActivation, operationalConsumerEnabled } from "./merchantAttendanceOperationalConsumerActivation.server";
import { operationalConsumerActivationQueryString, type OperationalConsumerActivationQuery, type OperationalConsumerActivationCommand } from "./merchantAttendanceOperationalConsumerActivation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import * as f from "./merchantAttendanceOperationalConsumerActivationTestFixtures";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/operational-consumer-activation", headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q: OperationalConsumerActivationQuery = f.activationQuery) => new Request(url + "?" + operationalConsumerActivationQueryString(q), { headers });
const post = (c: OperationalConsumerActivationCommand = f.activationCommand()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: f.activationQuery, command: c }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof defaults.execute>[0][] = []; let entitlements = 0;
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000, authenticate: async () => ({ user: { id: f.activationActor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => { entitlements++; return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof defaults.entitlement>>; },
    execute: async i => { calls.push(i); return i.command ? f.activationSaved(i.command) : f.activationResult(null, null, i.query.mode === "current" && i.allowActivate); }, ...patch }; return { deps, calls, entitlements: () => entitlements }; }
test("194 exact default-off flags and bounded allowlist", t => {
  const old = [process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED, process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS]; t.after(() => { for (const [i, key] of ["FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED", "FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS"].entries()) { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; } });
  process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED = "1"; for (const sites of ["", "*", "99990001 ", "99990001\n", Array(101).fill("99990001").join(",")]) { process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS = sites; assert.equal(operationalConsumerEnabled(f.activationSite), false); }
  process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS = f.activationSite; assert.equal(operationalConsumerEnabled(f.activationSite), true); process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED = "true"; assert.equal(operationalConsumerEnabled(f.activationSite), false);
});
test("198 activation is isolated to review_routing flag and never enables future consumers", t => {
  const keys = ["FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED", "FAOLLA_ATTENDANCE_REVIEW_ROUTING_SITE_IDS"], saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }));
  process.env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_SITE_IDS = f.activationSite;
  assert.equal(operationalConsumerEnabled(f.activationSite, "review_routing"), true);
  for (const consumer of ["timesheet_cycle", "reminders"]) assert.equal(operationalConsumerEnabled(f.activationSite, consumer), false);
  for (const value of ["", "*", f.activationSite + "," + f.activationSite, f.activationSite + " "]) { process.env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_SITE_IDS = value; assert.equal(operationalConsumerEnabled(f.activationSite, "review_routing"), false); }
  process.env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_SITE_IDS = f.activationSite; process.env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED = "true"; assert.equal(operationalConsumerEnabled(f.activationSite, "review_routing"), false);
});
test("194 safe current/deactivate/recover bypass eligibility but preserve actual actor SQL calls", async () => {
  const x = setup({ enabled: () => false }); for (const request of [get(), get({ siteId: f.activationSite, consumer: "application_window", mode: "recover", operationId: f.activationId(10) }), post(f.activationCommand("deactivate", 1))]) assert.equal((await handleOperationalConsumerActivation(request, x.deps)).status, 200);
  assert.equal(x.entitlements(), 0); assert.ok(x.calls.every(i => i.authUserId === f.activationActor && !i.allowActivate));
  const y = setup({ enabled: () => false, execute: async i => { assert.equal(i.allowActivate, false); throw new MerchantAttendanceError("attendance_operational_consumer_disabled"); } }); assert.equal((await handleOperationalConsumerActivation(post(), y.deps)).status, 403);
});
test("194 canonical origin/password/rate guards reject before any RPC", async () => {
  const x = setup(); for (const request of [new Request(url, { method: "DELETE" }), new Request(get(), { headers: { ...headers, origin: "https://evil.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.notEqual((await handleOperationalConsumerActivation(request, x.deps)).status, 200);
  for (const authenticationMethods of [[], ["invite"], ["password", "recovery"]]) assert.equal((await handleOperationalConsumerActivation(get(), { ...x.deps, authenticate: async () => ({ user: { id: f.activationActor } as User, accessToken: "synthetic", authenticationMethods }) })).status, 403);
  assert.equal((await handleOperationalConsumerActivation(get(), { ...x.deps, allow: () => false })).status, 429); assert.equal(x.calls.length, 0);
});
test("194 body streaming deadline, duplicate keys, UTF8 limit and GET-only recovery", async () => {
  const x = setup({ bodyTimeoutMs: 15 }), body = JSON.stringify({ query: f.activationQuery, command: f.activationCommand() });
  for (const value of [body.replace('"reason":', '"reason":"duplicate","reason":'), "{", JSON.stringify({ query: { siteId: f.activationSite, consumer: "application_window", mode: "recover", operationId: f.activationId(10) }, command: f.activationCommand() })]) assert.equal((await handleOperationalConsumerActivation(new Request(url, { method: "POST", headers, body: value }), x.deps)).status, 400);
  assert.equal((await handleOperationalConsumerActivation(new Request(url, { method: "POST", headers, body: "中".repeat(3000) }), x.deps)).status, 422);
  let canceled = false; const stream = new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } }); assert.equal((await handleOperationalConsumerActivation(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), x.deps)).status, 400); assert.equal(canceled, true); assert.equal(x.calls.length, 0);
});
test("194 actual route-service invokes exact RPC once and validates saved receipt", async () => {
  const calls: unknown[] = [], x = setup({ execute: i => executeOperationalConsumerActivation(i, { rpc: async (name, args) => { calls.push({ name, args }); return { data: await f.activationSaved(i.command!), error: null }; } }) });
  const result = await handleOperationalConsumerActivation(post(), x.deps); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.deepEqual(calls, [{ name: "faolla_attendance_operational_consumer_activation_v1", args: { p_query: f.activationQuery, p_auth_user_id: f.activationActor, p_command: f.activationCommand(), p_allow_activate: true } }]);
});
test("198 current activation forwards true gate only for implemented review_routing and retains original receipt", async () => {
  const query = { ...f.activationQuery, consumer: "review_routing" as const }, command = { ...f.activationCommand(), consumer: "review_routing" as const }, calls: Record<string, unknown>[] = [];
  const x = setup({ execute: i => executeOperationalConsumerActivation(i, { rpc: async (_name, args) => { calls.push(args ?? {}); return { data: { ...await f.activationSaved(command), consumer: "review_routing" }, error: null }; } }) });
  const response = await handleOperationalConsumerActivation(new Request(url, { method: "POST", headers, body: JSON.stringify({ query, command }) }), x.deps);
  assert.equal(response.status, 200); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { p_query: query, p_auth_user_id: f.activationActor, p_command: command, p_allow_activate: true });
  for (const consumer of ["reminders"] as const) {
    await executeOperationalConsumerActivation({ query: { ...query, consumer }, command: null, authUserId: f.activationActor, allowActivate: false }, { rpc: async (_name, args) => { assert.equal(args?.p_allow_activate, false); return { data: { ...f.activationResult(null, null, false), consumer }, error: null }; } });
  }
});

test("201 reminder activation reuses the exact default-off common64-site gate, never runner or another consumer flag", t => {
  const keys = ["FAOLLA_ATTENDANCE_REMINDERS_ENABLED", "FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS", "FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED", "FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS"], saved = keys.map(k => process.env[k]);
  t.after(() => keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }));
  keys.forEach(k => { delete process.env[k]; }); assert.equal(operationalConsumerEnabled(f.activationSite, "reminders"), false);
  process.env[keys[2]] = "1"; process.env[keys[3]] = f.activationSite; assert.equal(operationalConsumerEnabled(f.activationSite, "reminders"), false);
  process.env[keys[0]] = "1";
  for (const sites of ["", "*", f.activationSite + " ", f.activationSite + "\n", f.activationSite + "," + f.activationSite,
    Array.from({ length: 65 }, (_, n) => String(99990001 + n)).join(",")]) {
    process.env[keys[1]] = sites; assert.equal(operationalConsumerEnabled(f.activationSite, "reminders"), false);
  }
  process.env[keys[1]] = Array.from({ length: 64 }, (_, n) => String(99990001 + n)).join(","); process.env[keys[2]] = "0";
  assert.equal(operationalConsumerEnabled(f.activationSite, "reminders"), true); assert.equal(operationalConsumerEnabled("99980000", "reminders"), false);
  assert.equal(operationalConsumerEnabled(f.activationSite, "unknown"), false); process.env[keys[0]] = "true"; assert.equal(operationalConsumerEnabled(f.activationSite, "reminders"), false);
});

test("201 actual reminder activation HTTP-to-service sends the exact literal once with real Auth and entitlement gate", async () => {
  const query = { ...f.activationQuery, consumer: "reminders" as const }, command = { ...f.activationCommand(), consumer: "reminders" as const }, calls: unknown[] = [];
  const x = setup({ execute: input => executeOperationalConsumerActivation(input, { rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { ...await f.activationSaved(command), consumer: "reminders" }, error: null }; } }) });
  const response = await handleOperationalConsumerActivation(new Request(url, { method: "POST", headers, body: JSON.stringify({ query, command }) }), x.deps);
  assert.equal(response.status, 200); assert.equal(x.entitlements(), 1); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [{ name: "faolla_attendance_operational_consumer_activation_v1", args: { p_query: query, p_auth_user_id: f.activationActor, p_command: command, p_allow_activate: true } }]);
  await assert.rejects(executeOperationalConsumerActivation({ query, command: null, authUserId: f.activationActor, allowActivate: false }, { rpc: async () => ({ data: { ...f.activationResult(), consumer: "reminders" }, error: null }) }), /attendance_operational_consumer_invalid/);
});

test("201 reminder flagoff current, safe deactivate and original GET need no new eligibility, but cannot activate", async () => {
  const query = { ...f.activationQuery, consumer: "reminders" as const }, activate = { ...f.activationCommand(), consumer: "reminders" as const },
    deactivate = { ...f.activationCommand("deactivate", 1), consumer: "reminders" as const }, current = await f.activationItem(activate), calls: Record<string, unknown>[] = [];
  const x = setup({ enabled: () => false, execute: input => executeOperationalConsumerActivation(input, { rpc: async (_name, args) => {
    calls.push(args ?? {}); assert.equal(args?.p_allow_activate, false);
    if (input.command?.action === "activate") return { data: null, error: { message: "attendance_operational_consumer_disabled" } };
    const data = input.command ? await f.activationSaved(input.command) : input.query.mode === "recover"
      ? f.activationResult(null, current, false) : { ...f.activationResult(current, null, false), canDeactivate: true };
    return { data: { ...data, consumer: "reminders" }, error: null }; } }) });
  const request = (command: OperationalConsumerActivationCommand) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query, command }) });
  assert.equal((await handleOperationalConsumerActivation(get(query), x.deps)).status, 200);
  assert.equal((await handleOperationalConsumerActivation(request(deactivate), x.deps)).status, 200);
  assert.equal((await handleOperationalConsumerActivation(get({ ...query, mode: "recover", operationId: activate.operationId }), x.deps)).status, 200);
  assert.equal((await handleOperationalConsumerActivation(request(activate), x.deps)).status, 403);
  assert.equal(x.entitlements(), 0); assert.equal(calls.length, 4); assert(calls.every(c => c.p_auth_user_id === f.activationActor));
  const before = calls.length; assert.equal((await handleOperationalConsumerActivation(get(query), { ...x.deps, authenticate: async () => ({ user: { id: f.activationActor } as User, accessToken: "synthetic", authenticationMethods: ["magiclink"] }) })).status, 403);
  assert.equal(calls.length, before);
});

test("200 cycle activation has its own exact default-off gate and actual service literal; reminders stays off", async t => {
  const keys = ["FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED", "FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_SITE_IDS"], saved = keys.map(k => process.env[k]);
  t.after(() => keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }));
  delete process.env[keys[0]]; delete process.env[keys[1]]; assert.equal(operationalConsumerEnabled(f.activationSite, "timesheet_cycle"), false);
  process.env[keys[0]] = "1"; process.env[keys[1]] = f.activationSite; assert.equal(operationalConsumerEnabled(f.activationSite, "timesheet_cycle"), true);
  assert.equal(operationalConsumerEnabled(f.activationSite, "reminders"), false);
  const query = { ...f.activationQuery, consumer: "timesheet_cycle" as const };
  await executeOperationalConsumerActivation({ query, command: null, authUserId: f.activationActor, allowActivate: true }, { rpc: async (_name, args) => {
    assert.equal(args?.p_allow_activate, true); return { data: { ...f.activationResult(), consumer: "timesheet_cycle" }, error: null }; } });
});
test("194 service redacts arbitrary errors and rejects bad saved hash/false-flag authority", async () => {
  const input = { query: f.activationQuery, command: f.activationCommand(), authUserId: f.activationActor, allowActivate: true }, saved = await f.activationSaved();
  for (const data of [{ ...saved, actorId: f.activationId(99) }, { ...saved, receipt: { ...saved.receipt!, commandFingerprint: "a".repeat(64) } }]) await assert.rejects(executeOperationalConsumerActivation(input, { rpc: async () => ({ data, error: null }) }), /attendance_operational_consumer_invalid/);
  await assert.rejects(executeOperationalConsumerActivation(input, { rpc: async () => ({ data: null, error: { message: "private database error" } }) }), /attendance_operational_consumer_invalid/);
  await assert.rejects(executeOperationalConsumerActivation({ ...input, command: null, allowActivate: false }, { rpc: async () => ({ data: f.activationResult(), error: null }) }), /attendance_operational_consumer_invalid/);
});


