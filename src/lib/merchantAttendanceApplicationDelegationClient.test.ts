import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceApplicationDelegationClient, applicationDelegationPendingKey, type ApplicationDelegationStorage } from "./merchantAttendanceApplicationDelegationClient";
import { APPLICATION_DELEGATION_API, parseApplicationDelegationBody, parseApplicationDelegationHttpQuery, applicationDelegationCommandFingerprint,
  type ApplicationDelegationAccess, type ApplicationDelegationCommand, type ApplicationDelegationQuery } from "./merchantAttendanceApplicationDelegation";
import { applicationDelegationId as id, applicationDelegationQuery as query, applicationDelegationHttp as http, applicationDelegationReceiptHttp as receipt,
  applicationDelegationCommand as command, applicationDelegationGrantCommand as grantCommand, applicationDelegationCatalogItem as catalogItem } from "../../scripts/fixtures/attendance-application-delegation-model";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
function memory() { const values = new Map<string, string>(); const storage: ApplicationDelegationStorage = { getItem: k => values.get(k) ?? null,
  setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }; return { values, storage }; }
function fixture(options: { access?: ApplicationDelegationAccess; enabled?: boolean; storage?: ApplicationDelegationStorage; fetch?: AttendanceApiFetch; timeoutMs?: number; expectedAuthUserId?: string; recoveryOnly?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [], mem = memory(), access = options.access ?? "delegate";
  const fetch: AttendanceApiFetch = async (url, init) => { calls.push({ url: String(url), init });
    if (options.fetch) return options.fetch(url, init);
    if (init?.method === "POST") { const b = parseApplicationDelegationBody(JSON.parse(String(init.body))); return response(await receipt(b.query, b.command)); }
    return response(http(parseApplicationDelegationHttpQuery(`https://example.test${url}`))); };
  const client = new AttendanceApplicationDelegationClient({ siteId: "99990001", access, actorId: access === "owner" ? id(1) : id(2), apiFetch: fetch,
    enabled: options.enabled ?? true, storage: () => options.storage ?? mem.storage, randomId: () => id(30), timeoutMs: options.timeoutMs,
    expectedAuthUserId: options.expectedAuthUserId, recoveryOnly: options.recoveryOnly });
  return { client, calls, ...mem };
}
async function ready(client: AttendanceApplicationDelegationClient) { await client.initialize(); await client.load(); await client.requests(id(10)); await client.detailRequest(id(10), id(20));
  assert.equal(client.getSnapshot().result?.protocol, "delegated-applications-v1"); assert.equal(client.getSnapshot().query?.mode, "detail"); }
async function pending(storage: ApplicationDelegationStorage, c: ApplicationDelegationCommand = command(), q: ApplicationDelegationQuery = query("delegate", "decide")) {
  const actor = q.access === "owner" ? id(1) : id(3), anchor = q.access === "owner" ? id(1) : id(2);
  const raw = JSON.stringify({ version: 1, anchorId: anchor, actorId: actor, employeeId: q.access === "owner" ? null : id(2), query: q, command: c,
    commandFingerprint: await applicationDelegationCommandFingerprint(q.siteId, q.access, c) });
  storage.setItem(applicationDelegationPendingKey(q.siteId, q.access, anchor), raw); return raw;
}

test("local initialize and disabled module make zero network calls; no free UUID detail or decisions", async () => {
  const { client, calls } = fixture({ enabled: false }); await client.initialize(); await client.load(); await client.requests(id(10));
  await client.detailRequest(id(10), id(20)); await client.decide("approve", "No authority"); await client.recover(); assert.equal(calls.length, 0);
  assert.equal(client.hasLeaveRisk(), false); const on = fixture(); await on.client.initialize(); await on.client.detailRequest(id(10), id(20));
  await on.client.requests(id(10)); assert.equal(on.calls.length, 0);
});
test("explicit grant → request → detail → one decision persists before POST and returns only minimal receipt", async () => {
  const mem = memory(); let sawPending = false;
  const f = fixture({ storage: mem.storage, fetch: async (url, init) => { if (init?.method !== "POST") return response(http(parseApplicationDelegationHttpQuery(`https://example.test${url}`)));
    sawPending = mem.values.size === 1; const b = parseApplicationDelegationBody(JSON.parse(String(init.body))); assert.deepEqual(b.command, command()); return response(await receipt(b.query, b.command)); } });
  await ready(f.client); await f.client.decide("approve", "Synthetic review"); assert.equal(sawPending, true); assert.equal(mem.values.size, 0);
  assert.equal(f.calls.filter(x => x.init?.method === "POST").length, 1); assert.equal(f.calls[3].url, APPLICATION_DELEGATION_API);
  assert.equal(f.client.getSnapshot().result?.receipt?.operationId, id(30)); assert.equal(f.client.getSnapshot().result?.detail, null);
  await f.client.decide("approve", "Again"); assert.equal(f.calls.length, 4);
});
test("lost POST persists exact intent; refreshed flag-off client only GETs original operation then clears matching hash", async () => {
  const mem = memory(), f = fixture({ storage: mem.storage, fetch: async (url, init) => { if (init?.method === "POST") throw Error("lost response"); return response(http(parseApplicationDelegationHttpQuery(`https://example.test${url}`))); } });
  await ready(f.client); await f.client.decide("approve", "Synthetic review"); const saved = mem.storage.getItem(f.client.storageKey); assert.ok(saved);
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); const restored = fixture({ enabled: false, storage: mem.storage,
    fetch: async url => response(await receipt(parseApplicationDelegationHttpQuery(`https://example.test${url}`), command())) });
  await restored.client.initialize(); assert.equal(restored.calls.length, 0); await restored.client.load(); assert.equal(restored.calls.length, 0);
  await restored.client.recover(); assert.equal(restored.calls.length, 1); assert.equal(restored.calls[0].init?.method, "GET");
  const q = parseApplicationDelegationHttpQuery(`https://example.test${restored.calls[0].url}`); assert.equal(q.mode, "recover"); assert.equal(q.operationId, id(30));
  assert.equal(restored.client.getSnapshot().pending, null); assert.equal(mem.values.size, 0);
});
test("unknown GET, auth/identity/hash mismatch and known rejection cannot clear pending or disclose stale details", async () => {
  for (const kind of ["missing", "denied", "auth", "employee", "hash"] as const) {
    const mem = memory(), saved = await pending(mem.storage), f = fixture({ enabled: false, storage: mem.storage, fetch: async url => {
      const q = parseApplicationDelegationHttpQuery(`https://example.test${url}`);
      if (kind === "missing") return response(http(q)); if (kind === "denied") return response({ ok: false, error: "attendance_access_denied" }, 403);
      const r = await receipt(q, command()); if (kind === "auth") r.actorId = id(88); if (kind === "employee" && r.protocol === "delegated-applications-v1") r.employeeId = id(88);
      if (kind === "hash") r.receipt.commandFingerprint = "0".repeat(64); return response(r); } });
    await f.client.initialize(); await f.client.recover(); assert.equal(mem.storage.getItem(f.client.storageKey), saved, kind); assert.ok(f.client.getSnapshot().pending);
    assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result?.detail ?? null, null);
  }
  const f = fixture({ fetch: async (url, init) => init?.method === "POST" ? response({ ok: false, error: "attendance_leave_closed" }, 409)
    : response(http(parseApplicationDelegationHttpQuery(`https://example.test${url}`))) }); await ready(f.client); await f.client.decide("approve", "Synthetic review"); assert.ok(f.client.getSnapshot().pending);
  assert.match(f.client.getSnapshot().message, /服务端拒绝.*原编号仍保留/);
});
test("storage CAS and storage failure prevent POST; receipt cannot remove replaced pending", async () => {
  const mem = memory(), f = fixture({ storage: mem.storage }); await ready(f.client); mem.storage.setItem(f.client.storageKey, "foreign-pending");
  await f.client.decide("approve", "Synthetic review"); assert.equal(f.calls.length, 3); assert.equal(mem.storage.getItem(f.client.storageKey), "foreign-pending");
  const broken = memory(); broken.storage.setItem = () => { throw Error("quota"); }; const g = fixture({ storage: broken.storage }); await ready(g.client);
  await g.client.decide("approve", "Synthetic review"); assert.equal(g.calls.length, 3); assert.equal(g.client.hasLeaveRisk(), true);
  const switched = memory(), h = fixture({ storage: switched.storage, fetch: async (url, init) => { if (init?.method !== "POST") return response(http(parseApplicationDelegationHttpQuery(`https://example.test${url}`)));
    const b = parseApplicationDelegationBody(JSON.parse(String(init.body))); switched.storage.setItem(applicationDelegationPendingKey("99990001", "delegate", id(2)), "new scope pending"); return response(await receipt(b.query, b.command)); } });
  await ready(h.client); await h.client.decide("approve", "Synthetic review"); assert.equal(switched.storage.getItem(h.client.storageKey), "new scope pending"); assert.equal(h.client.getSnapshot().result, null);
});
test("subscriber pause before persistence stops late POST; pause after send retains original intent", async () => {
  const f = fixture(); await ready(f.client); let paused = false; const unsub = f.client.subscribe(() => { if (!paused && f.client.getSnapshot().phase === "saving") { paused = true; f.client.pause(); } });
  await f.client.decide("approve", "Synthetic review"); unsub(); assert.equal(f.calls.length, 3); assert.equal(f.values.size, 0); assert.equal(f.client.getSnapshot().result, null);
  let resolve!: (v: Response) => void; const g = fixture({ fetch: async (url, init) => init?.method === "POST" ? new Promise<Response>(r => { resolve = r; }) : response(http(parseApplicationDelegationHttpQuery(`https://example.test${url}`))) });
  await ready(g.client); const running = g.client.decide("approve", "Synthetic review"); while (!resolve) await new Promise(r => setTimeout(r, 0)); g.client.pause();
  resolve(response(await receipt(query("delegate", "decide"), command()))); await running; assert.ok(g.client.getSnapshot().pending); assert.equal(g.client.getSnapshot().result, null); assert.equal(g.values.size, 1);
});
test("late read headers, stalled bodies, malformed UTF8, oversized errors and invalid JSON never publish", async () => {
  let resolve!: (v: Response) => void; const delayed = fixture({ fetch: async () => new Promise<Response>(r => { resolve = r; }) }); await delayed.client.initialize();
  const read = delayed.client.load(); delayed.client.pause(); resolve(response(http())); await read; assert.equal(delayed.client.getSnapshot().result, null);
  const cases: (() => Response)[] = [() => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    () => new Response('{"ok":true,"ok":true}', { headers: { "Content-Type": "application/json" } }),
    () => response({ ok: false, error: "x".repeat(4097) }, 503), () => response({ ok: false, error: "attendance_access_denied" }, 500),
    () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } }), { headers: { "Content-Type": "application/json" } })];
  for (const make of cases) { const f = fixture({ timeoutMs: 15, fetch: async () => make() }); await f.client.initialize(); await f.client.load(); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null); }
});
test("owner catalog requires each actual object; historical grant receipt permits explicit safe revoke while feature off", async () => {
  const f = fixture({ access: "owner" }); await f.client.initialize(); await f.client.catalog("delegates");
  f.client.selectDelegate({ ...catalogItem("delegates"), employeeAuthUserId: id(88) }); assert.equal(f.client.getSnapshot().choices.delegate, null);
  const selectActual = (select: (v: ReturnType<typeof catalogItem>) => void) => { const r = f.client.getSnapshot().result; assert.equal(r?.protocol, "application-delegations-v1"); if (r?.protocol === "application-delegations-v1") select(r.catalogItems[0]); };
  selectActual(f.client.selectDelegate); await f.client.catalog("workers"); selectActual(f.client.selectWorker);
  await f.client.grant({ category: "leave", kinds: [], includePending: false, validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z", reason: "Explicit scope" });
  assert.equal(f.calls.filter(x => x.init?.method === "POST").length, 1); assert.equal(f.client.getSnapshot().result?.receipt?.grantId, id(30));
  const mem = memory(), c = grantCommand(); await pending(mem.storage, c, query("owner"));
  const g = fixture({ access: "owner", enabled: false, storage: mem.storage, fetch: async (url, init) => {
    if (init?.method === "POST") { const b = parseApplicationDelegationBody(JSON.parse(String(init.body))); assert.equal("action" in b.command && b.command.action, "revoke"); return response(await receipt(b.query, b.command)); }
    return response(await receipt(parseApplicationDelegationHttpQuery(`https://example.test${url}`), c)); } });
  await g.client.initialize(); await g.client.recover(); await g.client.revoke(id(99), "Not a selected grant"); assert.equal(g.calls.length, 1);
  await g.client.revoke(c.operationId, "End the exact grant"); assert.equal(g.calls.length, 2); assert.equal(g.client.getSnapshot().pending, null);
});
test("foreign immutable scope and paused empty grants cannot become selected decision authority", async () => {
  const f = fixture({ fetch: async url => { const q = parseApplicationDelegationHttpQuery(`https://example.test${url}`), r = http(q);
    if (r.protocol === "delegated-applications-v1" && q.mode === "list") r.items[0].employeeAuthUserId = id(88); return response(r); } });
  await f.client.initialize(); await f.client.load(); await f.client.requests(id(10)); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  const g = fixture({ fetch: async () => { const r = http(); if (r.protocol === "delegated-applications-v1") { r.canWrite = false; r.grants = []; } return response(r); } });
  await g.client.initialize(); await g.client.load(); assert.equal(g.client.getSnapshot().phase, "ready"); await g.client.requests(id(10)); assert.equal(g.calls.length, 1);
});
test("independent recovery requires real Auth, blocks all discovery and POST even when feature is enabled", async () => {
  assert.throws(() => fixture({ recoveryOnly: true }));
  const mem = memory(), saved = await pending(mem.storage);
  const wrong = fixture({ storage: mem.storage, expectedAuthUserId: id(99), recoveryOnly: true }); await wrong.client.initialize(); await wrong.client.recover();
  assert.equal(wrong.client.getSnapshot().phase, "blocked"); assert.equal(wrong.calls.length, 0); assert.equal(mem.storage.getItem(wrong.client.storageKey), saved);
  const f = fixture({ storage: mem.storage, expectedAuthUserId: id(3), recoveryOnly: true, fetch: async url => response(await receipt(parseApplicationDelegationHttpQuery(`https://example.test${url}`), command())) });
  await f.client.initialize(); await f.client.load(); await f.client.recover(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init?.method, "GET");
  await f.client.load(); await f.client.decide("approve", "No review authority"); assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().pending, null);
  const g = fixture({ expectedAuthUserId: id(99) }); await g.client.initialize(); await g.client.load(); assert.equal(g.client.getSnapshot().result, null);
});
test("work approval requires displayed conflict confirmation and preserves exact7 plus outer evidence", async () => {
  const f = fixture({ fetch: async (url, init) => {
    if (init?.method === "POST") { const b = parseApplicationDelegationBody(JSON.parse(String(init.body))); assert("decision" in b.command);
      assert.equal(b.command.expectedEvidenceFingerprint, "e".repeat(64)); assert.equal(Object.keys(b.command.decision).length, 7);
      assert("confirmConflicts" in b.command.decision && b.command.decision.confirmConflicts); return response(await receipt(b.query, b.command, "work_arrangement")); }
    const q = parseApplicationDelegationHttpQuery(`https://example.test${url}`), r = http(q, "work_arrangement");
    if (r.protocol === "delegated-applications-v1" && r.detail) r.detail.conflicts = [{ source: "schedule", kind: null, startAt: r.detail.startAt, endAt: r.detail.endAt, timeZone: "UTC" }]; return response(r); } });
  await ready(f.client); await f.client.decide("approve", "Review", false); assert.equal(f.calls.length, 3);
  await f.client.decide("approve", "Review", true); assert.equal(f.calls.length, 4); assert.equal(f.client.getSnapshot().pending, null);
});
test("selected scope binds category, kind and server submittedAt cutoff; includePending is explicit", async () => {
  for (const variant of ["category", "kind", "before", "equal", "included"] as const) {
    const f = fixture({ fetch: async url => { const q = parseApplicationDelegationHttpQuery(`https://example.test${url}`), r = http(q, "work_arrangement");
      if (r.protocol === "delegated-applications-v1") {
        if (r.grants.length) { r.grants[0].kinds = ["trip"]; r.grants[0].includePending = variant === "included"; }
        if (r.items.length) { if (variant === "category") { r.items[0].category = "leave"; r.items[0].kind = null; }
          if (variant === "kind") r.items[0].kind = "field";
          if (["before", "included"].includes(variant)) r.items[0].submittedAt = "2026-09-29T12:00:00.000000Z";
          if (variant === "equal") r.items[0].submittedAt = "2026-09-30T12:00:00.000000Z"; }
      } return response(r); } });
    await f.client.initialize(); await f.client.load(); await f.client.requests(id(10));
    assert.equal(f.client.getSnapshot().phase, ["equal", "included"].includes(variant) ? "ready" : "blocked", variant);
  }
});
test("blocked or sealed detail never sends approve and work reject remains exact5", async () => {
  const f = fixture({ fetch: async (url, init) => { if (init?.method === "POST") { const b = parseApplicationDelegationBody(JSON.parse(String(init.body))); assert("decision" in b.command);
    assert.equal(b.command.decision.action, "reject"); assert.equal(Object.keys(b.command.decision).length, 5); return response(await receipt(b.query, b.command, "work_arrangement")); }
    const q = parseApplicationDelegationHttpQuery(`https://example.test${url}`), r = http(q, "work_arrangement"); if (r.protocol === "delegated-applications-v1" && r.detail) {
      r.detail.blocked = true; r.detail.sealed = true; r.detail.canApprove = false; } return response(r); } });
  await ready(f.client); await f.client.decide("approve", "Cannot bypass", true); assert.equal(f.calls.length, 3);
  await f.client.decide("reject", "Owner must recheck hidden basis"); assert.equal(f.calls.length, 4); assert.equal(f.client.getSnapshot().pending, null);
});
