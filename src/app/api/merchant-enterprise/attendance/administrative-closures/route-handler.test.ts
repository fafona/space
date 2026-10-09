// Synthetic HTTP checks only. No real Auth or SQL.
import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleAdministrativeClosure, administrativeClosureDependencies } from "./route-handler";
import { administrativeClosureQueryString, parseAdministrativeClosureResponse, type AdministrativeClosureQuery } from "@/lib/merchantAttendanceAdministrativeClosure";
import { closureId, closureOwner, closureSelf, closureSite, closureQuery, closureCommand, closureCandidate, closureSavedDetail, closureResult, closureReceiptResult } from "@/lib/merchantAttendanceAdministrativeClosureTestFixtures";
import type { AdministrativeClosureServiceInput } from "@/lib/merchantAttendanceAdministrativeClosure.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/administrative-closures";
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (q: AdministrativeClosureQuery) => new Request(url + "?" + administrativeClosureQueryString(q), { headers: { origin } });
function setup(actor = closureOwner) {
  const calls: AdministrativeClosureServiceInput[] = [], eligibility: string[] = [];
  const deps: typeof administrativeClosureDependencies = { enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async site => { eligibility.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof administrativeClosureDependencies.entitlement>>; },
    execute: async input => { calls.push(input); if (input.command) return closureReceiptResult(input.command, input.query, input.authUserId);
      if (input.query.mode === "recover") return closureResult({ kind: "receipt", receipt: null }, input.query, input.authUserId);
      if (input.query.mode === "candidate") return closureResult({ kind: "candidate", detail: input.allowClose ? closureCandidate() : { ...closureCandidate(), capabilities: { canClose: false, canRecordUnknown: false, canDispute: false, canRespond: false }, blockers: ["feature_disabled"] } }, input.query, input.authUserId);
      if (input.query.mode === "detail") return closureResult({ kind: "detail", detail: await closureSavedDetail(input.query.access) }, input.query, input.authUserId);
      return closureResult({ kind: "list", items: [], nextAfterId: null }, input.query, input.authUserId); } };
  return { deps, calls, eligibility };
}
test("195 origin, password authentication and exact inputs precede dispatch", async () => {
  const s = setup(), body = { query: closureQuery(), command: closureCommand() };
  const headers: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const h of headers) assert.equal((await handleAdministrativeClosure(post(body, h), s.deps)).status, 403);
  assert.equal((await handleAdministrativeClosure(post(body), { ...s.deps, authenticate: async () => ({ user: { id: closureOwner } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleAdministrativeClosure(post({ ...body, authUserId: closureId(90) }), s.deps)).status, 400); assert.equal(s.calls.length, 0);
});
test("195 close eligibility is actual flag AND entitlement; one authenticated RPC and no-store", async () => {
  const s = setup(), r = await handleAdministrativeClosure(post({ query: closureQuery(), command: closureCommand() }), s.deps);
  assert.equal(r.status, 200); assert.match(r.headers.get("cache-control")!, /private.*no-store/); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].allowClose, true); assert.equal(s.calls[0].authUserId, closureOwner);
  await parseAdministrativeClosureResponse(await r.json(), closureQuery(), closureOwner, closureCommand());
  await handleAdministrativeClosure(get(closureQuery()), { ...s.deps, enabled: () => false }); assert.equal(s.calls[1].allowClose, false);
  await handleAdministrativeClosure(get(closureQuery()), { ...s.deps, entitlement: async () => { throw Error("unavailable"); } }); assert.equal(s.calls[2].allowClose, false);
});
test("195 safe owner/self saved reads, dispute and recover do not depend on close eligibility or active self.view", async () => {
  const s = setup(closureSelf), deps = { ...s.deps, enabled: () => false, entitlement: async () => { assert.fail("safe path must not inspect eligibility"); } };
  const q: AdministrativeClosureQuery = { siteId: closureSite, access: "self", mode: "detail", startEventId: closureId(6) };
  assert.equal((await handleAdministrativeClosure(get(q), deps)).status, 200);
  const command = { action: "self_dispute" as const, operationId: closureId(101), startEventId: closureId(6), expectedRevision: 1, expectedClosedOperationId: closureId(100), reason: "Synthetic dispute" };
  assert.equal((await handleAdministrativeClosure(post({ query: q, command }), deps)).status, 200);
  assert.equal((await handleAdministrativeClosure(get({ siteId: closureSite, access: "owner", mode: "recover", operationId: closureId(100) }), deps)).status, 200);
  assert.equal(s.calls.length, 3); assert.ok(s.calls.every(c => !c.allowClose));
  const owner = setup(), oq: AdministrativeClosureQuery = { siteId: closureSite, access: "owner", mode: "detail", startEventId: closureId(6) };
  assert.equal((await handleAdministrativeClosure(post({ query: oq, command: { action: "owner_respond", operationId: closureId(102), startEventId: closureId(6), expectedRevision: 2, disputeOperationId: closureId(101), reason: "Synthetic response" } }), { ...owner.deps, enabled: () => false, entitlement: deps.entitlement })).status, 200);
});
test("195 off POST reaches SQL with false; only SQL may authorize replay/current actor", async () => {
  const s = setup(); let count = 0;
  const r = await handleAdministrativeClosure(post({ query: closureQuery(), command: closureCommand() }), { ...s.deps, enabled: () => false, execute: async input => { count++; assert.equal(input.allowClose, false); throw new MerchantAttendanceError("attendance_administrative_closure_disabled"); } });
  assert.equal(r.status, 403); assert.equal(count, 1); assert.equal((await parseAdministrativeClosureResponse(await r.json(), closureQuery(), closureOwner)).ok, false);
});
test("195 bounded strict JSON/UTF8/body and response identity fail closed", async () => {
  const s = setup();
  assert.equal((await handleAdministrativeClosure(post({ value: "x".repeat(8192) }), s.deps)).status, 422);
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff])]) assert.equal((await handleAdministrativeClosure(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.deps)).status, 400);
  assert.equal((await handleAdministrativeClosure(new Request(url + "?siteId=99990001&siteId=99990002", { headers: { origin } }), s.deps)).status, 400); assert.equal(s.calls.length, 0);
  assert.equal((await handleAdministrativeClosure(get(closureQuery()), { ...s.deps, execute: async () => closureResult({ kind: "candidate", detail: closureCandidate() }, closureQuery(), closureId(99)) })).status, 503);
});
test("195 body five-second and total deadlines cancel streams and prevent late dispatch", async () => {
  const s = setup(); let cancelled = false, resolve!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const req = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleAdministrativeClosure(req, { ...s.deps, bodyTimeoutMs: 10 })).status, 400); assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  const delayed = new Promise<void>(r => { resolve = r; }); const response = await handleAdministrativeClosure(get(closureQuery()), { ...s.deps, timeoutMs: 10, authenticate: async r => { await delayed; return s.deps.authenticate(r); } });
  assert.equal(response.status, 503); resolve(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
});
