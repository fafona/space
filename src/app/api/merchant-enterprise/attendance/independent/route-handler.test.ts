// Synthetic HTTP / protocol tests. No real Auth, database or KDF is claimed.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleIndependent, independentDependencies } from "./route-handler";
import { INDEPENDENT_ADMIN_PROTOCOL, independentQueryString, independentAdminCommandText,
  type IndependentQuery, type IndependentCommand, type IndependentAdminResult, type IndependentAdminReceipt } from "@/lib/merchantAttendanceIndependent";
import type { IndependentAdminServiceInput } from "@/lib/merchantAttendanceIndependent.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { GET, POST, runtime, dynamic } from "./route";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/independent";
const siteId = "99990196", actorId = id(1), subjectId = id(2), workerId = id(3), locationId = id(4), at = "2026-10-08T12:00:00.123456Z", pin = "12345678";
const query = (): IndependentQuery => ({ siteId, mode: "detail", subjectId });
const command = (): Extract<IndependentCommand, { action: "enable" }> => ({ action: "enable", operationId: id(10), subjectId,
  expectedSubjectRevision: 1, expectedGeneration: 0, expectedWorkerVersion: 1, expectedSettingsVersion: 2, reason: "明确启用" });
const get = (q: IndependentQuery, headers: Record<string, string> = {}) => new Request(url + "?" + independentQueryString(q), { headers: { origin, ...headers } });
const post = (value: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
function envelope(data: IndependentAdminResult["data"], actor = actorId, receipt: IndependentAdminReceipt | null = null): IndependentAdminResult {
  return { protocol: INDEPENDENT_ADMIN_PROTOCOL, siteId, actorId: actor, readAt: at, settingsVersion: 2, data, receipt };
}
function result(input: IndependentAdminServiceInput): IndependentAdminResult {
  const q = input.query, c = input.command;
  if (c) return envelope({ kind: "receipt" }, input.authUserId, { operationId: c.operationId, subjectId, workerId, action: c.action, actorId: input.authUserId,
    subjectRevision: c.action === "create" ? 1 : c.expectedSubjectRevision + 1,
    workerVersion: c.action === "create" ? 1 : c.expectedWorkerVersion + 1,
    generation: c.action === "create" ? 0 : c.expectedGeneration + (["disable", "revoke_pin", "bind_member"].includes(c.action) ? 1 : 0),
    credentialRevision: c.action === "issue_pin" ? c.expectedCredentialRevision + 1 : c.action === "revoke_pin" || c.action === "bind_member" ? c.expectedCredentialRevision ? c.expectedCredentialRevision + 1 : 0 : c.action === "disable" ? 0 : null,
    recordedAt: at, commandFingerprint: createHash("sha256").update(independentAdminCommandText(siteId, input.authUserId, c)).digest("hex") });
  if (q.mode === "recover") return envelope({ kind: "receipt" }, input.authUserId);
  if (q.mode === "list") return envelope({ kind: "list", items: [], nextCursor: null }, input.authUserId);
  return envelope({ kind: "detail", subject: { subjectId, workerId, workerNo: "W01", displayName: "合成人员", startsOn: "2026-10-08", locationId,
    enabled: false, generation: 0, revision: 1, workerVersion: 1, state: "independent", createdAt: at },
    credential: { credentialId: null, revision: 0, enabled: false, generation: null, changedAt: null },
    head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null }, binding: null }, input.authUserId);
}
function setup() {
  const calls: IndependentAdminServiceInput[] = [], eligible: string[] = [], signals: AbortSignal[] = [];
  const d: typeof independentDependencies = { authenticate: async () => ({ user: { id: actorId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    enabled: () => true, entitlement: async site => { eligible.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof independentDependencies.entitlement>>; },
    allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async (input, _service, signal) => { calls.push(input); if (signal) signals.push(signal); return result(input); } };
  return { d, calls, eligible, signals };
}

test("196 current owner candidate GETs keep actual Auth path and never request new-write entitlement", async () => {
  const s = setup();
  for (const mode of ["members", "locations"] as const) { const response = await handleIndependent(get({ siteId, mode, cursor: null, search: "" }), { ...s.d, enabled: () => false,
    execute: async input => { s.calls.push(input); return envelope(mode === "members" ? { kind: mode, items: [{ employeeId: id(80), authUserId: id(81), displayName: "当前员工" }], nextCursor: null }
      : { kind: mode, items: [{ locationId, name: "当前地点", timeZone: "UTC" }], nextCursor: null }); } });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.data.kind, mode); }
  assert.equal(s.calls.length, 2); assert(s.calls.every(v => v.authUserId === actorId && v.command === null && v.pin === null && v.allowNew === false)); assert.equal(s.eligible.length, 0);
});
test("196 owner route is Node/dynamic and validates origin, actual password Auth and limiter before dispatch", async () => {
  assert.equal(runtime, "nodejs"); assert.equal(dynamic, "force-dynamic"); assert.equal(typeof GET, "function"); assert.equal(typeof POST, "function");
  const s = setup(), body = { query: query(), command: command() };
  const forbidden: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of forbidden) assert.equal((await handleIndependent(post(body, headers), s.d)).status, 403);
  assert.equal((await handleIndependent(new Request(url.replace("www.faolla.com", "haoyouduo.faolla.com"), { headers: { origin } }), s.d)).status, 403);
  for (const methods of [["recovery"], ["magiclink"], ["password", "invite"], []]) assert.equal((await handleIndependent(post(body), { ...s.d, authenticate: async () => ({ user: { id: actorId } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal((await handleIndependent(post(body), { ...s.d, allow: () => false })).status, 429);
  assert.equal((await handleIndependent(new Request(url, { method: "DELETE", headers: { origin } }), s.d)).status, 405); assert.equal(s.calls.length, 0);
});
test("196 owner exact body obtains actor from authenticated context, never browser authority; issue PIN only transient", async () => {
  const s = setup(), body = { query: query(), command: command() };
  for (const v of [{ ...body, authUserId: id(99) }, { ...body, allowNew: true }, { ...body, pin }, { ...body, command: { ...body.command, verified: true } }]) assert.equal((await handleIndependent(post(v), s.d)).status, 400);
  const issue: IndependentCommand = { ...command(), action: "issue_pin", expectedCredentialRevision: 0 };
  assert.equal((await handleIndependent(post({ query: query(), command: issue }), s.d)).status, 400);
  for (const badPin of ["1234567", "1234567890123", "1234abcd", pin + "\n"]) assert.equal((await handleIndependent(post({ query: query(), command: issue, pin: badPin }), s.d)).status, 400);
  const r = await handleIndependent(post({ query: query(), command: issue, pin }), s.d); assert.equal(r.status, 200);
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].pin, pin); assert.equal(s.calls[0].authUserId, actorId); assert.equal(s.calls[0].allowNew, true);
  assert.equal(JSON.stringify(s.calls[0].command).includes(pin), false); const text = await r.text();
  for (const privateValue of [pin, "salt", "verifier", "leaseId", "accessToken"]) assert.equal(text.includes(privateValue), false);
  assert.match(r.headers.get("cache-control")!, /private.*no-store/); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});
test("196 owner default-off and entitlement failure reach SQL with false, while recover and revoke require no new-action eligibility", async () => {
  const s = setup();
  await handleIndependent(post({ query: query(), command: command() }), { ...s.d, enabled: () => false });
  await handleIndependent(post({ query: query(), command: command() }), { ...s.d, entitlement: async () => { throw Error("private"); } });
  assert.ok(s.calls.every(c => c.allowNew === false));
  const safe = { ...s.d, enabled: () => false, entitlement: async () => { assert.fail("saved recovery/revoke must not require new-action eligibility"); } };
  const recover: IndependentQuery = { siteId, mode: "recover", subjectId, operationId: id(10) };
  assert.equal((await handleIndependent(get(recover), safe)).status, 200);
  const revoke: IndependentCommand = { ...command(), action: "revoke_pin", expectedCredentialRevision: 0 };
  assert.equal((await handleIndependent(post({ query: query(), command: revoke }), safe)).status, 200);
  assert.equal(s.calls[2].command, null); assert.equal(s.calls[2].pin, null); assert.equal(s.calls[2].authUserId, actorId);
  assert.equal(s.calls.length, 4); assert.equal(s.eligible.length, 0);
});
test("196 owner original-actor minimal GET recovery is SQL-authorized, without granting current detail or issue authority", async () => {
  const s = setup(); let reads = 0;
  const d = { ...s.d, execute: async (input: IndependentAdminServiceInput) => { reads++; assert.equal(input.authUserId, actorId);
    if (input.query.mode === "recover") return result(input); throw new MerchantAttendanceError("attendance_access_denied"); } };
  assert.equal((await handleIndependent(get({ siteId, mode: "recover", subjectId, operationId: id(10) }), d)).status, 200);
  assert.equal((await handleIndependent(get(query()), d)).status, 403);
  assert.equal((await handleIndependent(post({ query: query(), command: { ...command(), action: "issue_pin", expectedCredentialRevision: 0 }, pin }), d)).status, 403);
  assert.equal(reads, 3);
});
test("196 owner strict UTF8/JSON/URL/size bounds precede any RPC, and malformed public projection is503", async () => {
  const s = setup();
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff])]) assert.equal((await handleIndependent(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.d)).status, 400);
  assert.equal((await handleIndependent(post({ value: "x".repeat(8192) }), s.d)).status, 413);
  assert.equal((await handleIndependent(post({}, { "content-type": "text/plain" }), s.d)).status, 415);
  assert.equal((await handleIndependent(post({}, { "content-length": "9000" }), s.d)).status, 413);
  assert.equal((await handleIndependent(new Request(url + "?pin=" + pin, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }), s.d)).status, 400);
  assert.equal((await handleIndependent(new Request(url + "?siteId=" + siteId + "&siteId=" + siteId, { headers: { origin } }), s.d)).status, 400); assert.equal(s.calls.length, 0);
  const r = await handleIndependent(get(query()), { ...s.d, execute: async input => ({ ...result(input), verifier: pin }) });
  assert.equal(r.status, 503); assert.equal((await r.text()).includes(pin), false);
});
test("196 owner five-second body budget and12s total cap cancel streams, reject late Auth/eligibility and pass abort to service", async () => {
  const s = setup(); let cancelled = false, release!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  assert.equal((await handleIndependent(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit), { ...s.d, bodyTimeoutMs: 10 })).status, 400);
  assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  const held = new Promise<void>(r => { release = r; });
  assert.equal((await handleIndependent(get(query()), { ...s.d, timeoutMs: 10, authenticate: async req => { await held; return s.d.authenticate(req); } })).status, 503);
  release(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  const serviceContext: { signal?: AbortSignal } = {}; let calls = 0; const waiting = new Promise<void>(() => {});
  assert.equal((await handleIndependent(get(query()), { ...s.d, timeoutMs: 10, execute: async (input, _service, signal) => { calls++; serviceContext.signal = signal; await waiting; return result(input); } })).status, 503);
  assert.equal(serviceContext.signal?.aborted, true); assert.equal(calls, 1);
  assert.equal((await handleIndependent(get(query()), { ...s.d, timeoutMs: 12001 })).status, 503);
});
