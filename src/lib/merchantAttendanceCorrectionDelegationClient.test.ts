import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceCorrectionDelegationClient, correctionDelegationPendingKey, parseCorrectionDelegationPending, type CorrectionDelegationStorage } from "./merchantAttendanceCorrectionDelegationClient";
import { CORRECTION_DELEGATION_API, parseCorrectionDelegationBody, parseCorrectionDelegationHttpQuery, correctionDelegationCommandFingerprint,
  type CorrectionDelegationAccess, type CorrectionDelegationCommand, type CorrectionDelegationQuery } from "./merchantAttendanceCorrectionDelegation";
import { correctionDelegationId as id, correctionDelegationQuery as query, correctionDelegationHttp as http, correctionDelegationReceiptHttp as receipt,
  correctionDelegationCommand as command, correctionDelegationGrantCommand as grantCommand, correctionDelegationCatalogItem as catalogItem } from "./merchantAttendanceCorrectionDelegationTestFixtures";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
function memory() { const values = new Map<string, string>(); const storage: CorrectionDelegationStorage = { getItem: k => values.get(k) ?? null,
  setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }; return { values, storage }; }
function fixture(options: { access?: CorrectionDelegationAccess; enabled?: boolean; storage?: CorrectionDelegationStorage; fetch?: AttendanceApiFetch; timeoutMs?: number; isCurrentAuth?: () => boolean; expectedAuthUserId?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [], mem = memory(), access = options.access ?? "delegate";
  const fetch: AttendanceApiFetch = async (url, init) => { calls.push({ url: String(url), init });
    if (options.fetch) return options.fetch(url, init);
    if (init?.method === "POST") { const b = parseCorrectionDelegationBody(JSON.parse(String(init.body))); return response(await receipt(b.query, b.command)); }
    return response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`))); };
  const client = new AttendanceCorrectionDelegationClient({ siteId: "99990001", access, actorId: access === "owner" ? id(1) : id(2), apiFetch: fetch,
    enabled: options.enabled ?? true, expectedAuthUserId: options.expectedAuthUserId ?? (access === "owner" ? id(1) : id(3)), isCurrentAuth: options.isCurrentAuth,
    storage: () => options.storage ?? mem.storage, randomId: () => id(30), timeoutMs: options.timeoutMs });
  return { client, calls, ...mem };
}
async function ready(client: AttendanceCorrectionDelegationClient) { await client.initialize(); await client.load(); await client.requests(id(10)); await client.detailRequest(id(10), id(20));
  assert.equal(client.getSnapshot().result?.protocol, "delegated-corrections-v1"); assert.equal(client.getSnapshot().query?.mode, "detail"); }
async function pending(storage: CorrectionDelegationStorage, c: CorrectionDelegationCommand = command(), q: CorrectionDelegationQuery = query("delegate", "decide")) {
  const actor = q.access === "owner" ? id(1) : id(3), anchor = q.access === "owner" ? id(1) : id(2);
  const raw = JSON.stringify({ version: 1, anchorId: anchor, actorId: actor, employeeId: q.access === "owner" ? null : id(2), query: q, command: c,
    commandFingerprint: await correctionDelegationCommandFingerprint(q.siteId, q.access, c) });
  storage.setItem(correctionDelegationPendingKey(q.siteId, q.access, anchor), raw); return raw;
}

test("local initialize and disabled module make zero network calls; no free UUID detail or decisions", async () => {
  const { client, calls } = fixture({ enabled: false }); await client.initialize(); await client.load(); await client.requests(id(10));
  await client.detailRequest(id(10), id(20)); await client.decide("approve", "No authority"); await client.recover(); assert.equal(calls.length, 0);
  assert.equal(client.hasLeaveRisk(), false); const on = fixture(); await on.client.initialize(); await on.client.detailRequest(id(10), id(20));
  await on.client.requests(id(10)); assert.equal(on.calls.length, 0);
});
test("explicit grant → request → detail → one decision persists before POST and returns only minimal receipt", async () => {
  const mem = memory(); let sawPending = false;
  const f = fixture({ storage: mem.storage, fetch: async (url, init) => { if (init?.method !== "POST") return response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`)));
    sawPending = mem.values.size === 1; const b = parseCorrectionDelegationBody(JSON.parse(String(init.body))); assert.deepEqual(b.command, command()); return response(await receipt(b.query, b.command)); } });
  await ready(f.client); await f.client.decide("approve", "Synthetic review"); assert.equal(sawPending, true); assert.equal(mem.values.size, 0);
  assert.equal(f.calls.filter(x => x.init?.method === "POST").length, 1); assert.equal(f.calls[3].url, CORRECTION_DELEGATION_API);
  assert.equal(f.client.getSnapshot().result?.receipt?.operationId, id(30)); assert.equal(f.client.getSnapshot().result?.detail, null);
  await f.client.decide("approve", "Again"); assert.equal(f.calls.length, 4);
});
test("lost POST persists exact intent; refreshed flag-off client only GETs original operation then clears matching hash", async () => {
  const mem = memory(), f = fixture({ storage: mem.storage, fetch: async (url, init) => { if (init?.method === "POST") throw Error("lost response"); return response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`))); } });
  await ready(f.client); await f.client.decide("approve", "Synthetic review"); const saved = mem.storage.getItem(f.client.storageKey); assert.ok(saved);
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); const restored = fixture({ enabled: false, storage: mem.storage,
    fetch: async url => response(await receipt(parseCorrectionDelegationHttpQuery(`https://example.test${url}`), command())) });
  await restored.client.initialize(); assert.equal(restored.calls.length, 0); await restored.client.load(); assert.equal(restored.calls.length, 0);
  await restored.client.recover(); assert.equal(restored.calls.length, 1); assert.equal(restored.calls[0].init?.method, "GET");
  const q = parseCorrectionDelegationHttpQuery(`https://example.test${restored.calls[0].url}`); assert.equal(q.mode, "recover"); assert.equal(q.operationId, id(30));
  assert.equal(restored.client.getSnapshot().pending, null); assert.equal(mem.values.size, 0);
});
test("unknown GET, auth/identity/hash mismatch and known rejection cannot clear pending or disclose stale details", async () => {
  for (const kind of ["missing", "denied", "auth", "employee", "hash"] as const) {
    const mem = memory(), saved = await pending(mem.storage), f = fixture({ enabled: false, storage: mem.storage, fetch: async url => {
      const q = parseCorrectionDelegationHttpQuery(`https://example.test${url}`);
      if (kind === "missing") return response(http(q)); if (kind === "denied") return response({ ok: false, error: "attendance_access_denied" }, 403);
      const r = await receipt(q, command()); if (kind === "auth") r.actorId = id(88); if (kind === "employee" && r.protocol === "delegated-corrections-v1") r.employeeId = id(88);
      if (kind === "hash") r.receipt.commandFingerprint = "0".repeat(64); return response(r); } });
    await f.client.initialize(); await f.client.recover(); assert.equal(mem.storage.getItem(f.client.storageKey), saved, kind); assert.ok(f.client.getSnapshot().pending);
    assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result?.detail ?? null, null);
  }
  const f = fixture({ fetch: async (url, init) => init?.method === "POST" ? response({ ok: false, error: "attendance_correction_decided" }, 409)
    : response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`))) }); await ready(f.client); await f.client.decide("approve", "Synthetic review"); assert.ok(f.client.getSnapshot().pending);
});
test("storage CAS and storage failure prevent POST; receipt cannot remove replaced pending", async () => {
  const mem = memory(), f = fixture({ storage: mem.storage }); await ready(f.client); mem.storage.setItem(f.client.storageKey, "foreign-pending");
  await f.client.decide("approve", "Synthetic review"); assert.equal(f.calls.length, 3); assert.equal(mem.storage.getItem(f.client.storageKey), "foreign-pending");
  const broken = memory(); broken.storage.setItem = () => { throw Error("quota"); }; const g = fixture({ storage: broken.storage }); await ready(g.client);
  await g.client.decide("approve", "Synthetic review"); assert.equal(g.calls.length, 3); assert.equal(g.client.hasLeaveRisk(), true);
  const switched = memory(), h = fixture({ storage: switched.storage, fetch: async (url, init) => { if (init?.method !== "POST") return response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`)));
    const b = parseCorrectionDelegationBody(JSON.parse(String(init.body))); switched.storage.setItem(correctionDelegationPendingKey("99990001", "delegate", id(2)), "new scope pending"); return response(await receipt(b.query, b.command)); } });
  await ready(h.client); await h.client.decide("approve", "Synthetic review"); assert.equal(switched.storage.getItem(h.client.storageKey), "new scope pending"); assert.equal(h.client.getSnapshot().result, null);
});
test("subscriber pause before persistence stops late POST; pause after send retains original intent", async () => {
  const f = fixture(); await ready(f.client); let paused = false; const unsub = f.client.subscribe(() => { if (!paused && f.client.getSnapshot().phase === "saving") { paused = true; f.client.pause(); } });
  await f.client.decide("approve", "Synthetic review"); unsub(); assert.equal(f.calls.length, 3); assert.equal(f.values.size, 0); assert.equal(f.client.getSnapshot().result, null);
  let resolve!: (v: Response) => void; const g = fixture({ fetch: async (url, init) => init?.method === "POST" ? new Promise<Response>(r => { resolve = r; }) : response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`))) });
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
  const selectActual = (select: (v: ReturnType<typeof catalogItem>) => void) => { const r = f.client.getSnapshot().result; assert.equal(r?.protocol, "correction-delegations-v1"); if (r?.protocol === "correction-delegations-v1") select(r.catalogItems[0]); };
  selectActual(f.client.selectDelegate); await f.client.catalog("workers"); selectActual(f.client.selectWorker);
  await f.client.catalog("locations"); selectActual(f.client.selectLocation);
  await f.client.grant({ includePending: false, validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z", reason: "Explicit scope" });
  assert.equal(f.calls.filter(x => x.init?.method === "POST").length, 1); assert.equal(f.client.getSnapshot().result?.receipt?.grantId, id(30));
  const mem = memory(), c = grantCommand(); await pending(mem.storage, c, query("owner"));
  const g = fixture({ access: "owner", enabled: false, storage: mem.storage, fetch: async (url, init) => {
    if (init?.method === "POST") { const b = parseCorrectionDelegationBody(JSON.parse(String(init.body))); assert.equal("action" in b.command && b.command.action, "revoke"); return response(await receipt(b.query, b.command)); }
    return response(await receipt(parseCorrectionDelegationHttpQuery(`https://example.test${url}`), c)); } });
  await g.client.initialize(); await g.client.recover(); await g.client.revoke(id(99), "Not a selected grant"); assert.equal(g.calls.length, 1);
  await g.client.revoke(c.operationId, "End the exact grant"); assert.equal(g.calls.length, 2); assert.equal(g.client.getSnapshot().pending, null);
});
test("foreign immutable scope and paused empty grants cannot become selected decision authority", async () => {
  const f = fixture({ fetch: async url => { const q = parseCorrectionDelegationHttpQuery(`https://example.test${url}`), r = http(q);
    if (r.protocol === "delegated-corrections-v1" && q.mode === "list") r.items[0].locationId = id(88); return response(r); } });
  await f.client.initialize(); await f.client.load(); await f.client.requests(id(10)); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  const g = fixture({ fetch: async () => { const r = http(); if (r.protocol === "delegated-corrections-v1") { r.canWrite = false; r.grants = []; } return response(r); } });
  await g.client.initialize(); await g.client.load(); assert.equal(g.client.getSnapshot().phase, "ready"); await g.client.requests(id(10)); assert.equal(g.calls.length, 1);
});

test("late receipt after current Auth invalidation keeps original durable command and cancels response", async () => {
  let current = true, resolve!: (v: Response) => void, entered!: () => void, canceled = false;
  const postEntered = new Promise<void>(r => { entered = r; });
  const postResponse = new Promise<Response>(r => { resolve = r; });
  const f = fixture({ isCurrentAuth: () => current, fetch: async (url, init) => {
    if (init?.method === "POST") { entered(); return postResponse; }
    return response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`)));
  } });
  await ready(f.client); const running = f.client.decide("approve", "Synthetic review");
  await Promise.race([postEntered, running.then(
    () => { assert.fail("decision completed before entering POST apiFetch"); },
    () => { assert.fail("decision rejected before entering POST apiFetch"); },
  )]);
  const saved = f.storage.getItem(f.client.storageKey); assert.ok(saved); current = false;
  resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true }))); }, cancel() { canceled = true; } }), { headers: { "Content-Type": "application/json" } }));
  await running; assert.equal(canceled, true); assert.equal(f.storage.getItem(f.client.storageKey), saved); assert.equal(f.client.getSnapshot().result, null);
  await f.client.recover(); assert.equal(f.calls.length, 4);
});

test("initially hidden initialize restores local pending without HTTP; visible recovery remains explicit", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); let isHidden = true;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  try { const mem = memory(), saved = await pending(mem.storage), f = fixture({ enabled: false, storage: mem.storage,
    fetch: async url => response(await receipt(parseCorrectionDelegationHttpQuery(`https://example.test${url}`), command())) });
    await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.calls.length, 0);
    await f.client.recover(); assert.equal(f.calls.length, 0); assert.equal(mem.storage.getItem(f.client.storageKey), saved);
    isHidden = false; assert.equal(f.calls.length, 0); await f.client.recover(); assert.equal(f.calls.length, 1); assert.equal(mem.values.size, 0);
  } finally { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); }
});

test("pending parser binds exact scope/hash; replacement Auth cannot read or delete original employee slot", async () => {
  const mem = memory(), saved = await pending(mem.storage), scope = { siteId: "99990001", access: "delegate" as const, anchorId: id(2) };
  const p = await parseCorrectionDelegationPending(saved, scope); assert.equal(p.actorId, id(3)); assert.equal(p.employeeId, id(2));
  for (const expected of [{ ...scope, siteId: "99990002" }, { ...scope, anchorId: id(88) }, { ...scope, access: "owner" as const }]) await assert.rejects(parseCorrectionDelegationPending(saved, expected));
  for (const patch of [{ commandFingerprint: "0".repeat(64) }, { actorId: null }, { employeeId: id(88) }, { private: "not allowed" }])
    await assert.rejects(parseCorrectionDelegationPending(JSON.stringify({ ...JSON.parse(saved), ...patch }), scope));
  const f = fixture({ expectedAuthUserId: id(88), storage: mem.storage }); await f.client.initialize(); await f.client.recover();
  assert.equal(f.calls.length, 0); assert.equal(mem.storage.getItem(f.client.storageKey), saved); assert.equal(f.client.hasLeaveRisk(), true);
});

test("flag-off owner metadata permits exact safe revocation but no catalogs/grants", async () => {
  const f = fixture({ access: "owner", enabled: false }); await f.client.initialize(); await f.client.load();
  assert.equal(f.calls.length, 1); await f.client.catalog("delegates"); assert.equal(f.calls.length, 1);
  await f.client.detailGrant(id(10)); await f.client.revoke(id(10), "Explicit safe revoke");
  assert.equal(f.calls.length, 3); assert.equal(f.calls.at(-1)?.init?.method, "POST"); assert.equal(f.client.getSnapshot().pending, null);
});

test("includePending false rejects predating or exactly-at-grant requests; disposed client cannot restart", async () => {
  for (const submittedAt of ["2026-09-29T12:00:00.000000Z", "2026-09-30T12:00:00.000000Z"]) {
    const f = fixture({ fetch: async url => { const q = parseCorrectionDelegationHttpQuery(`https://example.test${url}`), r = http(q);
      if (r.protocol === "delegated-corrections-v1" && q.mode === "list") r.items[0].submittedAt = submittedAt; return response(r); } });
    await f.client.initialize(); await f.client.load(); await f.client.requests(id(10)); assert.equal(f.client.getSnapshot().phase, "blocked");
    assert.equal(f.client.getSnapshot().result, null); f.client.dispose(); await f.client.initialize(); await f.client.load(); assert.equal(f.calls.length, 2);
  }
});

test("the lease deadline covers stuck pending and write digests; late crypto cannot persist or POST", async t => {
  const mem = memory(), saved = await pending(mem.storage); const completions: ((bytes: ArrayBuffer) => void)[] = [];
  t.mock.method(globalThis.crypto.subtle, "digest", () => new Promise<ArrayBuffer>(resolve => completions.push(resolve)));
  const restored = fixture({ timeoutMs: 20, storage: mem.storage }); await restored.client.initialize();
  assert.equal(restored.client.getSnapshot().phase, "blocked"); assert.equal(mem.storage.getItem(restored.client.storageKey), saved); assert.equal(restored.calls.length, 0);
  const fresh = fixture({ timeoutMs: 20 }); await ready(fresh.client); await fresh.client.decide("approve", "Synthetic review");
  assert.equal(fresh.client.getSnapshot().phase, "blocked"); assert.equal(fresh.calls.length, 3); assert.equal(fresh.values.size, 0);
  for (const resolve of completions) resolve(new ArrayBuffer(32)); await Promise.resolve(); await Promise.resolve();
  assert.equal(fresh.calls.length, 3); assert.equal(fresh.values.size, 0); assert.equal(mem.storage.getItem(restored.client.storageKey), saved);
});

test("POST timeout retains the one saved command and does not retry", async () => {
  const f = fixture({ timeoutMs: 25, fetch: async (url, init) => init?.method === "POST" ? new Promise<Response>(() => {})
    : response(http(parseCorrectionDelegationHttpQuery(`https://example.test${url}`))) });
  await ready(f.client); await f.client.decide("approve", "Synthetic review");
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.values.size, 1); assert.equal(f.calls.length, 4);
  await f.client.decide("reject", "Cannot supersede unknown"); assert.equal(f.calls.length, 4);
});
