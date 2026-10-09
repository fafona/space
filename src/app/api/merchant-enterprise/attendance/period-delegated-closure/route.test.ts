import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handlePeriodDelegatedClosures, periodDelegatedClosuresDependencies as defaults } from "./route-handler";
import { executePeriodDelegatedClosures } from "@/lib/merchantAttendancePeriodDelegatedClosure.server";
import { periodDelegatedClosureQueryString, periodDelegatedClosureFingerprintText, type PeriodDelegatedClosureQuery,
  type PeriodDelegatedClosureCommand, type PeriodDelegatedClosureResult } from "@/lib/merchantAttendancePeriodDelegatedClosure";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";

// Mock authenticated context and RPC protocol only, never real Auth/SQL.
const id = (n: number) => `26000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), employee = id(2), url = "https://www.faolla.com/api/merchant-enterprise/attendance/period-delegated-closure";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const readAt = "2026-10-08T10:00:00.000000Z";
function query(mode: PeriodDelegatedClosureQuery["mode"] = "list"): PeriodDelegatedClosureQuery { return {
  siteId: "99990233", access: "delegate", grantId: id(3), workerId: id(4), fromDate: "2026-10-01", throughDate: "2026-10-01",
  mode, periodId: ["list", "preview"].includes(mode) ? null : id(5), operationId: mode === "recover" ? id(6) : null, version: null, cursor: null,
}; }
function command(): PeriodDelegatedClosureCommand { return { action: "respond", operationId: id(6), periodId: id(5), expectedRevision: 2, expectedVersion: 1, expectedFingerprint: null, reason: "Synthetic response" }; }
function result(q: PeriodDelegatedClosureQuery, c: PeriodDelegatedClosureCommand | null = null): PeriodDelegatedClosureResult {
  const common = { protocol: "period-delegated-closure-v1" as const, siteId: q.siteId, access: q.access, workerId: q.workerId,
    grantId: q.grantId, actorId: actor, employeeId: employee, readAt };
  if (q.mode === "recover" || c) return { ...common, kind: "receipt", usableActions: [], receipt: c ? {
    operationId: c.operationId, action: c.action, grantId: q.grantId, grantRevision: 1, periodId: c.periodId, periodRevision: c.expectedRevision + 1,
    actorId: actor, recordedAt: readAt, commandFingerprint: createHash("sha256").update(periodDelegatedClosureFingerprintText(q, c)).digest("hex"),
  } : null };
  return { ...common, usableActions: ["view"], kind: "list", items: [], nextCursor: null };
}
const get = (q = query(), suffix = "") => new Request(`${url}?${periodDelegatedClosureQueryString(q)}${suffix}`, { headers });
const post = (body: unknown = { query: query("detail"), command: command() }, extra: Record<string, string> = {}, suffix = "") =>
  new Request(url + suffix, { method: "POST", headers: { ...headers, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { siteEnabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return result(input.query, input.command ?? null); }, ...patch };
  return { deps, calls };
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
}

test("GET/POST use validated actual Auth, strict wire and private no-store responses", async () => {
  const f = setup();
  for (const request of [get(), post()]) { const response = await handlePeriodDelegatedClosures(request, f.deps); assert.equal(response.status, 200); privateHeaders(response);
    const wire = await response.json(); assert.equal(wire.ok, true); assert.equal(wire.moduleEnabled, true); assert.equal(wire.data.actorId, actor); }
  assert.deepEqual(f.calls.map(x => x.authUserId), [actor, actor]); assert.equal(f.calls[0].command, null); assert.deepEqual(f.calls[1].command, command());
});

test("recover alone bypasses entitlement and rollout, but retains Auth, rate gate and minimal receipt", async () => {
  let authentications = 0, limitedActor = "";
  const f = setup({ authenticate: async () => { authentications++; return { user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }; },
    allow: who => { limitedActor = who; return true; }, siteEnabled: () => { throw Error("no rollout lookup"); }, entitlement: async () => { throw Error("no entitlement lookup"); } });
  const response = await handlePeriodDelegatedClosures(get(query("recover")), f.deps); assert.equal(response.status, 200); privateHeaders(response);
  const wire = await response.json(); assert.equal(wire.moduleEnabled, false); assert.equal(wire.data.kind, "receipt"); assert.equal(wire.data.receipt, null);
  assert.deepEqual(wire.data.usableActions, []); assert(!Object.hasOwn(wire.data, "source")); assert(!Object.hasOwn(wire.data, "artifact"));
  assert.equal(authentications, 1); assert.equal(limitedActor, actor); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].moduleEnabled, false);
});

test("all fresh reads and writes including delegated reopening need entitlement and rollout", async () => {
  for (const patch of [{ siteEnabled: () => false }, { entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> },
    { entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: false, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>> }]) {
    const f = setup(patch);
    for (const request of [...(["list", "preview", "detail", "history", "versions"] as const).map(mode => get(query(mode))),
      ...(["send", "respond", "seal", "reopen"] as const).map(action => post({ query: query("detail"), command: { ...command(), action, expectedFingerprint: ["send", "seal"].includes(action) ? "a".repeat(64) : null } }))]) {
      const response = await handlePeriodDelegatedClosures(request, f.deps); assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "attendance_period_delegation_disabled" });
    }
    assert.equal(f.calls.length, 0);
  }
});

test("every delegated path including recover requires password AMR and rejects invite/recovery mixtures", async () => {
  const f = setup();
  for (const authenticationMethods of [[], ["otp"], ["oauth"], ["invite"], ["magiclink"], ["recovery"], ["password", "recovery"], ["password", "magiclink"]]) {
    for (const request of [get(), get(query("recover")), post()]) {
      const response = await handlePeriodDelegatedClosures(request, { ...f.deps, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods }) });
      assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "employee_password_authentication_required" });
    }
  }
  assert.equal(f.calls.length, 0);
});

test("method/origin guards precede Auth and rate denial cannot reach a recovery service", async () => {
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("must not authenticate"); } });
  for (const method of ["DELETE", "PATCH", "PUT", "HEAD"]) { const response = await handlePeriodDelegatedClosures(new Request(url, { method }), f.deps);
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, POST"); privateHeaders(response); }
  for (const request of [new Request(get().url.replace("www.faolla.com", "external.invalid")), new Request(get(), { headers: { ...headers, origin: "https://external.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "cross-site" } }),
    new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })]) assert.equal((await handlePeriodDelegatedClosures(request, f.deps)).status, 403);
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
  const rate = setup({ allow: () => false }), response = await handlePeriodDelegatedClosures(get(query("recover")), rate.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(rate.calls.length, 0);
});

test("body and URL cannot supply actor/authority, duplicate keys, altered scope or a self action", async () => {
  const f = setup(), body = { query: query("detail"), command: command() };
  for (const request of [get(query(), "&siteId=99990233"), get(query(), "&actorId=" + actor), get(query(), "&command=%7B%7D"),
    post(body, {}, "?mode=detail"), post({ ...body, authUserId: actor }), post({ ...body, artifact: {} }), post({ ...body, command: { ...command(), authority: {} } }),
    post({ ...body, command: { ...command(), periodId: id(99) } }), post({ ...body, command: { ...command(), action: "confirm" } }),
    post({ ...body, query: { ...body.query, access: "owner" } }), post(JSON.stringify(body).replace('"reason":', '"reason":"first","reason":')), post("{")]) {
    const response = await handlePeriodDelegatedClosures(request, f.deps); assert.equal(response.status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test("JSON MIME, declared and actual 8KiB limits, fatal UTF8 fail before business execution", async () => {
  const f = setup();
  const cases: [Request, number][] = [[post("{}", { "content-type": "text/plain" }), 415], [post("{}", { "content-type": "application/json;charset=latin1" }), 415],
    [post("{}", { "content-length": "8193" }), 413], [post("{}", { "content-length": "-1" }), 413],
    [post("x".repeat(8193), { "content-length": "2" }), 413], [new Request(url, { method: "POST", headers, body: new Uint8Array([0x7b, 0xff, 0x7d]) }), 400]];
  for (const [request, status] of cases) { const response = await handlePeriodDelegatedClosures(request, f.deps); assert.equal(response.status, status); privateHeaders(response); }
  assert.equal(f.calls.length, 0);
});

test("body deadline is bounded at 5s and abort cancels unfinished input without execution", async () => {
  assert.equal(defaults.bodyTimeoutMs, 5000); let cancelled = 0;
  const f = setup({ bodyTimeoutMs: 15 }), stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled++; } });
  const request = new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  const started = performance.now(); assert.equal((await handlePeriodDelegatedClosures(request, f.deps)).status, 400); assert(performance.now() - started < 1000); assert(cancelled >= 1);
  const controller = new AbortController(); controller.abort();
  assert.equal((await handlePeriodDelegatedClosures(new Request(post(), { signal: controller.signal }), f.deps)).status, 400);
  for (const bodyTimeoutMs of [0, 5001]) assert.equal((await handlePeriodDelegatedClosures(post(), { ...f.deps, bodyTimeoutMs })).status, 503);
  assert.equal(f.calls.length, 0);
});

test("unknown exceptions never disclose messages and only exact typed public errors pass through", async () => {
  const f = setup();
  for (const error of [Error("secret database rows"), new MerchantAttendanceError("secret database rows"), new MerchantEnterpriseAccessError("secret identity", 403)]) {
    const response = await handlePeriodDelegatedClosures(post(), { ...f.deps, execute: async () => { throw error; } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" }); privateHeaders(response);
  }
  const known = await handlePeriodDelegatedClosures(post(), { ...f.deps, execute: async () => { throw new MerchantAttendanceError("attendance_operation_conflict"); } });
  assert.equal(known.status, 409); assert.deepEqual(await known.json(), { ok: false, error: "attendance_operation_conflict" });
  for (const status of [401, 403]) { const response = await handlePeriodDelegatedClosures(get(query("recover")), { ...f.deps, authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", status); } });
    assert.equal(response.status, status === 401 ? 401 : 503); }
});

test("actual handler and service bind command SHA and reject substituted successful identities", async () => {
  const f = setup(); let calls = 0;
  const execute: typeof defaults.execute = input => executePeriodDelegatedClosures(input, { rpc: async (_name, args) => {
    calls++; assert.equal(args.p_auth_user_id, actor); return { data: result(input.query, input.command ?? null), error: null };
  } });
  assert.equal((await handlePeriodDelegatedClosures(post(), { ...f.deps, execute })).status, 200); assert.equal(calls, 1);
  for (const patch of [{ actorId: id(99) }, { commandFingerprint: "0".repeat(64) }]) {
    const invalid: typeof defaults.execute = input => executePeriodDelegatedClosures(input, { rpc: async () => {
      const r = result(input.query, input.command ?? null); if (r.kind !== "receipt" || !r.receipt) throw Error("fixture");
      return { data: { ...r, receipt: { ...r.receipt, ...patch } }, error: null };
    } });
    const response = await handlePeriodDelegatedClosures(post(), { ...f.deps, execute: invalid }); assert.equal(response.status, 503);
  }
  const malformed = await handlePeriodDelegatedClosures(get(), { ...f.deps, execute: async () => ({ ...result(query()), actorId: id(99) }) });
  assert.equal(malformed.status, 503);
});
