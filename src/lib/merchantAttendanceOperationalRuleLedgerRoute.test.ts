import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOperationalRuleLedger, operationalRuleLedgerDependencies as defaults, operationalRuleLedgerEnabled } from "../app/api/merchant-enterprise/attendance/operational-rules/route-handler";
import { executeOperationalRuleLedger } from "./merchantAttendanceOperationalRuleLedger.server";
import { operationalRuleLedgerQueryString, type OperationalRuleLedgerQuery, type OperationalRuleLedgerCommand } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import * as f from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/operational-rules", headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const get = (q: OperationalRuleLedgerQuery = f.operationalRuleLedgerQuery()) => new Request(url + "?" + operationalRuleLedgerQueryString(q), { headers });
const post = (c: OperationalRuleLedgerCommand = f.operationalRuleLedgerSaveCommand()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: f.operationalRuleLedgerQuery(c.scope), command: c }) });
function setup(patch: Partial<typeof defaults> = {}) { const calls: Parameters<typeof defaults.execute>[0][] = []; let entitlements = 0;
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 12000, authenticate: async () => ({ user: { id: f.operationalRuleLedgerActor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => { entitlements++; return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof defaults.entitlement>>; },
    execute: async i => { calls.push(i); if (i.command) return f.operationalRuleLedgerReceiptResult(i.command); const r = i.query.mode === "recover" ? f.operationalRuleLedgerResult({ kind: "receipt" }, false) : await f.operationalRuleLedgerDetail(); return { ...r, canWrite: i.allowWrite && r.canWrite }; }, ...patch }; return { deps, calls, entitlements: () => entitlements }; }
test("240 route requires both strict flag and bounded exact site allowlist for new eligibility", t => {
  const oldFlag = process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED, oldSites = process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_SITE_IDS; t.after(() => { if (oldFlag === undefined) delete process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED; else process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED = oldFlag; if (oldSites === undefined) delete process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_SITE_IDS; else process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_SITE_IDS = oldSites; });
  process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED = "1"; for (const ids of ["", "*", "99990001 ", "99990001\n", "99990001,99990002\n", "99990002"]) { process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_SITE_IDS = ids; assert.equal(operationalRuleLedgerEnabled(f.operationalRuleLedgerSite), false); }
  process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_SITE_IDS = f.operationalRuleLedgerSite; assert.equal(operationalRuleLedgerEnabled(f.operationalRuleLedgerSite), true); process.env.FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED = "true"; assert.equal(operationalRuleLedgerEnabled(f.operationalRuleLedgerSite), false);
});
test("240 flag-off exact POST replay reaches SQL once with false; fresh rejection remains SQL-owned", async () => {
  const x = setup({ enabled: () => false }); assert.equal((await handleOperationalRuleLedger(post(), x.deps)).status, 200); assert.equal(x.calls.length, 1); assert.equal(x.calls[0].allowWrite, false); assert.equal(x.entitlements(), 0);
  const y = setup({ enabled: () => false, execute: async i => { assert.equal(i.allowWrite, false); throw new MerchantAttendanceError("attendance_operational_rule_disabled"); } }); assert.equal((await handleOperationalRuleLedger(post(), y.deps)).status, 403);
  const z = setup({ entitlement: async () => { throw Error("eligibility unavailable"); } }); assert.equal((await handleOperationalRuleLedger(post(), z.deps)).status, 200); assert.equal(z.calls[0].allowWrite, false);
});
test("240 safe detail and original actor recovery survive disabled eligibility without implying owner", async () => {
  const x = setup({ enabled: () => false }); assert.equal((await handleOperationalRuleLedger(get(), x.deps)).status, 200); assert.equal(x.calls[0].allowWrite, false);
  assert.equal((await handleOperationalRuleLedger(get({ siteId: f.operationalRuleLedgerSite, mode: "recover", operationId: f.operationalRuleLedgerId(20) }), x.deps)).status, 200); assert.equal(x.entitlements(), 0);
  const denied = setup({ enabled: () => false, execute: async () => { throw new MerchantAttendanceError("attendance_access_denied"); } }); assert.equal((await handleOperationalRuleLedger(get(), denied.deps)).status, 403);
  const withdraw: OperationalRuleLedgerCommand = { siteId: f.operationalRuleLedgerSite, scope: f.operationalRuleLedgerScope(), action: "withdraw", operationId: f.operationalRuleLedgerId(30), expectedRevision: 2, publishedRevision: 2, reason: "synthetic safe withdrawal" };
  assert.equal((await handleOperationalRuleLedger(post(withdraw), x.deps)).status, 200); assert.equal(x.calls.at(-1)!.allowWrite, false);
});
test("240 auth, canonical/same origin and rate gates remain before any RPC", async () => {
  const x = setup(); for (const r of [new Request(url, { method: "DELETE" }), new Request(get(), { headers: { ...headers, origin: "https://evil.invalid" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.notEqual((await handleOperationalRuleLedger(r, x.deps)).status, 200);
  for (const authenticationMethods of [[], ["invite"], ["password", "recovery"]]) assert.equal((await handleOperationalRuleLedger(get(), { ...x.deps, authenticate: async () => ({ user: { id: f.operationalRuleLedgerActor } as User, accessToken: "synthetic", authenticationMethods }) })).status, 403);
  assert.equal((await handleOperationalRuleLedger(get(), { ...x.deps, allow: () => false })).status, 503); assert.equal(x.calls.length, 0);
});
test("240 route rejects duplicates, unsafe body, streaming timeout and oversized UTF8 before execute", async () => {
  const x = setup({ bodyTimeoutMs: 15 }); const c = f.operationalRuleLedgerSaveCommand(), body = JSON.stringify({ query: f.operationalRuleLedgerQuery(), command: c });
  for (const b of [body.replace('"reason":', '"reason":"duplicate","reason":'), '{"x":"\\ud800"}', "{"]) assert.equal((await handleOperationalRuleLedger(new Request(url, { method: "POST", headers, body: b }), x.deps)).status, 400);
  assert.equal((await handleOperationalRuleLedger(new Request(url, { method: "POST", headers, body: "x".repeat(40961) }), x.deps)).status, 422);
  let canceled = false; const stream = new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } }); assert.equal((await handleOperationalRuleLedger(new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), x.deps)).status, 400); assert.equal(canceled, true); assert.equal(x.calls.length, 0);
});
test("240 actual handler/service passes one exact four-argument RPC and validates receipt", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [], x = setup({ execute: input => executeOperationalRuleLedger(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: await f.operationalRuleLedgerReceiptResult(input.command!), error: null }; } }) });
  const result = await handleOperationalRuleLedger(post(), x.deps); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.deepEqual(calls, [{ name: "faolla_attendance_operational_rules_v1", args: { p_query: f.operationalRuleLedgerQuery(), p_auth_user_id: f.operationalRuleLedgerActor, p_command: f.operationalRuleLedgerSaveCommand(), p_allow_write: true } }]);
});
test("240 service rejects bad actor/hash, false-write projection and redacts unknown SQL", async () => {
  const input = { query: f.operationalRuleLedgerQuery(), command: f.operationalRuleLedgerSaveCommand(), authUserId: f.operationalRuleLedgerActor, allowWrite: true }, r = await f.operationalRuleLedgerReceiptResult(input.command);
  for (const data of [{ ...r, actorId: f.operationalRuleLedgerId(999) }, { ...r, receipt: { ...r.receipt!, commandFingerprint: "a".repeat(64) } }]) await assert.rejects(executeOperationalRuleLedger(input, { rpc: async () => ({ data, error: null }) }), /attendance_operational_rule_invalid/);
  await assert.rejects(executeOperationalRuleLedger(input, { rpc: async () => ({ data: null, error: { message: "private SQL" } }) }), /attendance_operational_rule_invalid/);
  await assert.rejects(executeOperationalRuleLedger({ ...input, command: null, allowWrite: false }, { rpc: async () => ({ data: await f.operationalRuleLedgerDetail(), error: null }) }), /attendance_operational_rule_invalid/);
});
