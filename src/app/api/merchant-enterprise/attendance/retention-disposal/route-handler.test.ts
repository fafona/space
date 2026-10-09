// Synthetic Auth and HTTP only, never a real disposition.
import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { handleRetentionDisposal, disposalExecutionDependencies } from "./route-handler";
import { disposalExecutionQueryString, type DisposalExecutionQuery } from "@/lib/merchantAttendanceRetentionDisposalExecution";
import type { DisposalExecutionServiceInput } from "@/lib/merchantAttendanceRetentionDisposalExecution.server";
import { disposalActor, disposalSite, disposalId, disposalQuery, disposalApprove, disposalPreview, disposalReceipt, disposalResult } from "../../../../../../scripts/fixtures/attendance-retention-disposal-execution-model";
const origin = "https://www.faolla.com", url = origin + "/api/merchant-enterprise/attendance/retention-disposal";
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (q: DisposalExecutionQuery) => new Request(url + "?" + disposalExecutionQueryString(q), { headers: { origin } });
function setup() {
  const calls: DisposalExecutionServiceInput[] = [], eligible: string[] = [];
  const deps: typeof disposalExecutionDependencies = { enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: disposalActor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async site => { eligible.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof disposalExecutionDependencies.entitlement>>; },
    execute: async input => { calls.push(input); return { ...disposalResult(input.command ? { kind: "receipt", receipt: await disposalReceipt(input.command) }
      : input.query.mode === "recover" ? { kind: "receipt", receipt: null } : { kind: "preview", preview: await disposalPreview() }), siteId: input.query.siteId }; } };
  return { deps, calls, eligible };
}
test("canonical origin/password Auth/exact bodies precede SQL and no caller-supplied actor is accepted", async () => {
  const s = setup(), body = { query: disposalQuery(), command: await disposalApprove() };
  const deniedHeaders: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of deniedHeaders) assert.equal((await handleRetentionDisposal(post(body, headers), s.deps)).status, 403);
  assert.equal((await handleRetentionDisposal(post(body), { ...s.deps, authenticate: async () => ({ user: { id: disposalActor } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) })).status, 403);
  assert.equal((await handleRetentionDisposal(post({ ...body, authUserId: disposalId(99) }), s.deps)).status, 400); assert.equal(s.calls.length, 0);
});
test("only local synthetic site permits preview/write and flag AND entitlement govern one POST", async () => {
  const s = setup(), body = { query: disposalQuery(), command: await disposalApprove() };
  const response = await handleRetentionDisposal(post(body), s.deps); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /private.*no-store/);
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].authUserId, disposalActor); assert.equal(s.calls[0].allowWrite, true);
  await handleRetentionDisposal(post(body), { ...s.deps, enabled: () => false }); assert.equal(s.calls[1].allowWrite, false);
  await handleRetentionDisposal(post(body), { ...s.deps, entitlement: async () => { throw Error("unavailable"); } }); assert.equal(s.calls[2].allowWrite, false);
  assert.equal((await handleRetentionDisposal(get({ ...disposalQuery(), siteId: "12345678" }), s.deps)).status, 403); assert.equal(s.calls.length, 3);
});
test("preview and original actor recovery do not consult entitlement, membership or a write flag", async () => {
  const s = setup(), deps = { ...s.deps, enabled: () => false, entitlement: async () => { assert.fail("read must not inspect new-write entitlement"); } };
  assert.equal((await handleRetentionDisposal(get(disposalQuery()), deps)).status, 200);
  assert.equal((await handleRetentionDisposal(get({ siteId: "12345678", mode: "recover", eventId: null, operationId: disposalId(7) }), deps)).status, 200);
  assert.equal(s.calls.length, 2); assert(s.calls.every(x => !x.allowWrite)); assert.equal(s.eligible.length, 0);
});
test("strict bounded JSON, duplicate keys/queries, malformed UTF8 and response identity fail closed", async () => {
  const s = setup(); assert.equal((await handleRetentionDisposal(post({ value: "x".repeat(8192) }), s.deps)).status, 422);
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff])]) assert.equal((await handleRetentionDisposal(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.deps)).status, 400);
  assert.equal((await handleRetentionDisposal(new Request(url + "?siteId=" + disposalSite + "&siteId=" + disposalSite, { headers: { origin } }), s.deps)).status, 400);
  assert.equal(s.calls.length, 0);
  assert.equal((await handleRetentionDisposal(get(disposalQuery()), { ...s.deps, execute: async () => ({ ...disposalResult({ kind: "preview", preview: await disposalPreview() }), actorId: disposalId(99) }) })).status, 503);
});
test("body and total deadlines cancel incomplete streams and prevent late dispatch", async () => {
  const s = setup(); let cancelled = false, resolve!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const request = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleRetentionDisposal(request, { ...s.deps, bodyTimeoutMs: 10 })).status, 400); assert.equal(cancelled, true);
  const hold = new Promise<void>(r => { resolve = r; });
  assert.equal((await handleRetentionDisposal(get(disposalQuery()), { ...s.deps, timeoutMs: 10, authenticate: async r => { await hold; return s.deps.authenticate(r); } })).status, 503);
  resolve(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
});
