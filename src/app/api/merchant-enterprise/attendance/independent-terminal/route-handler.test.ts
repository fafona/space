// Synthetic device-cookie HTTP tests only. No real terminal, Auth, SQL or KDF.
import test from "node:test";
import assert from "node:assert/strict";
import { handleIndependentTerminal, independentTerminalDependencies } from "./route-handler";
import { INDEPENDENT_TERMINAL_PROTOCOL, type IndependentTerminalBody, type IndependentTerminalResult } from "@/lib/merchantAttendanceIndependent";
import type { IndependentTerminalContext } from "@/lib/merchantAttendanceIndependent.server";
import { TERMINAL_COOKIE } from "@/lib/merchantAttendanceTerminal";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { GET, POST, runtime, dynamic } from "./route";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/independent-terminal", siteId = "99990196", terminalId = id(4), subjectId = id(2), workerId = id(3);
const secret = "A".repeat(43), pin = "12345678", cookie = `${TERMINAL_COOKIE}=${siteId}.${terminalId}.${secret}`, at = "2026-10-08T12:00:00.123456Z";
const body = (): IndependentTerminalBody => ({ siteId, terminalId, workerNo: "W01", pin, request: { kind: "state" } });
const post = (value: unknown = body(), headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
function result(b: IndependentTerminalBody): IndependentTerminalResult {
  return { protocol: INDEPENDENT_TERMINAL_PROTOCOL, siteId, terminalId, readAt: at,
    data: b.request.kind === "recover" ? { kind: "receipt", receipt: null } : { kind: "state", subject: { subjectId, workerId, workerNo: "W01", displayName: "合成人员", generation: 0, workerVersion: 1, credentialId: id(6), credentialRevision: 1,
      settingsVersion: 2, locationId: id(5), locationVersion: 2, timeZone: "Europe/Madrid" }, head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null } } };
}
function setup() {
  const calls: Array<{ body: IndependentTerminalBody; context: IndependentTerminalContext; signal?: AbortSignal }> = [], limits: string[] = [];
  const d: typeof independentTerminalDependencies = { entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof independentTerminalDependencies.entitlement>>),
    allow: key => { limits.push(key); return true; }, timeoutMs: 12000, bodyTimeoutMs: 5000,
    execute: async (b, context, _service, signal) => { calls.push({ body: b, context, signal }); return result(b); } };
  return { d, calls, limits };
}
test("196 terminal new Node/dynamic endpoint accepts exactly one real-scope terminal cookie and no browser verified/secret authority", async () => {
  assert.equal(runtime, "nodejs"); assert.equal(dynamic, "force-dynamic"); assert.equal(typeof GET, "function"); assert.equal(typeof POST, "function");
  const s = setup();
  // Fetch Headers trims boundary whitespace; exercise malformed token bytes
  // that actually reach the handler instead of claiming a stripped newline did.
  for (const h of [{ cookie: "" }, { cookie: cookie + "; " + cookie }, { cookie: cookie + "A" }, { cookie: cookie.slice(0, -1) + "B" }]) assert.equal((await handleIndependentTerminal(post(body(), h), s.d)).status, 403);
  for (const b of [{ ...body(), secret }, { ...body(), verified: true }, { ...body(), allowNew: true }, { ...body(), terminalId: id(99) }, { ...body(), siteId: "99990197" }]) {
    const r = await handleIndependentTerminal(post(b), s.d); assert.equal(r.status, "secret" in b || "verified" in b || "allowNew" in b ? 400 : 403);
  }
  assert.equal(s.calls.length, 0);
  const response = await handleIndependentTerminal(post(), s.d); assert.equal(response.status, 200); assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].context, { siteId, terminalId, secret, allowNew: true }); assert.ok(s.calls[0].signal instanceof AbortSignal);
  assert.ok(s.limits.every(k => k === siteId + ":" + terminalId)); assert.match(response.headers.get("cache-control")!, /private.*no-store/); assert.equal(response.headers.get("set-cookie"), null);
  const text = await response.text(); for (const value of [pin, secret, '"salt"', '"verifier"', '"leaseId"']) assert.equal(text.includes(value), false);
});
test("196 terminal only same-origin POST accepts short PIN body; URL/PIN, wrong origins and rate limit precede dispatch", async () => {
  const s = setup();
  assert.equal((await handleIndependentTerminal(new Request(url, { headers: { origin, cookie } }), s.d)).status, 405);
  const forbidden: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const h of forbidden) assert.equal((await handleIndependentTerminal(post(body(), h), s.d)).status, 403);
  assert.equal((await handleIndependentTerminal(new Request(url + "?pin=" + pin, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body()) }), s.d)).status, 400);
  for (const badPin of ["1234567", "1234567890123", "abcd1234", pin + "\n"]) assert.equal((await handleIndependentTerminal(post({ ...body(), pin: badPin }), s.d)).status, 400);
  assert.equal((await handleIndependentTerminal(post(), { ...s.d, allow: () => false })).status, 429); assert.equal(s.calls.length, 0);
});
test("196 terminal platform-off still authenticates state/recover/qualified finish; SQL alone enforces current revocation", async () => {
  const s = setup(), off = { ...s.d, entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof independentTerminalDependencies.entitlement>>) };
  assert.equal((await handleIndependentTerminal(post(), off)).status, 200);
  const recovery: IndependentTerminalBody = { ...body(), request: { kind: "recover", subjectId, workerId, operationId: id(10), commandFingerprint: "a".repeat(64) } };
  assert.equal((await handleIndependentTerminal(post(recovery), off)).status, 200); assert.ok(s.calls.every(c => c.context.allowNew === false));
  let dispatched = 0;
  const clock: IndependentTerminalBody = { ...body(), request: { kind: "clock", command: { operationId: id(10), subjectId, workerId, generation: 0, credentialId: id(6), credentialRevision: 1,
    expectedWorkerVersion: 1, expectedSettingsVersion: 2, locationId: id(5), expectedLocationVersion: 2, expectedSequence: 1, action: "clock_out", breakPaid: null } } };
  const revoked = await handleIndependentTerminal(post(clock), { ...off, execute: async (_b, context) => { dispatched++; assert.equal(context.allowNew, false); throw new MerchantAttendanceError("attendance_pin_invalid"); } });
  assert.equal(revoked.status, 403); assert.equal((await revoked.json()).error.code, "attendance_pin_invalid"); assert.equal(dispatched, 1);
});
test("196 terminal strict8KiB UTF8 duplicate-key JSON and output identity/private-field guards fail closed", async () => {
  const s = setup();
  for (const bytes of ['{"pin":"12345678","pin":"87654321"}', new Uint8Array([0xff])]) assert.equal((await handleIndependentTerminal(new Request(url, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: bytes }), s.d)).status, 400);
  assert.equal((await handleIndependentTerminal(post({ ...body(), workerNo: "x".repeat(8192) }), s.d)).status, 413);
  assert.equal((await handleIndependentTerminal(post({}, { "content-type": "application/json; charset=latin1" }), s.d)).status, 415); assert.equal(s.calls.length, 0);
  for (const change of [(b: IndependentTerminalBody) => ({ ...result(b), siteId: "99990197" }), (b: IndependentTerminalBody) => ({ ...result(b), leaseId: id(99) }), (b: IndependentTerminalBody) => ({ ...result(b), salt: pin })]) {
    const r = await handleIndependentTerminal(post(), { ...s.d, execute: async b => change(b) }); assert.equal(r.status, 503); const text = await r.text(); assert.equal(text.includes(pin), false); assert.equal(text.includes(secret), false);
  }
  const r = await handleIndependentTerminal(post(), { ...s.d, execute: async () => { throw Error(pin + secret); } }); assert.equal(r.status, 503); assert.equal((await r.text()).includes(pin), false);
});
test("196 terminal body/total deadlines cancel input and fence late entitlement before any begin/finish", async () => {
  const s = setup(); let cancelled = false, release!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const req = new Request(url, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleIndependentTerminal(req, { ...s.d, bodyTimeoutMs: 10 })).status, 400); assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  const held = new Promise<void>(r => { release = r; });
  assert.equal((await handleIndependentTerminal(post(), { ...s.d, timeoutMs: 10, entitlement: async site => { await held; return s.d.entitlement(site); } })).status, 503);
  release(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  const aborted = new AbortController(); aborted.abort(); const req2 = new Request(url, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body()), signal: aborted.signal });
  assert.equal((await handleIndependentTerminal(req2, s.d)).status, 503); assert.equal(s.calls.length, 0);
});
