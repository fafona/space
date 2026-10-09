import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOperationalPunchActivation, operationalPunchActivationDependencies as defaults } from "../app/api/merchant-enterprise/attendance/operational-punch-activation/route-handler";
import { executeOperationalPunchActivation, operationalPunchEnabled } from "./merchantAttendanceOperationalPunchActivation.server";
import { operationalPunchActivationQueryString, type OperationalPunchActivationQuery, type OperationalPunchActivationCommand } from "./merchantAttendanceOperationalPunchActivation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import * as f from "./merchantAttendanceOperationalPunchActivationTestFixtures";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/operational-punch-activation", headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q: OperationalPunchActivationQuery = f.activationQuery) => new Request(url + "?" + operationalPunchActivationQueryString(q), { headers });
const post = (c: OperationalPunchActivationCommand = f.activationCommand()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: f.activationQuery, command: c }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof defaults.execute>[0][] = []; let entitlements = 0;
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000, authenticate: async () => ({ user: { id: f.activationActor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => { entitlements++; return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof defaults.entitlement>>; },
    execute: async i => { calls.push(i); return i.command ? f.activationSaved(i.command) : f.activationResult(null, null, i.query.mode === "current" && i.allowActivate); }, ...patch }; return { deps, calls, entitlements: () => entitlements }; }
test("242 exact default-off flags and bounded allowlist", t => {
  const old = [process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED, process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_SITE_IDS]; t.after(() => { for (const [i, key] of ["FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED", "FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_SITE_IDS"].entries()) { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; } });
  process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED = "1"; for (const sites of ["", "*", "99990001 ", "99990001\n", Array(101).fill("99990001").join(",")]) { process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_SITE_IDS = sites; assert.equal(operationalPunchEnabled(f.activationSite), false); }
  process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_SITE_IDS = f.activationSite; assert.equal(operationalPunchEnabled(f.activationSite), true); process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED = "true"; assert.equal(operationalPunchEnabled(f.activationSite), false);
});
test("242 safe current/deactivate/recover bypass eligibility but preserve actual actor SQL calls", async () => {
  const x = setup({ enabled: () => false }); for (const request of [get(), get({ siteId: f.activationSite, mode: "recover", operationId: f.activationId(10) }), post(f.activationCommand("deactivate", 1))]) assert.equal((await handleOperationalPunchActivation(request, x.deps)).status, 200);
  assert.equal(x.entitlements(), 0); assert.ok(x.calls.every(i => i.authUserId === f.activationActor && !i.allowActivate));
  const y = setup({ enabled: () => false, execute: async i => { assert.equal(i.allowActivate, false); throw new MerchantAttendanceError("attendance_operational_punch_disabled"); } }); assert.equal((await handleOperationalPunchActivation(post(), y.deps)).status, 403);
});
test("242 canonical origin/password/rate guards reject before any RPC", async () => {
  const x = setup(); for (const request of [new Request(url, { method: "DELETE" }), new Request(get(), { headers: { ...headers, origin: "https://evil.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.notEqual((await handleOperationalPunchActivation(request, x.deps)).status, 200);
  for (const authenticationMethods of [[], ["invite"], ["password", "recovery"]]) assert.equal((await handleOperationalPunchActivation(get(), { ...x.deps, authenticate: async () => ({ user: { id: f.activationActor } as User, accessToken: "synthetic", authenticationMethods }) })).status, 403);
  assert.equal((await handleOperationalPunchActivation(get(), { ...x.deps, allow: () => false })).status, 429); assert.equal(x.calls.length, 0);
});
test("242 body streaming deadline, duplicate keys, UTF8 limit and GET-only recovery", async () => {
  const x = setup({ bodyTimeoutMs: 15 }), body = JSON.stringify({ query: f.activationQuery, command: f.activationCommand() });
  for (const value of [body.replace('"reason":', '"reason":"duplicate","reason":'), "{", JSON.stringify({ query: { siteId: f.activationSite, mode: "recover", operationId: f.activationId(10) }, command: f.activationCommand() })]) assert.equal((await handleOperationalPunchActivation(new Request(url, { method: "POST", headers, body: value }), x.deps)).status, 400);
  assert.equal((await handleOperationalPunchActivation(new Request(url, { method: "POST", headers, body: "中".repeat(3000) }), x.deps)).status, 422);
  let canceled = false; const stream = new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } }); assert.equal((await handleOperationalPunchActivation(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), x.deps)).status, 400); assert.equal(canceled, true); assert.equal(x.calls.length, 0);
});
test("242 actual route-service invokes exact RPC once and validates saved receipt", async () => {
  const calls: unknown[] = [], x = setup({ execute: i => executeOperationalPunchActivation(i, { rpc: async (name, args) => { calls.push({ name, args }); return { data: await f.activationSaved(i.command!), error: null }; } }) });
  const result = await handleOperationalPunchActivation(post(), x.deps); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.deepEqual(calls, [{ name: "faolla_attendance_operational_punch_activation_v1", args: { p_query: f.activationQuery, p_auth_user_id: f.activationActor, p_command: f.activationCommand(), p_allow_activate: true } }]);
});
test("242 service redacts arbitrary errors and rejects bad saved hash/false-flag authority", async () => {
  const input = { query: f.activationQuery, command: f.activationCommand(), authUserId: f.activationActor, allowActivate: true }, saved = await f.activationSaved();
  for (const data of [{ ...saved, actorId: f.activationId(99) }, { ...saved, receipt: { ...saved.receipt!, commandFingerprint: "a".repeat(64) } }]) await assert.rejects(executeOperationalPunchActivation(input, { rpc: async () => ({ data, error: null }) }), /attendance_operational_punch_invalid/);
  await assert.rejects(executeOperationalPunchActivation(input, { rpc: async () => ({ data: null, error: { message: "private database error" } }) }), /attendance_operational_punch_invalid/);
  await assert.rejects(executeOperationalPunchActivation({ ...input, command: null, allowActivate: false }, { rpc: async () => ({ data: f.activationResult(), error: null }) }), /attendance_operational_punch_invalid/);
});
