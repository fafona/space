//194 Synthetic memory transport only; no SQL/Auth/browser acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceApplicationWindowClient, applicationWindowPendingKey, parseApplicationWindowPending, discoverApplicationWindowPendings } from "./merchantAttendanceApplicationWindowClient";
import { APPLICATION_WINDOW_FAMILIES, applicationWindowCommandFingerprint, parseApplicationWindowQuery } from "./merchantAttendanceApplicationWindow";
import { applicationWindowFixture, windowActor, windowId as id } from "./merchantAttendanceApplicationWindowTestFixtures";
import { correctionEmployee, correctionProposal } from "../../scripts/fixtures/attendance-correction-model";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
function storage() { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; }
type Fixture = Awaited<ReturnType<typeof applicationWindowFixture>>;
const response = (data: unknown) => Response.json({ ok: true, data });
function setup(f: Fixture, fetch: AttendanceApiFetch, options: { enabled?: boolean; timeoutMs?: number; current?: () => boolean } = {}) {
  assert(f.query.mode === "prepare"); const store = storage();
  const client = new AttendanceApplicationWindowClient({ query: f.query, employeeId: correctionEmployee, authUserId: windowActor,
    enabled: options.enabled ?? true, apiFetch: fetch, storage: () => store, isCurrentAuth: options.current ?? (() => true), randomId: () => f.command.command.operationId, timeoutMs: options.timeoutMs });
  return { client, store };
}
async function pending(f: Fixture) { return JSON.stringify({ protocol: "attendance-application-window-pending-v1", version: 1, actorId: windowActor, employeeId: correctionEmployee,
  query: f.query, command: f.command, commandFingerprint: await applicationWindowCommandFingerprint(f.query, f.command, windowActor) }); }
async function write(client: AttendanceApplicationWindowClient, f: Fixture) { await client.initialize(); await client.prepare(); assert.equal(client.getSnapshot().result?.canSubmit, true); await client.submit(f.command.command.proposal, f.command.command.reason); }

