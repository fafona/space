import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleRetention, retentionDependencies } from "./route-handler";
import { executeRetention, retentionCommandFingerprint } from "@/lib/merchantAttendanceRetention.server";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { RETENTION_API, RETENTION_CATEGORIES, RETENTION_ERRORS, retentionQueryString, retentionWriteQuery } from "@/lib/merchantAttendanceRetention";
import type { RetentionCommand, RetentionQuery, RetentionResult } from "@/lib/merchantAttendanceRetentionContract";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990227", owner = id(1), at = "2026-10-07T12:00:00.000001Z", origin = "https://www.faolla.com";
const headers = { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" };
const q: RetentionQuery = { siteId, mode: "policies" };
const c: RetentionCommand = { siteId, action: "set_policy", operationId: id(10), category: "events", expectedRevision: 0, retentionDays: null, reason: "默认不设期限" };
type Deps = typeof retentionDependencies;
function common(patch: Partial<Deps> = {}): Deps { return {
  authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic-validated", authenticationMethods: ["password"] }),
  entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<Deps["entitlement"]>>,
  allow: () => true, siteEnabled: () => true, bodyTimeoutMs: 5000, execute: async () => value(), ...patch,
}; }
function value(canWrite = true): RetentionResult { return { protocol: "attendance-retention-v1", siteId, actorId: owner, readAt: at, canWrite,
  data: { kind: "policies", items: RETENTION_CATEGORIES.map(category => ({ category, revision: 0, retentionDays: null, operationId: null, recordedAt: null })) }, receipt: null, disposition: "preview_only" }; }
function saved(): RetentionResult { return { ...value(false), data: { kind: "receipt" }, receipt: { operationId: c.operationId, actorId: owner, revision: 1,
  command: c, commandFingerprint: retentionCommandFingerprint(c), recordedAt: at } }; }
const get = (query: RetentionQuery = q) => new Request(origin + RETENTION_API + "?" + retentionQueryString(query), { headers });
const post = (body: unknown = { query: retentionWriteQuery(c), command: c }, init: RequestInit = {}) => new Request(origin + RETENTION_API, {
  method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body), ...init,
});

