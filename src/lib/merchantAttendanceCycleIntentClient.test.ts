import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceCycleIntentClient, cycleIntentPendingKey } from "./merchantAttendanceCycleIntentClient";
import { cycleModel, cycleOwner, cycleId } from "../../scripts/fixtures/attendance-cycle-intent-model";
const json = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { "content-type": "application/json" } });
function store() { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }
test("200 zero automatic network; POST remains staged until matching original-actor GET", async () => {
  const f = await cycleModel(), storage = store(), calls: string[] = [];
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true,
    apiFetch: async (_, init) => { calls.push(init!.method!); return json(f.result({ kind: "receipt" }, f.receipt)); } });
  assert.equal(await client.load(), null); assert.deepEqual(calls, []); await client.post(f.query, f.command); assert(storage.getItem(client.key));
  await assert.rejects(client.post(f.query, f.command)); await client.recover(); assert.equal(storage.getItem(client.key), null); assert.deepEqual(calls, ["POST", "GET"]);
});
test("200 lost reply, unknown null and wrong receipt never discard or re-POST original command", async () => {
  const f = await cycleModel(), storage = store(); let mode = "lost", posts = 0, gets = 0;
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true, apiFetch: async (_, init) => {
    if (init!.method === "POST") { posts++; throw Error("lost"); } gets++;
    return json(f.result({ kind: "receipt" }, mode === "null" ? null : { ...f.receipt, actorId: cycleId(99) })); } });
  await assert.rejects(client.post(f.query, f.command)); const raw = storage.getItem(client.key); assert(raw);
  mode = "null"; await assert.rejects(client.recover()); mode = "wrong"; await assert.rejects(client.recover()); assert.equal(storage.getItem(client.key), raw); assert.equal(posts, 1); assert.equal(gets, 2);
});
test("200 corrupted/foreign bytes and CAS replacement survive without any remote write", async () => {
  const f = await cycleModel(), storage = store(); let calls = 0;
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true, apiFetch: async () => { calls++; return json(f.result({ kind: "receipt" }, f.receipt)); } });
  storage.setItem(client.key, "broken"); await assert.rejects(client.load()); await assert.rejects(client.post(f.query, f.command)); assert.equal(calls, 0); assert.equal(storage.getItem(client.key), "broken");
  storage.removeItem(client.key); await client.post(f.query, f.command); const foreign = JSON.parse(storage.getItem(client.key)!); foreign.actorId = cycleId(99); storage.setItem(client.key, JSON.stringify(foreign));
  await assert.rejects(client.recover()); assert.equal(calls, 1); assert.equal(storage.getItem(client.key), JSON.stringify(foreign));
});
test("200 pause/auth epoch rejects late reply and keeps the durable original ID", async () => {
  const f = await cycleModel(), storage = store(); let resolve!: (response: Response) => void, started!: () => void, current = true;
  const entered = new Promise<void>(r => { started = r; });
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => current,
    apiFetch: async () => { started(); return new Promise<Response>(r => { resolve = r; }); } });
  const pending = client.post(f.query, f.command); await entered; current = false; client.pause(); resolve(json(f.result({ kind: "receipt" }, f.receipt)));
  await assert.rejects(pending); assert(storage.getItem(client.key)); await assert.rejects(client.recover());
});
test("200 total response-stream deadline is bounded and cannot clear a staged command", async () => {
  const f = await cycleModel(), storage = store(); let cancelled = false;
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true, timeoutMs: 20,
    apiFetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(client.post(f.query, f.command)); assert.equal(cancelled, true); assert(storage.getItem(client.key));
});
test("200 actor key is exact and a storage replacement during GET cannot be cleared", async () => {
  const f = await cycleModel(), storage = store(); let calls = 0;
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true, apiFetch: async () => { calls++; if (calls === 2) storage.setItem(client.key, "replacement"); return json(f.result({ kind: "receipt" }, f.receipt)); } });
  assert.equal(client.key, cycleIntentPendingKey(f.scope.siteId, cycleOwner)); await client.post(f.query, f.command); await assert.rejects(client.recover()); assert.equal(storage.getItem(client.key), "replacement");
});

test("200 missing, invalidated or throwing live Auth checks are fail-closed without network or storage access", async () => {
  const f = await cycleModel(); let calls = 0, storageCalls = 0;
  for (const isCurrent of [undefined, () => false, () => { throw Error("invalidated"); }]) {
    const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, isCurrent,
      storage: () => { storageCalls++; return store(); }, apiFetch: async () => { calls++; throw Error("HTTP forbidden"); } });
    await assert.rejects(client.load()); await assert.rejects(client.read({ ...f.scope, mode: "list", cursor: null }));
    await assert.rejects(client.post(f.query, f.command)); await assert.rejects(client.recover());
  }
  assert.equal(calls, 0); assert.equal(storageCalls, 0);
});

test("200 one operation deadline bounds stalled local and pre-POST digests; late completion cannot dispatch", async t => {
  const f = await cycleModel(), original = crypto.subtle.digest.bind(crypto.subtle);
  for (const mode of ["load", "post"] as const) {
    const storage = store(); let calls = 0, release!: (value: ArrayBuffer) => void, args: Parameters<typeof crypto.subtle.digest> | undefined;
    const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true, timeoutMs: 20,
      apiFetch: async () => { calls++; return json(f.result({ kind: "receipt" }, f.receipt)); } });
    const saved = JSON.stringify({ version: 1, actorId: cycleOwner, query: f.query, command: f.command, fingerprint: f.receipt.commandFingerprint });
    if (mode === "load") storage.setItem(client.key, saved);
    const late = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    const mocked = t.mock.method(crypto.subtle, "digest", (...value: Parameters<typeof crypto.subtle.digest>) => { args = value; return late; });
    const started = performance.now();
    try { await assert.rejects(mode === "load" ? client.load() : client.post(f.query, f.command)); assert(performance.now() - started < 1000); }
    finally { mocked.mock.restore(); }
    assert(args); release(await original(...args)); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls, 0); assert.equal(storage.getItem(client.key), mode === "load" ? saved : null);
    // Timed-out work cannot keep the client busy or act during this new epoch.
    const loaded = await client.load(); assert.equal(loaded?.command.operationId ?? null, mode === "load" ? f.command.operationId : null);
  }
});

test("200 caller command and query are snapshotted before the operation schedules digest work", async () => {
  // Untrusted caller objects are mutable, unlike the parser's readonly DTOs.
  const f = await cycleModel(), storage = store(), query = { ...structuredClone(f.query) }, command = { ...structuredClone(f.command) };
  const client = new AttendanceCycleIntentClient({ siteId: f.scope.siteId, actorId: cycleOwner, storage: () => storage, isCurrent: () => true,
    apiFetch: async () => json(f.result({ kind: "receipt" }, f.receipt)) });
  const running = client.post(query, command); command.reason = "changed after invocation"; query.intentId = cycleId(88); await running;
  assert.equal(command.reason, "changed after invocation"); assert.equal(query.intentId, cycleId(88));
  const loaded = await client.load(); assert.equal(loaded?.query.mode, "detail"); assert.equal(loaded?.command.reason, f.command.reason);
  assert.equal(loaded?.command.intentId, f.command.intentId);
});
