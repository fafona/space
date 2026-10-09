// Synthetic HTTP/Auth boundary only; no real login or SQL is exercised here.
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleCycleSend, cycleSendDependencies } from "./route-handler";
import { cycleSendQueryString, type CycleSendQuery } from "@/lib/merchantAttendanceCycleSend";
import { parseCycleSendResult } from "@/lib/merchantAttendanceCycleSendResult";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { executeCycleSend } from "@/lib/merchantAttendanceCycleSend.server";
import type { AttendanceSelfRpc } from "@/lib/merchantAttendanceSelf.server";
import { cycleSendModel, cycleSendModelId as id } from "../../../../../../../scripts/fixtures/attendance-cycle-send-model";
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/operational-cycle/send";
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function setup() {
  const f = await cycleSendModel(), writes: Parameters<typeof cycleSendDependencies.write>[0][] = [], gets: Parameters<typeof cycleSendDependencies.recover>[0][] = [], entitlement: string[] = [];
  const deps: typeof cycleSendDependencies = { authenticate: async () => ({ user: { id: f.actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async site => { entitlement.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof cycleSendDependencies.entitlement>>; },
    enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    write: async input => { writes.push(input); return parseCycleSendResult(f.linked(), f.frame, f.actor, f.command.operationId, f.fingerprint, f.command); },
    recover: async input => { gets.push(input); return parseCycleSendResult(f.unknown(), f.frame, f.actor, f.command.operationId, f.fingerprint); } };
  const query: CycleSendQuery = { ...f.frame, mode: "recover", operationId: f.command.operationId, commandFingerprint: f.fingerprint };
  return { f, body: { frame: f.frame, command: f.command }, query, deps, writes, gets, entitlement,
    get: () => new Request(url + "?" + cycleSendQueryString(query), { headers: { origin } }) };
}
test("200 send dispatch requires canonical same-origin actual password Auth, never request-supplied actor", async () => {
  const s = await setup(), headers: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
  for (const h of headers) assert.equal((await handleCycleSend(post(s.body, h), s.deps)).status, 403);
  assert.equal((await handleCycleSend(post(s.body), { ...s.deps, authenticate: async () => ({ user: { id: s.f.actor } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleCycleSend(post({ ...s.body, authUserId: id(20) }), s.deps)).status, 400); assert.equal(s.writes.length, 0);
});
test("200 fresh write gets explicit flag+entitlement while off still permits exactly one original lookup in service", async () => {
  const s = await setup(), r = await handleCycleSend(post(s.body), s.deps); assert.equal(r.status, 200); assert.equal(s.writes[0].authUserId, s.f.actor);
  assert.equal(s.writes[0].allowWrite, true); assert.equal(s.entitlement.length, 1); assert.match(r.headers.get("cache-control")!, /private.*no-store/);
  let calls = 0; const denied = await handleCycleSend(post(s.body), { ...s.deps, enabled: () => false,
    entitlement: async () => { assert.fail("off must not collect entitlement"); }, write: async input => { calls++; assert.equal(input.allowWrite, false); throw new MerchantAttendanceError("attendance_operational_cycle_disabled"); } });
  assert.equal(denied.status, 403); assert.equal(calls, 1);
});
test("200 GET is original-id read only and bypasses today's entitlement and writer flags", async () => {
  const s = await setup(), r = await handleCycleSend(s.get(), { ...s.deps, enabled: () => { assert.fail("recovery must not inspect flags"); }, entitlement: async () => { assert.fail("recovery must not collect entitlement"); } });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.receipt, null); assert.equal(s.gets.length, 1); assert.equal(s.writes.length, 0); assert.equal(s.entitlement.length, 0);
  const preview: CycleSendQuery = { ...s.f.frame, mode: "preview", operationId: null, commandFingerprint: null };
  assert.equal((await handleCycleSend(new Request(url + "?" + cycleSendQueryString(preview), { headers: { origin } }), s.deps)).status, 400);
});
test("200 strict streamed JSON, duplicate query, redaction, limiter and result digest fail closed", async () => {
  const s = await setup(), json = JSON.stringify(s.body), req = (text: string) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: text });
  assert.equal((await handleCycleSend(req(json.replace('"frame":', '"frame":{},"frame":')), s.deps)).status, 400);
  assert.equal((await handleCycleSend(post(s.body, { "content-type": "text/plain" }), s.deps)).status, 400);
  assert.equal((await handleCycleSend(new Request(s.get().url + "&siteId=99990200", { headers: { origin } }), s.deps)).status, 400);
  assert.equal((await handleCycleSend(post(s.body), { ...s.deps, allow: () => false })).status, 429); assert.equal(s.writes.length, 0);
  const redacted = await handleCycleSend(post(s.body), { ...s.deps, write: async () => { throw Error("postgres://password@private.invalid"); } });
  assert.equal(redacted.status, 503); assert(!(await redacted.text()).includes("password"));
  const wrong = await parseCycleSendResult(s.f.linked(), s.f.frame, s.f.actor, s.f.command.operationId, s.f.fingerprint, s.f.command);
  const invalid = await handleCycleSend(post(s.body), { ...s.deps, write: async () => ({ ...wrong, siteId: "99999999" }) }); assert.equal(invalid.status, 503);
});
test("200 total HTTP deadline covers service work and cannot leak a late successful response", async () => {
  const s = await setup(); let release!: (value: Awaited<ReturnType<typeof cycleSendDependencies.write>>) => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), blocked = new Promise<Awaited<ReturnType<typeof cycleSendDependencies.write>>>(resolve => { release = resolve; });
  const running = handleCycleSend(post(s.body), { ...s.deps, timeoutMs: 30, write: async () => { enter(); return blocked; } });
  await entered; const r = await running; assert.equal(r.status, 503);
  release(await parseCycleSendResult(s.f.linked(), s.f.frame, s.f.actor, s.f.command.operationId, s.f.fingerprint, s.f.command));
  assert.equal((await r.clone().json()).ok, false); await new Promise<void>(resolve => setImmediate(resolve));
});

test("200 actual coordinator cannot advance a late pre-read after HTTP timeout or caller abort", async () => {
  for (const mode of ["deadline", "abort"] as const) {
    const s = await setup(), names: string[] = [], controller = new AbortController();
    let enter!: () => void, release!: (value: unknown) => void, workSignal: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const service: AttendanceSelfRpc = { rpc: async name => {
      names.push(name); const data = await new Promise<unknown>(resolve => { release = resolve; enter(); }); return { data, error: null };
    } };
    const request = new Request(post(s.body), { signal: controller.signal });
    const running = handleCycleSend(request, { ...s.deps, timeoutMs: mode === "deadline" ? 30 : 12000,
      write: async (input, _service, signal) => { workSignal = signal; return executeCycleSend(input, service, signal); } });
    await entered; if (mode === "abort") controller.abort();
    const response = await running; assert.equal(response.status, 503); assert.equal(workSignal?.aborted, true);
    release(s.f.unknown()); await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(names, ["faolla_attendance_operational_cycle_send_recover_v1"]);
    assert.equal((await response.json()).ok, false);
  }
});
