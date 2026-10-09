// Synthetic HTTP boundary only; does not authenticate a real user or call SQL.
import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleCycleIntent, cycleIntentDependencies } from "./route-handler";
import { cycleIntentQueryString, cycleIntentCommandFingerprint, type CycleIntentQuery } from "@/lib/merchantAttendanceCycleIntent";
import type { CycleIntentServiceInput } from "@/lib/merchantAttendanceCycleIntent.server";
import { parseCycleIntentResult } from "@/lib/merchantAttendanceCycleIntentResult";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { cycleModel, cycleOwner, cycleId } from "../../../../../../scripts/fixtures/attendance-cycle-intent-model";
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/operational-cycle";
const get = (q: CycleIntentQuery) => new Request(url + "?" + cycleIntentQueryString(q), { headers: { origin } });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function setup() {
  const f = await cycleModel(), calls: CycleIntentServiceInput[] = [], entitlements: string[] = [];
  const deps: typeof cycleIntentDependencies = { allow: () => true, enabled: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: cycleOwner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async site => { entitlements.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof cycleIntentDependencies.entitlement>>; },
    execute: async input => { calls.push(input);
      if (input.command) { const c = input.command, r = { ...f.receipt, operationId: c.operationId, intentId: c.intentId, action: c.action, revision: c.action === "accept" ? 1 : 2,
        commandFingerprint: await cycleIntentCommandFingerprint(input.query, c, input.authUserId) };
        return parseCycleIntentResult(f.result({ kind: "receipt" }, r), input.query, input.authUserId, c); }
      if (input.query.mode === "recover") return parseCycleIntentResult(f.result({ kind: "receipt" }), input.query, cycleOwner);
      return parseCycleIntentResult(f.result({ kind: "detail", intent: f.intent, head: f.receipt }), input.query, cycleOwner);
    } };
  return { f, deps, calls, entitlements };
}
test("200 canonical same-origin and actual password Auth precede dispatch", async () => {
  const s = await setup(), body = { query: s.f.query, command: s.f.command };
  const headers: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
  for (const h of headers)
    assert.equal((await handleCycleIntent(post(body, h), s.deps)).status, 403);
  assert.equal((await handleCycleIntent(post(body), { ...s.deps, authenticate: async () => ({ user: { id: cycleOwner } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleCycleIntent(post({ ...body, authUserId: cycleId(99) }), s.deps)).status, 400); assert.equal(s.calls.length, 0);
});
test("200 flag/entitlement controls only fresh adoption, not historical GET or safe cancel", async () => {
  const s = await setup(), q = s.f.query;
  const r = await handleCycleIntent(post({ query: q, command: s.f.command }), s.deps); assert.equal(r.status, 200); assert.match(r.headers.get("cache-control")!, /private.*no-store/);
  assert.equal(s.calls[0].authUserId, cycleOwner); assert.equal(s.calls[0].allowAccept, true); assert.equal(s.entitlements.length, 1);
  const safe = { ...s.deps, enabled: () => false, entitlement: async () => { assert.fail("safe path must not load entitlement"); } };
  assert.equal((await handleCycleIntent(get(q), safe)).status, 200);
  assert.equal((await handleCycleIntent(get({ ...s.f.scope, mode: "recover", intentId: q.intentId, operationId: q.intentId }), safe)).status, 200);
  const command = { action: "cancel", operationId: cycleId(11), intentId: q.intentId, expectedRevision: 1, expectedHeadOperationId: q.intentId, expectedIntentFingerprint: s.f.intent.intentFingerprint, reason: "Synthetic200 cancellation" };
  assert.equal((await handleCycleIntent(post({ query: q, command }), safe)).status, 200); assert(s.calls.slice(1).every(c => !c.allowAccept));
});
test("200 off POST still reaches SQL exactly once for original receipt before fresh-write denial", async () => {
  const s = await setup(); let calls = 0;
  const r = await handleCycleIntent(post({ query: s.f.query, command: s.f.command }), { ...s.deps, enabled: () => false,
    execute: async input => { calls++; assert.equal(input.allowAccept, false); throw new MerchantAttendanceError("attendance_operational_cycle_disabled"); } });
  assert.equal(r.status, 403); assert.equal(calls, 1);
});
test("200 strict JSON/query/UTF8/result boundary denies injected identity and corrupt results", async () => {
  const s = await setup();
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff]), JSON.stringify({ x: "x".repeat(8192) })])
    assert.equal((await handleCycleIntent(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.deps)).status, 400);
  assert.equal((await handleCycleIntent(new Request(url + "?siteId=99990200&siteId=99990200", { headers: { origin } }), s.deps)).status, 400);
  assert.equal(s.calls.length, 0);
  assert.equal((await handleCycleIntent(get(s.f.query), { ...s.deps, execute: async () => ({ ...await s.deps.execute({ query: s.f.query, command: null, authUserId: cycleOwner, allowAccept: false }), actorId: cycleId(99) }) })).status, 503);
});
test("200 body and total deadlines cancel streams and prevent late SQL dispatch", async () => {
  const s = await setup(); let cancelled = false, finish!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const request = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleCycleIntent(request, { ...s.deps, bodyTimeoutMs: 10 })).status, 400); assert.equal(cancelled, true);
  const hold = new Promise<void>(r => { finish = r; });
  assert.equal((await handleCycleIntent(get(s.f.query), { ...s.deps, timeoutMs: 10, authenticate: async r => { await hold; return s.deps.authenticate(r); } })).status, 503);
  finish(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
});