test("194 client four families: local initialize0HTTP, durable exact intent precedes solePOST and matching receipt clears", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family), methods: string[] = [];
    const { client, store } = setup(f, async (_url, init) => { methods.push(init?.method ?? "GET"); if (init?.method !== "POST") return response(f.result);
      const raw = store.getItem(client.storageKey); assert(raw); const p = await parseApplicationWindowPending(raw, { siteId: f.query.siteId, family, employeeId: correctionEmployee, authUserId: windowActor });
      assert.deepEqual(JSON.parse(String(init.body)), { query: p.query, command: p.command }); assert.deepEqual(p.command, f.command); return response(f.post); });
    await client.initialize(); assert.deepEqual(methods, []); await client.prepare(); await client.submit(f.command.command.proposal, f.command.command.reason);
    assert.deepEqual(methods, ["GET", "POST"]); assert.equal(store.getItem(client.storageKey), null); assert.equal(client.getSnapshot().result?.mode, "receipt");
    await client.submit(correctionProposal, "No fresh read"); assert.deepEqual(methods, ["GET", "POST"]); client.pause();
  }
});
test("194 response loss keeps exact original intent; defaultoff reload only explicitGET and null never means failure", async () => {
  const f = await applicationWindowFixture(), methods: string[] = [];
  const first = setup(f, async (_p, i) => { methods.push(i?.method ?? "GET"); if (i?.method === "POST") throw Error("lost"); return response(f.result); });
  await write(first.client, f); const raw = first.store.getItem(first.client.storageKey); assert(raw); first.client.pause();
  const query = parseApplicationWindowQuery(f.query); assert(query.mode === "prepare"); let recovered = false;
  const client = new AttendanceApplicationWindowClient({ query, employeeId: correctionEmployee, authUserId: windowActor, enabled: false, isCurrentAuth: () => true, storage: () => first.store,
    apiFetch: async (_p, i) => { methods.push(i?.method ?? "GET"); return response({ ...f.post, mode: "recover", receipt: recovered ? f.post.receipt : null }); } });
  await client.initialize(); await client.prepare(); await client.submit(correctionProposal, "Blocked"); assert.deepEqual(methods, ["GET", "POST"]);
  await client.recover(); assert.equal(first.store.getItem(client.storageKey), raw); assert.equal(client.getSnapshot().canEndRejectedAttempt, false);
  recovered = true; await client.recover(); assert.equal(first.store.getItem(client.storageKey), null); assert.deepEqual(methods, ["GET", "POST", "GET", "GET"]); client.pause();
});
test("194 original receipt must match complete stored hash/auth/scope and storage bytes", async () => {
  const f = await applicationWindowFixture();
  for (const patch of [{ commandFingerprint: "b".repeat(64) }, { employeeId: id(99) }, { workerId: id(99) }, { windowFingerprint: "b".repeat(64) }]) {
    const { client, store } = setup(f, async () => response({ ...f.post, mode: "recover", receipt: { ...f.post.receipt!, ...patch } })); const raw = await pending(f); store.setItem(client.storageKey, raw);
    await client.initialize(); await client.recover(); assert.equal(store.getItem(client.storageKey), raw); assert.equal(client.getSnapshot().canEndRejectedAttempt, false); client.pause();
  }
  const { client, store } = setup(f, async () => { store.setItem(client.storageKey, "other-tab"); return response({ ...f.post, mode: "recover" }); }); store.setItem(client.storageKey, await pending(f));
  await client.initialize(); await client.recover(); assert.equal(store.getItem(client.storageKey), "other-tab"); client.pause();
});
test("194 only verifiedPOST changed/disabled/expired creates ephemeral explicit-end proof; GET cannot", async () => {
  const f = await applicationWindowFixture();
  for (const [code, status] of Object.entries({ attendance_application_window_changed: 409, attendance_application_window_disabled: 403, attendance_application_window_expired: 409 })) {
    let calls = 0; const { client, store } = setup(f, async (_p, i) => { calls++; return i?.method === "POST" ? Response.json({ ok: false, error: code }, { status }) : response(f.result); });
    await write(client, f); assert.equal(client.getSnapshot().canEndRejectedAttempt, true); assert(store.getItem(client.storageKey)); await client.endRejectedAttempt();
    assert.equal(store.getItem(client.storageKey), null); assert.equal(client.getSnapshot().result, null); assert.equal(calls, 2); client.pause();
    const g = setup(f, async () => Response.json({ ok: false, error: code }, { status })); const raw = await pending(f); g.store.setItem(g.client.storageKey, raw);
    await g.client.initialize(); await g.client.recover(); await g.client.endRejectedAttempt(); assert.equal(g.store.getItem(g.client.storageKey), raw); g.client.pause();
  }
});
test("194 rejection proof disappears on pause, recovery, initialize, auth loss, or exact-storage replacement", async () => {
  const f = await applicationWindowFixture();
  for (const action of ["pause", "recover", "initialize", "identity", "replace"] as const) { let current = true;
    const { client, store } = setup(f, async (_p, i) => i?.method === "POST" ? Response.json({ ok: false, error: "attendance_application_window_changed" }, { status: 409 }) : response(f.result), { current: () => current });
    await write(client, f); const raw = store.getItem(client.storageKey); assert(raw); assert(client.getSnapshot().canEndRejectedAttempt);
    if (action === "identity") current = false; else if (action === "replace") store.setItem(client.storageKey, "replacement"); else await client[action]();
    await client.endRejectedAttempt(); assert.equal(store.getItem(client.storageKey), action === "replace" ? "replacement" : raw); client.pause();
  }
});
test("194 status mismatch/unknown/conflict/auth/oversize/invalidUTF8 never grants explicit-end", async () => {
  const f = await applicationWindowFixture();
  for (const build of [() => Response.json({ ok: false, error: "attendance_application_window_changed" }, { status: 503 }),
    () => Response.json({ ok: false, error: "attendance_operation_conflict" }, { status: 409 }), () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }),
    () => Response.json({ ok: false, error: "attendance_application_window_invalid" }, { status: 503 }),
    () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    () => new Response(" ".repeat(262145), { headers: { "content-type": "application/json" } })]) {
    const { client, store } = setup(f, async (_p, i) => i?.method === "POST" ? build() : response(f.result)); await write(client, f);
    const raw = store.getItem(client.storageKey); assert(raw); assert.equal(client.getSnapshot().canEndRejectedAttempt, false); await client.endRejectedAttempt(); assert.equal(store.getItem(client.storageKey), raw); client.pause();
  }
});
test("194 stalled body and stalledSHA are bounded by the same lease; no latePOST/clear", async t => {
  const f = await applicationWindowFixture(); let cancelled = false;
  const a = setup(f, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }), { timeoutMs: 20 });
  await a.client.initialize(); await a.client.prepare(); assert.equal(cancelled, true); assert.equal(a.client.getSnapshot().result, null); a.client.pause();
  let calls = 0; const b = setup(f, async () => { calls++; return response(f.result); }, { timeoutMs: 20 }); await b.client.initialize(); await b.client.prepare();
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(() => {})); await b.client.submit(correctionProposal, f.command.command.reason);
  assert.equal(calls, 1); assert.equal(b.store.getItem(b.client.storageKey), null); b.client.pause();
});
test("194 synchronous observers cannot replace pending between durable save and the solePOST", async () => {
  const f = await applicationWindowFixture(); let posts = 0;
  const { client, store } = setup(f, async (_p, i) => { if (i?.method === "POST") posts++; return response(f.result); });
  client.subscribe(() => { if (client.getSnapshot().phase === "saving") store.setItem(client.storageKey, "other-tab"); }); await write(client, f);
  assert.equal(posts, 0); assert.equal(store.getItem(client.storageKey), "other-tab"); client.pause();
});
test("194 pause and synchronous identity invalidation reject late matching receipts without clearing originals", async () => {
  const f = await applicationWindowFixture();
  for (const pause of [true, false]) { let current = true, finish: ((r: Response) => void) | null = null;
    const { client, store } = setup(f, async (_p, i) => i?.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) : response(f.result), { current: () => current });
    await client.initialize(); await client.prepare(); const submitting = client.submit(correctionProposal, f.command.command.reason);
    while (!finish) await new Promise(resolve => setImmediate(resolve)); const raw = store.getItem(client.storageKey); assert(raw);
    if (pause) client.pause(); else current = false; (finish as (r: Response) => void)(response(f.post)); await submitting;
    assert.equal(store.getItem(client.storageKey), raw); assert.equal(client.getSnapshot().result, null); client.pause();
  }
});
test("194 old same-slot intent blocks all new writes and only old GET recovery, including missing-family shared slot", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family); assert(f.query.mode === "prepare"); let calls = 0;
    const { client, store } = setup(f, async (path, i) => { calls++; assert.equal(i?.method, "GET"); assert(!path.includes("application-window")); return Response.json({ ok: false, error: "attendance_correction_not_found" }, { status: 404 }); });
    const q = family === "correction" ? { siteId: f.query.siteId, expectedWorkerId: f.query.workerId, mode: "detail", requestId: f.command.command.operationId, operationId: null }
      : family === "correction_revision" ? { siteId: f.query.siteId, expectedWorkerId: f.query.workerId, baseRequestId: id(100), mode: "detail", requestId: f.command.command.operationId, operationId: null }
      : { siteId: f.query.siteId, access: "self", fromDate: "2026-09-30", throughDate: "2026-09-30", requestId: null, operationId: null, beforeAt: null, beforeId: null };
    const old = family === "correction" || family === "correction_revision" ? { employeeId: correctionEmployee, query: q, command: f.command.command } : { actorId: correctionEmployee, query: q, command: f.command.command };
    const raw = JSON.stringify(old); store.setItem(client.storageKey, raw); await client.initialize(); assert.equal(client.getSnapshot().pending?.kind, "legacy");
    await client.prepare(); await client.submit(correctionProposal, "Blocked"); assert.equal(calls, 0); await client.recover(); assert.equal(calls, 1); assert.equal(store.getItem(client.storageKey), raw); client.pause();
  }
  assert.equal(applicationWindowPendingKey("99990001", "missing", correctionEmployee), applicationWindowPendingKey("99990001", "missing_revision", correctionEmployee));
});
test("194 explicit discovery reads only three fixedslots, binds realAuth/fullhash and never enumerates or mutates", async () => {
  const f = await applicationWindowFixture("missing_revision"), store = storage(), reads: string[] = [], raw = await pending(f), key = applicationWindowPendingKey(f.query.siteId, f.query.family, correctionEmployee);
  store.setItem(key, raw); store.setItem("unrelated", "do not inspect"); const o = { siteId: f.query.siteId, employeeId: correctionEmployee, authUserId: windowActor,
    isCurrentAuth: () => true, storage: () => ({ getItem: (k: string) => { reads.push(k); return store.getItem(k); } }) };
  assert.deepEqual(await discoverApplicationWindowPendings(o), [{ query: f.query, operationId: f.command.command.operationId }]);
  assert.equal(new Set(reads).size, 3); assert(!reads.includes("unrelated")); assert.equal(store.getItem(key), raw);
  await assert.rejects(discoverApplicationWindowPendings({ ...o, authUserId: id(99) }));
  await assert.rejects(discoverApplicationWindowPendings({ ...o, storage: () => ({ getItem: k => k === key ? raw.replace('"commandFingerprint":"', '"commandFingerprint":"0') : null }) }));
  assert.equal(store.getItem(key), raw);
});
test("194 discovery digest timeout and localinitialize SHA timeout preserve bytes without any transport", async t => {
  const f = await applicationWindowFixture(), raw = await pending(f), store = storage(), key = applicationWindowPendingKey(f.query.siteId, f.query.family, correctionEmployee); store.setItem(key, raw);
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(() => {}));
  await assert.rejects(discoverApplicationWindowPendings({ siteId: f.query.siteId, employeeId: correctionEmployee, authUserId: windowActor, isCurrentAuth: () => true, storage: () => store, timeoutMs: 20 }), /deadline/);
  assert(f.query.mode === "prepare"); let calls = 0; const client = new AttendanceApplicationWindowClient({ query: f.query, employeeId: correctionEmployee, authUserId: windowActor, enabled: true,
    isCurrentAuth: () => true, storage: () => store, timeoutMs: 20, apiFetch: async () => { calls++; throw Error("unexpected"); } });
  await client.initialize(); assert.equal(calls, 0); assert.equal(store.getItem(key), raw); client.pause();
});
