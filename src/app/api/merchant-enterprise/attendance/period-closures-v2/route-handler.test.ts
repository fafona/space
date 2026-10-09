import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handlePeriodClosuresV2, periodClosuresV2Dependencies } from "./route-handler";
import { periodClosureV2QueryString } from "@/lib/merchantAttendancePeriodClosureV2";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { periodClosureUiCommand as command,
  periodClosureUiOwner as owner, periodClosureUiAuth as auth, periodClosureUiId as id } from "../../../../../../scripts/fixtures/attendance-period-closure-ui-model";

import { periodClosureV2FixtureQuery as query, periodClosureV2FixtureResult } from "../../../../../../scripts/fixtures/attendance-period-closure-v2-model";
const wire = (...args: Parameters<typeof periodClosureV2FixtureResult>) => ({ ok: true as const, moduleEnabled: true, data: periodClosureV2FixtureResult(...args) });

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/period-closures-v2";
const get = (q = query(), suffix = "") => new Request(url + "?" + periodClosureV2QueryString(q) + suffix);
const post = (body: unknown = { query: query("detail"), command: command() }, headers: Record<string, string> = {}, suffix = "") => new Request(url + suffix,
  { method: "POST", headers: { "content-type": "application/json", origin: "https://www.faolla.com", "sec-fetch-site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
type Dependencies = typeof periodClosuresV2Dependencies;
function setup(patch: Partial<Dependencies> = {}) {
  const calls: Parameters<Dependencies["execute"]>[0][] = [];
  const deps: Dependencies = {
    siteEnabled: () => true,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<Dependencies["entitlement"]>>,
    allow: () => true, bodyTimeoutMs: 5000,
    execute: async input => { calls.push(input); return wire(input.query, input.command ?? null).data; }, ...patch,
  }; return { deps, calls };
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
}

test("canonical origin and method guards run before authenticated business reads", async () => {
  let authentications = 0; const f = setup({ authenticate: async () => { authentications++; throw Error("unexpected"); } });
  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
    const response = await handlePeriodClosuresV2(new Request(url, { method }), f.deps);
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, POST"); privateHeaders(response);
  }
  for (const request of [new Request(get().url.replace("www.faolla.com", "evil.invalid")), new Request(get(), { headers: { origin: "https://evil.invalid" } }),
    new Request(get(), { headers: { "sec-fetch-site": "cross-site" } }), new Request(get(), { headers: { "sec-fetch-site": "same-site" } }),
    post(undefined, { origin: "https://evil.invalid" })]) assert.equal((await handlePeriodClosuresV2(request, f.deps)).status, 403);
  assert.equal(authentications, 0); assert.equal(f.calls.length, 0);
});

test("weak/recovery authentication and limiter failures never reach SQL service", async () => {
  const f = setup();
  for (const methods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "invite"]]) {
    const response = await handlePeriodClosuresV2(get(), { ...f.deps, authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal(response.status, 403); privateHeaders(response);
  }
  const limited = await handlePeriodClosuresV2(get(), { ...f.deps, allow: () => false });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});

test("GET cannot mutate, duplicate parameters or inject another actor or archive", async () => {
  const f = setup();
  for (const suffix of ["&command={}", "&artifact={}", "&actorId=" + owner, "&siteId=87654321", "&expectedRevision=0", "&__proto__=x"])
    assert.equal((await handlePeriodClosuresV2(get(query(), suffix), f.deps)).status, 400);
  const badMode = new URL(get().url); badMode.searchParams.set("mode", "send");
  assert.equal((await handlePeriodClosuresV2(new Request(badMode), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("strict POST body rejects artifacts, duplicate JSON keys, queries and role-inappropriate actions", async () => {
  const f = setup(), q = query("detail"), c = command();
  for (const body of [{ query: q, command: c, artifact: { source: "forged" } }, { query: q, command: { ...c, authUserId: owner } },
    { query: { ...q, access: "self" }, command: c }, { query: q, command: { ...c, action: "confirm", expectedRevision: 1, expectedVersion: 1 } }])
    assert.equal((await handlePeriodClosuresV2(post(body), f.deps)).status, 400);
  const duplicate = `{"query":${JSON.stringify(q)},"query":${JSON.stringify(q)},"command":${JSON.stringify(c)}}`;
  assert.equal((await handlePeriodClosuresV2(post(duplicate), f.deps)).status, 400);
  assert.equal((await handlePeriodClosuresV2(post({ query: q, command: c }, {}, "?workerId=" + q.workerId), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("body MIME, byte cap and malformed UTF8 fail without business execution", async () => {
  const f = setup();
  const mime = await handlePeriodClosuresV2(post(undefined, { "content-type": "text/plain" }), f.deps); assert.equal(mime.status, 415);
  const claimed = await handlePeriodClosuresV2(post(undefined, { "content-length": "8193" }), f.deps); assert.equal(claimed.status, 413);
  const actual = await handlePeriodClosuresV2(post(" ".repeat(8193)), f.deps); assert.equal(actual.status, 413);
  const malformed = new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://www.faolla.com" }, body: new Uint8Array([0xc3, 0x28]) });
  assert.equal((await handlePeriodClosuresV2(malformed, f.deps)).status, 400); assert.equal(f.calls.length, 0);
});

test("body deadline covers a never-finishing stream and returns a bounded error", async () => {
  const f = setup({ bodyTimeoutMs: 5 });
  const request = new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://www.faolla.com" },
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }), duplex: "half" } as RequestInit);
  const response = await handlePeriodClosuresV2(request, f.deps); assert.equal(response.status, 400); privateHeaders(response); assert.equal(f.calls.length, 0);
});

test("creation flag off preserves authorized archive GET and owner reopen with moduleEnabled false", async () => {
  const f = setup({ siteEnabled: () => false }), q = query("detail");
  const read = await handlePeriodClosuresV2(get(q), f.deps); assert.equal(read.status, 200); privateHeaders(read);
  assert.equal((await read.json()).moduleEnabled, false); assert.equal(f.calls[0].command, null); assert.equal(f.calls[0].moduleEnabled, false);
  const c = { ...command(), action: "reopen", expectedRevision: 3, expectedVersion: 1, expectedFingerprint: null, reason: "Owner review" };
  const reopened = await handlePeriodClosuresV2(post({ query: q, command: c }), f.deps); assert.equal(reopened.status, 200);
  assert.equal(f.calls[1].moduleEnabled, false); assert.equal(f.calls[1].command!.action, "reopen");
});

test("module pause is passed to SQL instead of blocking exact operation recovery", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<Dependencies["entitlement"]>> });
  const response = await handlePeriodClosuresV2(get(query("recover")), f.deps); assert.equal(response.status, 200);
  assert.equal(f.calls[0].moduleEnabled, false); assert.equal(f.calls[0].command, null);
});

test("the real login Auth UUID, not employee or owner request fields, reaches the service", async () => {
  const f = setup({ authenticate: async () => ({ user: { id: auth } as User, accessToken: "synthetic", authenticationMethods: ["password"] }) });
  const q = query("detail", "self"), response = await handlePeriodClosuresV2(get(q), f.deps);
  assert.equal(response.status, 200); assert.equal(f.calls[0].authUserId, auth); assert.notEqual(f.calls[0].authUserId, owner);
  assert.deepEqual(f.calls[0].query, q); assert.equal(f.calls[0].command, null);
});

test("known business errors remain distinct while unknown SQL and mismatched auth errors are sanitized", async () => {
  for (const [code, status] of [["attendance_period_protocol_required",409],["attendance_period_storage_limit",422],["attendance_period_sealed", 409], ["attendance_period_source_identity_unproven", 409], ["attendance_period_source_too_large", 422], ["attendance_access_denied", 403], ["attendance_operation_not_found", 404]] as const) {
    const response = await handlePeriodClosuresV2(get(), setup({ execute: async () => { throw new MerchantAttendanceError(code); } }).deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); privateHeaders(response);
  }
  for (const error of [Error("private SQL connection"), new MerchantAttendanceError("private_column"), new MerchantEnterpriseAccessError("authentication_required", 500)]) {
    const response = await handlePeriodClosuresV2(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const unauth = await handlePeriodClosuresV2(get(), setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("authentication_required", 401); } }).deps);
  assert.equal(unauth.status, 401);
});

test("injected mismatched actor or private result fields do not reach the HTTP response", async () => {
  const q = query("detail");
  for (const patch of [{ actorId: id(600) }, { artifactText: "private server body" }, { workerId: id(601) }]) {
    const response = await handlePeriodClosuresV2(get(q), setup({ execute: async () => ({ ...wire(q).data, ...patch }) }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_period_closure_invalid" });
  }
});

test("cursor scope, duplicate JSON keys and unexpected page fields are rejected before execution", async () => {
  const f=setup(),q=query("history");
  const cursor={kind:"history",siteId:q.siteId,access:q.access,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate,
    periodId:q.periodId,atRevision:101,beforeRevision:52};
  for(const bad of [{...cursor,siteId:"87654321"},{...cursor,kind:"versions"},{...cursor,beforeRevision:102},{...cursor,private:true}]) {
    const u=new URL(url);for(const [key,value] of Object.entries(q))if(value!==null)u.searchParams.set(key,String(value));
    u.searchParams.set("cursor",JSON.stringify(bad));assert.equal((await handlePeriodClosuresV2(new Request(u),f.deps)).status,400);
  }
  const u=new URL(url);for(const [key,value] of Object.entries(q))if(value!==null)u.searchParams.set(key,String(value));
  u.searchParams.set("cursor",JSON.stringify(cursor).replace('"atRevision":101','"atRevision":101,"atRevision":100'));
  assert.equal((await handlePeriodClosuresV2(new Request(u),f.deps)).status,400);assert.equal(f.calls.length,0);
});

