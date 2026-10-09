// Synthetic actual-Auth context and mocked SQL transport; not a real login.
import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleManagementDelegation, managementDelegationDependencies } from "../app/api/merchant-enterprise/attendance/management-delegation/route-handler";
import { handleDelegatedAudit, delegatedAuditDependencies } from "../app/api/merchant-enterprise/attendance/delegated-audit/route-handler";
import * as m from "./merchantAttendanceManagementDelegation";
import * as a from "./merchantAttendanceDelegatedAudit";
import { executeDelegatedAudit } from "./merchantAttendanceDelegatedAudit.server";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const origin = "https://www.faolla.com", actor = id(1), siteId = "99990203", at = "2026-10-08T13:00:00.000001Z", readAt = "2026-10-08T14:00:00.000000Z";
const auth = async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(origin + path, {
  method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const command: m.ManagementDelegationCommand = { action: "grant", operationId: id(3), delegateEmployeeId: id(2), delegateAuthUserId: id(4),
  delegatedAction: "audit_view", scope: { kind: "audit_company", sources: ["config"] }, validFrom: at, validUntil: "2026-10-09T13:00:00.000001Z", reason: "Synthetic explicit delegation" };
const write: m.ManagementDelegationQuery = { siteId, mode: "write" };
const list: m.ManagementDelegationQuery = { siteId, mode: "list", afterId: null, state: "all", delegatedAction: null };
const recover: m.ManagementDelegationQuery = { siteId, mode: "recover", operationId: command.operationId };
const get = (query: m.ManagementDelegationQuery) => new Request(origin + m.MANAGEMENT_DELEGATION_API + "?" + m.managementDelegationQueryString(query), { headers: { origin } });
async function managementSetup() {
  const receipt: m.ManagementDelegationResult = { protocol: m.MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId: actor, readAt, kind: "receipt", receipt: {
    operationId: command.operationId, actorId: actor, action: "grant", grantId: command.operationId, revision: 1,
    commandFingerprint: await m.managementDelegationCommandFingerprint(siteId, actor, command), recordedAt: at,
  } };
  const calls: Parameters<typeof managementDelegationDependencies.execute>[0][] = [], entitlements: string[] = [];
  const deps: typeof managementDelegationDependencies = { authenticate: auth, enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    entitlement: async site => { entitlements.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof managementDelegationDependencies.entitlement>>; },
    execute: async input => { calls.push(input); return input.query.mode === "list" ? {
      protocol: m.MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId: actor, readAt, kind: "list", canGrant: input.allowGrant === true, items: [], nextId: null,
    } : receipt; },
  };
  return { deps, receipt, calls, entitlements, body: { query: write, command } };
}
test("202 HTTP uses canonical same-origin password actor; injected authority and malformed commands never execute", async () => {
  const st = await managementSetup();
  const foreign: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
  for (const headers of foreign) {
    assert.equal((await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body, headers), st.deps)).status, 403);
  }
  for (const authenticationMethods of [[], ["recovery"]]) assert.equal((await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body), {
    ...st.deps, authenticate: async () => ({ ...(await auth()), authenticationMethods }),
  })).status, 403);
  for (const body of [{ ...st.body, authUserId: id(99) }, { ...st.body, allowed: true }, { ...st.body, command: { ...command, actorId: id(99) } }]) {
    assert.equal((await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, body), st.deps)).status, 400);
  }
  assert.equal(st.calls.length, 0);
});
test("202 HTTP normal reads and POST propagate actual actor, exact trusted gate and private bounded envelope", async () => {
  const st = await managementSetup(), read = await handleManagementDelegation(get(list), st.deps);
  assert.equal(read.status, 200); assert.equal((await read.json()).data.canGrant, true);
  const response = await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body), st.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, data: st.receipt });
  assert.deepEqual(st.entitlements, [siteId, siteId]); assert.equal(st.calls.length, 2);
  for (const input of st.calls) { assert.equal(input.authUserId, actor); assert.equal(input.allowGrant, true); assert(input.signal instanceof AbortSignal); }
  assert.equal(st.calls[0].command, null); assert.deepEqual(st.calls[1].command, command);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("vary")!, /Cookie.*Authorization.*x-merchant-access-token/);
});
test("202 original GET skips current gate/entitlement; flag-off POST still lets SQL recover an exact saved original", async () => {
  const st = await managementSetup();
  const response = await handleManagementDelegation(get(recover), { ...st.deps, enabled: () => assert.fail("original GET does not read flag"), entitlement: async () => assert.fail("original GET does not read entitlement") });
  assert.equal(response.status, 200); assert.equal(st.calls[0].allowGrant, false);
  assert.equal((await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body), { ...st.deps, enabled: () => false,
    entitlement: async () => assert.fail("off does not read entitlement") })).status, 200);
  assert.equal(st.calls[1].allowGrant, false);
});
test("202 strict streamed JSON, UTF8, content type, query and limiter reject before SQL", async () => {
  const st = await managementSetup(), text = JSON.stringify(st.body), url = origin + m.MANAGEMENT_DELEGATION_API;
  const raw = (body: BodyInit, headers: Record<string, string> = {}, search = "") => new Request(url + search, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body });
  const requests: readonly (readonly [Request, number])[] = [
    [raw(text.replace('"command":', '"command":{},"command":')), 400], [raw(text.replace('"command":', '"\\u0063ommand":{},"command":')), 400],
    [raw(new Uint8Array([0xff])), 400], [raw(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])), 400],
    [raw("中".repeat(6000)), 413], [raw(text, { "content-length": "16385" }), 413], [raw(text, { "content-type": "text/plain" }), 415],
    [raw(text, {}, "?unexpected=1"), 400], [new Request(get(list).url + "&mode=list", { headers: { origin } }), 400],
    [new Request(url + "?siteId=%ff", { headers: { origin } }), 400], [new Request(get(list).url + "#fragment", { headers: { origin } }), 400],
  ];
  for (const [request, expected] of requests) assert.equal((await handleManagementDelegation(request, st.deps)).status, expected);
  assert.equal((await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body), { ...st.deps, allow: () => false })).status, 429);
  assert.equal(st.calls.length, 0);
});
test("202 final HTTP projection checks actual actor/full SHA and does not leak SQL errors", async () => {
  const st = await managementSetup(); assert.equal(st.receipt.kind, "receipt");
  for (const data of [{ ...st.receipt, actorId: id(99) }, { ...st.receipt, receipt: { ...st.receipt.receipt!, commandFingerprint: "f".repeat(64) } },
    { ...st.receipt, privateSource: "hidden" }]) {
    const response = await handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body), { ...st.deps, execute: async () => data as m.ManagementDelegationResult });
    assert.equal(response.status, 503); assert(!(await response.text()).includes("hidden"));
  }
  const unknown = await handleManagementDelegation(get(list), { ...st.deps, execute: async () => { throw Error("postgres://secret@private.invalid"); } });
  assert.equal(unknown.status, 503); assert(!(await unknown.text()).includes("secret"));
});
test("202 deadline/abort prevents an Auth or entitlement wait from dispatching later SQL and cleans listeners", async () => {
  for (const stage of ["auth", "entitlement"] as const) {
    const st = await managementSetup(); let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; }), pending = new Promise<void>(r => { release = r; });
    const req = post(m.MANAGEMENT_DELEGATION_API, st.body), deps = { ...st.deps, timeoutMs: 15 };
    if (stage === "auth") deps.authenticate = async () => { enter(); await pending; return auth(); };
    else deps.entitlement = async site => { enter(); await pending; return st.deps.entitlement(site); };
    const responsePromise = handleManagementDelegation(req, deps); await entered; const response = await responsePromise;
    assert.equal(response.status, 503); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 0);
    assert.equal(getEventListeners(req.signal, "abort").length, 0);
  }
  const st = await managementSetup(), controller = new AbortController(); controller.abort();
  const req = new Request(post(m.MANAGEMENT_DELEGATION_API, st.body), { signal: controller.signal });
  assert.equal((await handleManagementDelegation(req, st.deps)).status, 503); assert.equal(st.calls.length, 0);
});
test("202 stalled body cancellation is nonblocking and late SQL replies cannot become success", async () => {
  const st = await managementSetup(); let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"query":')); }, cancel() { cancels++; return new Promise<void>(() => {}); } });
  const request = new Request(origin + m.MANAGEMENT_DELEGATION_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleManagementDelegation(request, { ...st.deps, bodyTimeoutMs: 10 })).status, 400); assert.equal(cancels, 1); assert.equal(st.calls.length, 0);
  let enter!: () => void, release!: (v: m.ManagementDelegationResult) => void, signal: AbortSignal | null = null;
  const entered = new Promise<void>(r => { enter = r; });
  const late = handleManagementDelegation(post(m.MANAGEMENT_DELEGATION_API, st.body), { ...st.deps, timeoutMs: 15, execute: async input => {
    signal = input.signal ?? null; enter(); return new Promise<m.ManagementDelegationResult>(r => { release = r; });
  } });
  await entered; const response = await late; assert.equal(response.status, 503); assert.equal((signal as AbortSignal | null)?.aborted, true);
  release(st.receipt); await new Promise<void>(r => setImmediate(r)); assert.equal((await response.json()).ok, false);
});
test("203 current audit GET uses access gate; original export recovery is minimal and gate independent", async () => {
  const query: a.DelegatedAuditQuery = { siteId, grantId: id(2), mode: "list", source: "config", fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z", asOf: null, cursorAt: null, cursorId: null };
  const calls: Parameters<typeof delegatedAuditDependencies.execute>[0][] = [];
  const deps: typeof delegatedAuditDependencies = { authenticate: auth, enabled: () => true, allow: () => true, allowExport: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof delegatedAuditDependencies.entitlement>>,
    execute: async input => { calls.push(input); return input.query.mode === "recover" ? {
      protocol: a.DELEGATED_AUDIT_PROTOCOL, siteId, actorId: actor, readAt, kind: "receipt", receipt: null,
    } : { protocol: a.DELEGATED_AUDIT_PROTOCOL, siteId, actorId: actor, readAt, kind: "list", grantId: id(2), source: "config", scopeKind: "audit_company", target: null, asOf: readAt, items: [], nextCursor: null }; },
  };
  const request = (q: a.DelegatedAuditQuery) => new Request(origin + a.DELEGATED_AUDIT_API + "?" + a.delegatedAuditQueryString(q), { headers: { origin } });
  assert.equal((await handleDelegatedAudit(request(query), deps)).status, 200); assert.equal(calls[0].allowAccess, true); assert.equal(calls[0].authUserId, actor);
  const response = await handleDelegatedAudit(request({ siteId, mode: "recover", operationId: id(3) }), { ...deps,
    enabled: () => assert.fail("recovery ignores flag"), entitlement: async () => assert.fail("recovery ignores entitlement") });
  assert.equal(response.status, 200); assert.equal(calls[1].allowAccess, false); assert.deepEqual((await response.json()).data, {
    protocol: a.DELEGATED_AUDIT_PROTOCOL, siteId, actorId: actor, readAt, kind: "receipt", receipt: null,
  });
  assert.equal((await handleDelegatedAudit(post(a.DELEGATED_AUDIT_API, { query, command: { action: "export", operationId: id(3) } }), deps)).status, 400);
  assert.equal(calls.length, 2);
});
test("203 real Node projection strips private snapshot and HTTP returns only independently checked export/receipt", async () => {
  const query: a.DelegatedAuditExportQuery = { siteId, grantId: id(2), mode: "export", source: "config", fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z" };
  const command: a.DelegatedAuditCommand = { action: "export", operationId: id(3) };
  const payload = { schemaVersion: 1, fromAt: query.fromAt, toAt: query.toAt, asOf: at, count: 0, rows: [] };
  const snapshotText = JSON.stringify(["attendance-delegated-audit-snapshot-v1", siteId, actor, id(2), query, payload]);
  const resultFingerprint = createHash("sha256").update(snapshotText).digest("hex");
  const receipt = { operationId: command.operationId, actorId: actor, grantId: id(2), action: "export", asOf: at, count: 0, resultFingerprint,
    commandFingerprint: await a.delegatedAuditCommandFingerprint(query, actor, command), recordedAt: at };
  let calls = 0;
  const deps: typeof delegatedAuditDependencies = { authenticate: auth, enabled: () => true, allow: () => true, allowExport: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof delegatedAuditDependencies.entitlement>>,
    execute: async input => executeDelegatedAudit({ query: input.query, command: input.command, authUserId: input.authUserId, allowAccess: input.allowAccess, signal: input.signal }, {
      rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_delegated_audit_v1"); assert.equal(args.p_auth_user_id, actor); assert.equal(args.p_allow_access, true);
        return { error: null, data: { protocol: a.DELEGATED_AUDIT_PROTOCOL, siteId, actorId: actor, readAt, kind: "export", grantId: id(2), source: "config", scopeKind: "audit_company", target: null,
          receipt, snapshotText, snapshotBytes: Buffer.byteLength(snapshotText), snapshotFingerprint: resultFingerprint } }; },
    }),
  };
  const response = await handleDelegatedAudit(post(a.DELEGATED_AUDIT_API, { query, command }), deps);
  assert.equal(response.status, 200); assert.equal(calls, 1);
  const wire = await response.text(); for (const key of ["snapshotText", "snapshotBytes", "snapshotFingerprint"]) assert(!wire.includes(key));
  assert.deepEqual(JSON.parse(wire).data.payload, payload); assert.deepEqual(JSON.parse(wire).data.receipt, receipt);
});
