// 194 synthetic HTTP only. No real Auth, SQL, service, or activation.
import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleApplicationWindow, applicationWindowDependencies } from "./route-handler";
import { applicationWindowFixture, windowActor, windowId as id } from "@/lib/merchantAttendanceApplicationWindowTestFixtures";
import { applicationWindowQueryString, type ApplicationWindowQuery } from "@/lib/merchantAttendanceApplicationWindow";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import type { ApplicationWindowServiceInput } from "@/lib/merchantAttendanceApplicationWindow.server";
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/application-window";
function post(body: unknown, headers: Record<string, string> = {}) { return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
const get = (query: ApplicationWindowQuery) => new Request(url + "?" + applicationWindowQueryString(query), { headers: { origin } });
async function setup() {
  const f = await applicationWindowFixture(), calls: ApplicationWindowServiceInput[] = [], auth: string[] = [], entitlement: string[] = [];
  const deps: typeof applicationWindowDependencies = { enabled: () => true, timeoutMs: 12000, allow: () => true,
    authenticate: async () => { auth.push(windowActor); return { user: { id: windowActor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }; },
    entitlement: async site => { entitlement.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof applicationWindowDependencies.entitlement>>; },
    execute: async input => { calls.push(input); return input.command ? f.post : input.query.mode === "recover" ? { ...f.post, mode: "recover" } : f.result; } };
  return { f, deps, calls, auth, entitlement };
}
test("194 canonical same origin and password Auth precede dispatch; no caller-controlled authority", async () => {
  const s = await setup(), body = { query: s.f.query, command: s.f.command };
  for (const headers of [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) assert.equal((await handleApplicationWindow(post(body, headers), s.deps)).status, 403);
  assert.equal(s.auth.length, 0);
  const bad = { ...s.deps, authenticate: async () => ({ user: { id: windowActor } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) };
  assert.equal((await handleApplicationWindow(post(body), bad)).status, 403);
  assert.equal((await handleApplicationWindow(post({ ...body, authUserId: id(99) }), s.deps)).status, 400); assert.equal(s.calls.length, 0);
});
test("194 fresh prepare GET is read-only and new POST passes one actual Auth-bound command", async () => {
  const s = await setup(); const read = await handleApplicationWindow(get(s.f.query), s.deps); assert.equal(read.status, 200); assert.equal(s.calls[0].command, null);
  assert.equal(s.calls[0].authUserId, windowActor); assert.equal(s.calls[0].allowWrite, true); assert.match(read.headers.get("cache-control")!, /private.*no-store/);
  const written = await handleApplicationWindow(post({ query: s.f.query, command: s.f.command }), s.deps); assert.equal(written.status, 200); assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls[1].command, s.f.command); assert.equal((await written.json()).data.mode, "receipt");
});
test("194 disabled or entitlement-lost POST reaches SQL once with false for exact replay; fresh rejects there", async () => {
  const s = await setup(), body = { query: s.f.query, command: s.f.command };
  assert.equal((await handleApplicationWindow(post(body), { ...s.deps, enabled: () => false })).status, 200); assert.equal(s.calls[0].allowWrite, false); assert.equal(s.entitlement.length, 0);
  assert.equal((await handleApplicationWindow(post(body), { ...s.deps, entitlement: async () => { throw Error("eligibility unavailable"); } })).status, 200); assert.equal(s.calls[1].allowWrite, false);
  let n = 0; const rejected = await handleApplicationWindow(post(body), { ...s.deps, enabled: () => false, execute: async input => { n++; assert.equal(input.allowWrite, false); throw new MerchantAttendanceError("attendance_application_window_disabled"); } });
  assert.equal(rejected.status, 403); assert.equal(n, 1); assert.equal((await handleApplicationWindow(get(s.f.query), { ...s.deps, enabled: () => false })).status, 403);
});
test("194 flag-off recovery is GET minimal original receipt without entitlement", async () => {
  const s = await setup(), query: ApplicationWindowQuery = { siteId: s.f.query.siteId, family: "correction", mode: "recover", operationId: id(300) };
  const result = await handleApplicationWindow(get(query), { ...s.deps, enabled: () => false, entitlement: async () => { assert.fail("recover must not consult eligibility"); } });
  assert.equal(result.status, 200); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].allowWrite, false); assert.equal(s.calls[0].command, null);
  const data = (await result.json()).data; assert.equal(data.application, null); assert.equal(data.window, null); assert.equal(data.canSubmit, false);
});
test("194 duplicate fields, malformed UTF8, body/query bounds and stale window response fail closed", async () => {
  const s = await setup();
  assert.equal((await handleApplicationWindow(post({ padding: "x".repeat(16384) }), s.deps)).status, 413);
  const duplicate = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"query":null,"query":null}' });
  assert.equal((await handleApplicationWindow(duplicate, s.deps)).status, 400);
  const utf8 = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0xff]) }); assert.equal((await handleApplicationWindow(utf8, s.deps)).status, 400);
  assert.equal((await handleApplicationWindow(new Request(url + "?" + "x".repeat(4097), { headers: { origin } }), s.deps)).status, 422); assert.equal(s.calls.length, 0);
  const bad = await handleApplicationWindow(get(s.f.query), { ...s.deps, execute: async () => ({ ...s.f.result, actorId: id(99) }) }); assert.equal(bad.status, 503);
});
test("194 one deadline covers stalled body and late authentication without late mutation dispatch", async () => {
  const s = await setup(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const request = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleApplicationWindow(request, { ...s.deps, timeoutMs: 15 })).status, 503); assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  let finish!: () => void; const auth = new Promise<void>(resolve => { finish = resolve; });
  const result = await handleApplicationWindow(post({ query: s.f.query, command: s.f.command }), { ...s.deps, timeoutMs: 15, authenticate: async r => { await auth; return s.deps.authenticate(r); } });
  assert.equal(result.status, 503); finish(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(s.calls.length, 0);
});
