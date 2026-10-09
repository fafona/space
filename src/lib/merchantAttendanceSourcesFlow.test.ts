import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { sourcesHttp, sourcesId, sourcesOwner as ownerId, sourcesQuery as query, sourcesWire } from "../../scripts/fixtures/attendance-sources-model";
import { AttendanceSourcesClient } from "./merchantAttendanceSourcesClient";
import { sourcesQueryString, parseSourcesResponse } from "./merchantAttendanceSources";
import { executeSources } from "./merchantAttendanceSources.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { handleSources, sourcesDependencies } from "../app/api/merchant-enterprise/attendance/sources/route-handler";
import { resolveCanonicalPortalOrigin } from "./canonicalPortalRequest";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";

const endpoint = resolveCanonicalPortalOrigin() + "/api/merchant-enterprise/attendance/sources";
const request = () => new Request(endpoint + "?" + sourcesQueryString(query));
const response = (body: unknown = sourcesHttp(), status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const defer = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const client = (apiFetch: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs = 1000) => new AttendanceSourcesClient({ ...query, ownerId, apiFetch, timeoutMs });
function setup(overrides: Partial<typeof sourcesDependencies> = {}) {
  const calls: unknown[] = [];
  const deps: Partial<typeof sourcesDependencies> = { enabled: () => true, authenticate: async () => ({ user: { id: ownerId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async site => { assert.equal(site, query.siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof sourcesDependencies.entitlement>>; },
    allow: () => true, execute: async input => { calls.push(input); return sourcesWire(); }, ...overrides };
  return { deps, calls };
}

test("sources route defaults off and only GET from trusted canonical origin reaches authentication", async () => {
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("should not authenticate"); } });
  assert.equal((await handleSources(request(), { ...f.deps, enabled: () => false })).status, 404);
  assert.equal((await handleSources(new Request(endpoint, { method: "POST" }), f.deps)).status, 405);
  assert.equal((await handleSources(new Request("https://external.invalid/api/merchant-enterprise/attendance/sources"), f.deps)).status, 403);
  assert.equal((await handleSources(new Request(request(), { headers: { Origin: "https://external.invalid" } }), f.deps)).status, 403);
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
});
test("sources route requires strong authenticated owner path and exact bounded query before executor", async () => {
  for (const methods of [[], ["invite"], ["password", "recovery"], ["magiclink"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: ownerId } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleSources(request(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  const f = setup();
  for (const suffix of ["&workerId=" + sourcesId(202), "&__proto__=ignored", "&actorId=" + ownerId, "&access=self", "&command=save"]) assert.equal((await handleSources(new Request(request().url + suffix), f.deps)).status, 400);
  assert.equal((await handleSources(new Request(endpoint + "?" + new URLSearchParams({ ...query, throughDate: "2026-10-20" })), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("paused module still allows independent owner-authorized GET with no-store and no mutation authority", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof sourcesDependencies.entitlement>> });
  const result = await handleSources(request(), f.deps);
  assert.equal(result.status, 200); assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls, [{ query, authUserId: ownerId }]);
  const parsed = parseSourcesResponse(await result.json(), query, ownerId); assert.equal(parsed.moduleEnabled, false);
  assert.equal(parsed.attendance.payrollReady, false);
});
test("route limits and typed failures stop reads without exposing private errors", async () => {
  const f = setup({ allow: () => false }); const rate = await handleSources(request(), f.deps);
  assert.equal(rate.status, 429); assert.equal(rate.headers.get("Retry-After"), "60"); assert.equal(f.calls.length, 0);
  const auth = setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } });
  assert.equal((await handleSources(request(), auth.deps)).status, 401); assert.equal(auth.calls.length, 0);
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_sources_invalid", 503], ["attendance_sources_too_large", 422]] as const) {
    const typed = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const result = await handleSources(request(), typed.deps); assert.equal(result.status, status); assert.deepEqual(await result.json(), { ok: false, error: code });
  }
  const hidden = setup({ execute: async () => { throw Error("private SQL details"); } });
  assert.deepEqual(await (await handleSources(request(), hidden.deps)).json(), { ok: false, error: "attendance_unavailable" });
});
test("service uses only single readonly RPC and binds current authenticated actor and all source identities", async () => {
  const input = { query, authUserId: ownerId };
  assert.deepEqual(await executeSources(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_sources_v1"); assert.deepEqual(args, { p_query: query, p_auth_user_id: ownerId });
    return { data: sourcesWire(), error: null };
  } }), sourcesWire());
  for (const patch of [{ actorId: sourcesId(98) }, { siteId: "99990002" }, { unexpected: true }, { attendance: null }]) await assert.rejects(
    executeSources(input, { rpc: async () => ({ data: { ...sourcesWire(), ...patch }, error: null }) }), /attendance_sources_invalid/);
  await assert.rejects(executeSources(input, { rpc: async () => ({ data: null, error: { message: "private SQL detail" } }) }), /attendance_unavailable/);
  await assert.rejects(executeSources(input, null), /attendance_unavailable/);
});
test("client stays idle until explicit query, sends only GET, invalidates result immediately on edit", async () => {
  const calls: RequestInit[] = []; const c = client(async (url, init) => { assert.equal(url, "/api/merchant-enterprise/attendance/sources?" + sourcesQueryString(query)); calls.push(init!); return response(); });
  assert.equal(c.getSnapshot().phase, "idle"); assert.equal(calls.length, 0);
  await c.read(query.fromDate, query.throughDate); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().result!.worker.workerId, query.workerId);
  assert.deepEqual(calls.map(x => x.method), ["GET"]); assert.equal(calls[0].body, undefined);
  c.invalidate(); assert.equal(c.getSnapshot().result, null); assert.equal(calls.length, 1);
  await c.read("", query.throughDate); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(calls.length, 1);
});
test("paused stale and overlapping requests cannot resurrect private sources after hide or newer query", async () => {
  const first = defer<Response>(), second = defer<Response>(); let n = 0;
  const c = client(async () => ++n === 1 ? first.promise : second.promise);
  const pending = c.read(query.fromDate, query.throughDate); c.pause(); first.resolve(response()); await pending;
  assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().phase, "idle");
  const again = c.read(query.fromDate, query.throughDate); second.resolve(response(sourcesHttp(query, false))); await again;
  assert.equal(c.getSnapshot().result!.moduleEnabled, false);
  c.pause(); assert.equal(c.getSnapshot().result, null);
});
test("current permission rejection or malformed foreign reply clears old source results", async () => {
  let next = sourcesHttp() as unknown; let status = 200; const c = client(async () => response(next, status));
  await c.read(query.fromDate, query.throughDate); assert.equal(c.getSnapshot().phase, "ready");
  next = { ok: false, error: "attendance_access_denied" }; status = 403;
  await c.read(query.fromDate, query.throughDate); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().result, null);
  status = 200; next = { ...sourcesHttp(), data: { ...sourcesWire(), actorId: sourcesId(98) } };
  await c.read(query.fromDate, query.throughDate); assert.equal(c.getSnapshot().result, null);
});
test("oversized body and stalled response have bounded failure and never show partial evidence", async () => {
  const large = client(async () => response({ ...sourcesHttp(), huge: "x".repeat(1050000) }));
  await large.read(query.fromDate, query.throughDate); assert.equal(large.getSnapshot().phase, "blocked"); assert.equal(large.getSnapshot().result, null);
  const slow = client(async () => new Promise<Response>(() => {}), 10);
  await slow.read(query.fromDate, query.throughDate); assert.equal(slow.getSnapshot().phase, "blocked"); assert.equal(slow.getSnapshot().result, null);
});