test("actual handler→service passes actual Auth, exact query/command and write gate to new RPC only", async () => {
  const calls: Record<string, unknown>[] = [], execute: Deps["execute"] = input => executeRetention(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_retention_v1"); calls.push(args); return { data: input.command ? saved() : value(), error: null }; } });
  for (const req of [get(), post()]) { const r = await handleRetention(req, common({ execute })); assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const body = await r.json(); assert.equal(body.canWrite, body.data.canWrite); }
  assert.deepEqual(calls, [null, c].map(p_command => ({ p_query: q, p_auth_user_id: owner, p_command, p_allow_write: true })));
});
test("flagoff does not early-reject policy GET, exact POST replay or original GET recovery", async () => {
  const calls: boolean[] = [];
  const execute: Deps["execute"] = input => executeRetention(input, { rpc: async (_name, args) => {
    calls.push(args.p_allow_write as boolean); return { data: input.command || input.query.mode === "recover" ? saved() : value(false), error: null }; } });
  for (const req of [get(), post(), get({ siteId, mode: "recover", operationId: c.operationId })]) {
    const r = await handleRetention(req, common({ siteEnabled: () => false, execute })); assert.equal(r.status, 200);
    const body = await r.json(); assert.equal(body.canWrite, false); assert.equal(body.data.canWrite, false);
  } assert.deepEqual(calls, [false, false, false]);
});
test("unknown GET receipt is explicit null, no write/claim generated", async () => {
  const req = get({ siteId, mode: "recover", operationId: c.operationId }); let calls = 0;
  const r = await handleRetention(req, common({ execute: input => executeRetention(input, { rpc: async (_n, args) => {
    calls++; assert.equal(args.p_command, null); return { data: { ...saved(), receipt: null }, error: null }; } }) }));
  assert.equal(r.status, 200); assert.equal((await r.json()).data.receipt, null); assert.equal(calls, 1);
});
test("duplicate or extra query/body authority, recover POST and mismatched target stop before service", async () => {
  let calls = 0; const deps = common({ execute: async () => { calls++; return value(); } });
  const duplicate = JSON.stringify({ query: q, command: c }).replace('"retentionDays":null', '"retentionDays":null,"retentionDays":null');
  for (const req of [get({ siteId, mode: "policies" }), post(duplicate), post({ query: q, command: c, actorId: owner }),
    post({ query: { siteId, mode: "recover", operationId: c.operationId }, command: c }), post({ query: q, command: { ...c, siteId: "99990000" } }),
    new Request(get().url + "&siteId=" + siteId, { headers }), new Request(get().url + "&access=owner", { headers }),
    new Request(origin + RETENTION_API + "?mode=policies", { method: "POST", headers, body: JSON.stringify({ query: q, command: c }) })]) {
    const r = await handleRetention(req, deps); assert.equal(r.status, calls === 1 && req.method === "GET" && req.url === get().url ? 200 : 400);
  } assert.equal(calls, 1);
});
test("canonical origin, method, real password identity and rate checks precede new service", async () => {
  let calls = 0; const execute: Deps["execute"] = async () => { calls++; return value(); };
  const specs: { request: Request; deps?: Partial<Deps>; status: number }[] = [
    { request: new Request(get(), { headers: { ...headers, origin: "https://elsewhere.test" } }), status: 403 },
    { request: new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } }), status: 403 },
    { request: new Request(origin + RETENTION_API, { method: "DELETE", headers }), status: 405 },
    { request: get(), deps: { allow: () => false }, status: 429 },
    { request: get(), deps: { authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) }, status: 403 },
    { request: get(), deps: { authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 401); } }, status: 401 },
  ];
  for (const s of specs) assert.equal((await handleRetention(s.request, common({ execute, ...s.deps }))).status, s.status); assert.equal(calls, 0);
});
test("JSON content type, declared/body bytes and malformed UTF8 are bounded before SQL", async () => {
  let calls = 0; const deps = common({ execute: async () => { calls++; return saved(); } });
  const specs = [
    { req: post(undefined, { headers: { ...headers, "content-type": "text/plain" } }), status: 415 },
    { req: post(undefined, { headers: { ...headers, "content-length": "8193" } }), status: 413 },
    { req: post(" ".repeat(8193)), status: 413 },
    { req: post(undefined, { headers: { ...headers, "content-length": "1" } }), status: 400 },
    { req: post(undefined, { body: new Uint8Array([0xc3, 0x28]) }), status: 400 },
  ];
  for (const s of specs) assert.equal((await handleRetention(s.req, deps)).status, s.status); assert.equal(calls, 0);
});
test("hung request body deadline and abort do not invoke SQL", async () => {
  let cancelled = 0, calls = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const req = new Request(origin + RETENTION_API, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
  const deps = common({ bodyTimeoutMs: 5, execute: async () => { calls++; return saved(); } });
  assert.equal((await handleRetention(req, deps)).status, 400); assert.equal(cancelled, 1); assert.equal(calls, 0);
  const controller = new AbortController(); controller.abort(); assert.equal((await handleRetention(post(undefined, { signal: controller.signal }), deps)).status, 400); assert.equal(calls, 0);
});
test("known SQL errors retain status; unexpected/internal failures never disclose details", async () => {
  for (const [code, status] of Object.entries(RETENTION_ERRORS).filter(([code]) => code.startsWith("attendance_retention_"))) {
    const r = await handleRetention(get(), common({ execute: input => executeRetention(input, { rpc: async () => ({ data: null, error: { message: code } }) }) }));
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: code });
  }
  const r = await handleRetention(get(), common({ execute: input => executeRetention(input, { rpc: async () => ({ data: null, error: { message: "private schema detail" } }) }) }));
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" });
});
test("corrupt actor/receipt and forged canWrite while gate closed are rejected as503", async () => {
  for (const data of [{ ...value(), actorId: id(99) }, value()]) {
    const r = await handleRetention(get(), common({ siteEnabled: () => false, execute: async () => data })); assert.equal(r.status, 503);
  }
  const r = await handleRetention(post(), common({ execute: input => executeRetention(input, { rpc: async () => ({ data: { ...saved(), receipt: { ...saved().receipt!, commandFingerprint: "a".repeat(64) } }, error: null }) }) }));
  assert.equal(r.status, 503);
});
