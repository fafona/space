import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handlePeriodDelegation, periodDelegationDependencies as defaults } from "./route-handler";
import { executePeriodDelegation } from "@/lib/merchantAttendancePeriodDelegation.server";
import { periodDelegationQueryString, periodDelegationFingerprintText, type PeriodDelegationQuery,
  type PeriodDelegationCommand, type PeriodDelegationResult } from "@/lib/merchantAttendancePeriodDelegation";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";

const id = (n: number) => `24000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const owner = id(1), delegate = id(3), url = "https://www.faolla.com/api/merchant-enterprise/attendance/period-delegation";
const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
const query = (access: PeriodDelegationQuery["access"] = "owner", mode: PeriodDelegationQuery["mode"] = "list"): PeriodDelegationQuery => ({
  siteId: "99990232", access, mode, catalog: mode === "catalog" ? "delegates" : null,
  grantId: mode === "detail" ? id(10) : null, afterId: null, operationId: mode === "recover" ? id(10) : null,
});
const command = (): PeriodDelegationCommand => ({ action: "grant", operationId: id(10), delegateEmployeeId: id(2), delegateAuthUserId: delegate,
  workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6), fromDate: "2026-10-01", throughDate: "2026-10-31", actions: ["view", "send"], includeExisting: false,
  validFrom: "2026-10-08T09:00:00.000000Z", validUntil: "2026-10-09T09:00:00.000000Z", reason: "Synthetic delegation" });
const get = (q: PeriodDelegationQuery = query()) => new Request(`${url}?${periodDelegationQueryString(q)}`, { headers });
const post = (q: PeriodDelegationQuery = query(), c: PeriodDelegationCommand = command()) => new Request(url, { method: "POST", headers, body: JSON.stringify({ query: q, command: c }) });
function wire(q: PeriodDelegationQuery, c: PeriodDelegationCommand | null, actor = q.access === "owner" ? owner : delegate): PeriodDelegationResult {
  return { protocol: "period-delegation-v1", siteId: q.siteId, access: q.access, actorId: actor, employeeId: q.access === "owner" ? null : id(2), mode: q.mode,
    canWrite: q.mode !== "recover", grants: [], catalogItems: [], nextAfterId: null,
    detail: q.mode === "detail" && c === null ? { grantId: id(10), revision: 1, status: "granted",
      delegate: { employeeId: id(2), authUserId: delegate, name: "Synthetic delegate" }, worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "Synthetic worker", workerNo: "T-1" },
      fromDate: "2026-10-01", throughDate: "2026-10-31", actions: ["view"], includeExisting: false, validFrom: "2026-10-08T09:00:00.000000Z",
      validUntil: "2026-10-09T09:00:00.000000Z", grantedBy: owner, grantedAt: "2026-10-08T10:00:00.000000Z", reason: "Synthetic", revocation: null, usableActions: ["view"] } : null,
    receipt: c ? { operationId: c.operationId, action: c.action, grantId: c.action === "grant" ? c.operationId : c.grantId, grantRevision: c.action === "grant" ? 1 : 2,
      periodId: null, periodRevision: null, actorId: actor, recordedAt: "2026-10-08T10:00:00.000000Z",
      commandFingerprint: createHash("sha256").update(periodDelegationFingerprintText(q, c)).digest("hex") } : null,
    readAt: "2026-10-08T10:05:00.000000Z" };
}
function setup(patch: Partial<typeof defaults> = {}) {
  const calls: Parameters<typeof defaults.execute>[0][] = [];
  const deps: typeof defaults = { enabled: () => true, allow: () => true, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute: async input => { calls.push(input); return wire(input.query, input.command, input.authUserId); }, ...patch };
  return { deps, calls };
}

test("GET and POST preserve real auth, exact query and response no-store guards", async () => {
  const f = setup();
  for (const request of [get(), post()]) {
    const response = await handlePeriodDelegation(request, f.deps); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
    const data = await response.json(); assert.equal(data.ok, true); assert.equal(data.actorId, owner); assert.equal(data.protocol, "period-delegation-v1");
  }
  assert.deepEqual(f.calls.map(x => x.authUserId), [owner, owner]); assert.equal(f.calls[0].command, null); assert.equal(f.calls[1].command?.operationId, id(10));
});

test("safe owner metadata, explicit revoke and both original-actor recoveries skip flag and entitlement", async () => {
  const f = setup({ enabled: () => { throw Error("safe must not consult rollout"); }, entitlement: async () => { throw Error("safe must not consult entitlement"); } });
  for (const q of [query(), query("owner", "detail"), query("owner", "recover")]) assert.equal((await handlePeriodDelegation(get(q), f.deps)).status, 200);
  const c: PeriodDelegationCommand = { action: "revoke", operationId: id(11), grantId: id(10), expectedRevision: 1, reason: "Revoke" };
  assert.equal((await handlePeriodDelegation(post(query("owner", "detail"), c), f.deps)).status, 200);
  const delegateDeps = { ...f.deps, authenticate: async () => ({ user: { id: delegate } as User, accessToken: "synthetic", authenticationMethods: ["password"] }) };
  assert.equal((await handlePeriodDelegation(get(query("delegate", "recover")), delegateDeps)).status, 200);
  assert.equal(f.calls.length, 5); assert(f.calls.every(x => x.allowWrite === false)); assert.equal(f.calls[4].authUserId, delegate);
});

test("flag off blocks ordinary delegate discovery, owner catalog and new grant before execute", async () => {
  const f = setup({ enabled: () => false });
  for (const request of [get(query("delegate")), get(query("delegate", "detail")), get(query("owner", "catalog")), post()]) {
    const response = await handlePeriodDelegation(request, f.deps); assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "attendance_period_delegation_disabled" });
  }
  assert.equal(f.calls.length, 0);
  const disabled = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof defaults.entitlement>> });
  assert.equal((await handlePeriodDelegation(post(), disabled.deps)).status, 403); assert.equal(disabled.calls.length, 0);
});

test("method, origin, strong-auth and rate gates run before RPC and remain on safety paths", async () => {
  const f = setup(); const wrongMethod = await handlePeriodDelegation(new Request(url, { method: "DELETE" }), f.deps);
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get("allow"), "GET, POST");
  for (const request of [new Request(get().url.replace("www.faolla.com", "other.invalid")), new Request(get(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(get(), { headers: { ...headers, "sec-fetch-site": "same-site" } }), new Request(get(), { headers: { ...headers, "sec-fetch-site": "cross-site" } })]) {
    assert.equal((await handlePeriodDelegation(request, f.deps)).status, 403);
  }
  for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) {
    assert.equal((await handlePeriodDelegation(get(query("owner", "recover")), { ...f.deps,
      authenticate: async () => ({ user: { id: owner } as User, accessToken: "", authenticationMethods }) })).status, 403);
  }
  const rate = await handlePeriodDelegation(get(), { ...f.deps, allow: () => false });
  assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60"); assert.equal(f.calls.length, 0);
});

test("GET cannot mutate; duplicate URL/body keys, extra identities and scope mismatches fail closed", async () => {
  const f = setup();
  for (const request of [new Request(get().url + "&siteId=99990232", { headers }), new Request(get().url + "&command=%7B%7D", { headers }),
    new Request(get().url + "&actorId=" + owner, { headers }), new Request(url + "?siteId=99990232", post()),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query("delegate"), command: command() }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(), command: { ...command(), actorId: owner } }) }),
    new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(), command: command() }).replace('"reason":', '"reason":"first","reason":') }),
    new Request(url, { method: "POST", headers, body: "{" })]) assert.equal((await handlePeriodDelegation(request, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("content type, declared and actual8KiB body bounds and fatal UTF8 apply before auth", async () => {
  let auth = 0; const f = setup({ authenticate: async () => { auth++; throw Error("must not authenticate"); } });
  const requests: [Request, number][] = [
    [new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), 415],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "8193" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "-1" }, body: "{}" }), 413],
    [new Request(url, { method: "POST", headers: { ...headers, "content-length": "2" }, body: "x".repeat(8193) }), 413],
    [new Request(url, { method: "POST", headers, body: new Uint8Array([0x7b, 0xff, 0x7d]) }), 400],
    [new Request(url, { method: "POST", headers, body: " " }), 400],
  ];
  for (const [request, status] of requests) assert.equal((await handlePeriodDelegation(request, f.deps)).status, status);
  assert.equal(auth, 0); assert.equal(f.calls.length, 0);
});

test("hanging body and already-aborted requests stop within total body deadline without auth", async () => {
  let cancelled = 0, authenticated = 0; const f = setup({ bodyTimeoutMs: 15, authenticate: async () => { authenticated++; throw Error("must not authenticate"); } });
  const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled++; } });
  const hanging = new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  const start = performance.now(); assert.equal((await handlePeriodDelegation(hanging, f.deps)).status, 400); assert(performance.now() - start < 1000);
  const controller = new AbortController(); controller.abort();
  const aborted = new Request(url, { method: "POST", headers, body: JSON.stringify({ query: query(), command: command() }), signal: controller.signal });
  assert.equal((await handlePeriodDelegation(aborted, f.deps)).status, 400); assert(cancelled >= 1); assert.equal(authenticated, 0);
});

test("only exact typed public errors are returned; arbitrary throw messages never certify no write", async () => {
  const f = setup();
  for (const error of [Error("attendance_operation_conflict"), new MerchantAttendanceError("private table secret"), new MerchantEnterpriseAccessError("private identity", 403)]) {
    const response = await handlePeriodDelegation(post(), { ...f.deps, execute: async () => { throw error; } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const refusal = await handlePeriodDelegation(post(), { ...f.deps, execute: async () => { throw new MerchantAttendanceError("attendance_operation_conflict"); } });
  assert.equal(refusal.status, 409); assert.deepEqual(await refusal.json(), { ok: false, error: "attendance_operation_conflict" });
  const unauthorized = await handlePeriodDelegation(get(), { ...f.deps, authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 401); } });
  assert.equal(unauthorized.status, 401);
  const wrongStatus = await handlePeriodDelegation(get(), { ...f.deps, authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 403); } });
  assert.equal(wrongStatus.status, 503);
});

test("actual service plus handler verifies SHA and rejects a substituted successful receipt", async () => {
  const f = setup(); let rpcCount = 0;
  const execute: typeof defaults.execute = input => executePeriodDelegation(input, { rpc: async () => {
    rpcCount++; return { data: wire(input.query, input.command, input.authUserId), error: null };
  } });
  const response = await handlePeriodDelegation(post(), { ...f.deps, execute }); assert.equal(response.status, 200); assert.equal(rpcCount, 1);
  const invalid: typeof defaults.execute = input => executePeriodDelegation(input, { rpc: async () => {
    const data = wire(input.query, input.command, input.authUserId); data.receipt!.commandFingerprint = "0".repeat(64); return { data, error: null };
  } });
  const mismatch = await handlePeriodDelegation(post(), { ...f.deps, execute: invalid }); assert.equal(mismatch.status, 503);
  assert.deepEqual(await mismatch.json(), { ok: false, error: "attendance_period_delegation_invalid" });
});

test("response validation rejects actor or private payload substitution even from an injected executor", async () => {
  const f = setup();
  for (const change of [{ actorId: delegate }, { siteId: "99990233" }, { source: { private: true } }, { receipt: { arbitrary: true } }]) {
    const response = await handlePeriodDelegation(get(), { ...f.deps, execute: async input => ({ ...wire(input.query, input.command), ...change }) as PeriodDelegationResult });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_period_delegation_invalid" });
  }
});
