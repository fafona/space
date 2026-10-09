import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceRuleCapturesClient, type RuleCapturesClientOptions, type RuleCapturesStorage } from "./merchantAttendanceRuleCapturesClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { ruleCapturesResult, ruleCapturesQuery as query, ruleCapturesCommand as command } from "../../scripts/fixtures/attendance-rule-captures-model";
import { ruleSourcesId, ruleSourcesOwner as actor, ruleSourcesPopulated } from "../../scripts/fixtures/attendance-rule-sources-model";

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const source = () => ({ ok: true, moduleEnabled: true, data: ruleSourcesPopulated() });
const captured = (moduleEnabled = true) => ({ ok: true, moduleEnabled, data: ruleCapturesResult() });
const missing = (moduleEnabled = true) => ({ ok: true, moduleEnabled, data: { ...ruleCapturesResult(), receipt: null } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function memory() {
  const values = new Map<string, string>([["unrelated", "preserve"]]), writes: Array<{ key: string; value: string }> = [];
  const storage: RuleCapturesStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push({ key, value }); }, removeItem: key => { values.delete(key); } };
  return { values, writes, storage };
}
function setup(fetch?: AttendanceApiFetch, overrides: Partial<RuleCapturesClientOptions> = {}) {
  const store = memory(), calls: Array<{ url: string; init: RequestInit }> = [];
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return fetch ? fetch(url, init) : reply(String(url).includes("rule-sources") ? source() : captured());
  };
  const options: RuleCapturesClientOptions = { siteId: query.siteId, workerId: query.workerId, ownerId: actor, storage: () => store.storage,
    apiFetch, operationId: () => query.operationId, ...overrides };
  return { client: new AttendanceRuleCapturesClient(options), options, store, calls };
}
const read = async (client: AttendanceRuleCapturesClient) => { await client.initialize(); await client.read(command.fromDate, command.throughDate); };
const persisted = (client: AttendanceRuleCapturesClient, store: ReturnType<typeof memory>) => JSON.parse(store.values.get(client.storageKey)!);
const pendingSlot = () => ({ version: 1, siteId: query.siteId, ownerId: actor, workerId: query.workerId, pending: { query, command }, latestId: null });
const turn = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("constructor and initialize never network; options copied and scoped storage only", async () => {
  const x = setup(); x.options.ownerId = ruleSourcesId(8); x.options.apiFetch = async () => { throw Error("mutated"); };
  await x.client.initialize(); assert.equal(x.calls.length, 0); assert.equal(x.store.writes.length, 0); assert.equal(x.client.getSnapshot().phase, "idle");
  await x.client.read(command.fromDate, command.throughDate); assert.equal(x.calls.length, 1);
  assert.equal(x.client.storageKey, `faolla:attendance:rule-captures:v1:${query.siteId}:${actor}:${query.workerId}`);
  assert.equal(x.store.values.get("unrelated"), "preserve");
  for (const invalid of [{ timeoutMs: 0 }, { timeoutMs: 12001 }, { ownerId: "bad" }, { storage: null }, { operationId: 4 }])
    assert.throws(() => new AttendanceRuleCapturesClient({ ...x.options, ...invalid } as RuleCapturesClientOptions));
});

test("capture persists original bytes before one POST, clears source, saves only latest ID and compact receipt", async () => {
  const x = setup(async (url, init) => {
    if (String(url).includes("rule-sources")) return reply(source());
    const slot = persisted(x.client, x.store); assert.deepEqual(slot.pending, { query, command }); assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { query, command }); return reply(captured());
  });
  await read(x.client); await x.client.capture(command.reason);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]);
  assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.client.getSnapshot().source, null);
  assert.equal(x.client.getSnapshot().result!.receipt!.sourceId, captured().data.receipt!.sourceId);
  assert(!JSON.stringify(x.client.getSnapshot().result).includes("sourceText"));
  assert.deepEqual(persisted(x.client, x.store), { ...pendingSlot(), pending: null, latestId: query.operationId });
  assert(x.store.writes.every(w => !w.value.includes("sourceText") && !w.value.includes("lateGraceMinutes")));
  assert(Object.isFrozen(x.client.getSnapshot())); assert(Object.isFrozen(x.client.getSnapshot().result!.receipt!.summary));
});

test("lost committed response preserves exact pending, reload initialize is local, explicit recovery is GET-only", async () => {
  const x = setup(async url => String(url).includes("rule-sources") ? reply(source()) : Promise.reject(Error("reply_lost")));
  await read(x.client); await x.client.capture(command.reason); const raw = x.store.values.get(x.client.storageKey)!;
  assert.equal(x.client.getSnapshot().phase, "unconfirmed"); assert.equal(x.client.getSnapshot().source, null);
  const gets: RequestInit[] = [], reloaded = new AttendanceRuleCapturesClient({ ...x.options, apiFetch: async (_, init = {}) => { gets.push(init); return reply(captured(false)); } });
  await reloaded.initialize(); assert.equal(gets.length, 0); assert.equal(x.store.values.get(x.client.storageKey), raw);
  await reloaded.recover(); assert.deepEqual(gets.map(g => g.method), ["GET"]); assert.equal(reloaded.getSnapshot().pending, null);
  assert.equal(reloaded.getSnapshot().result!.moduleEnabled, false); assert.equal(reloaded.getSnapshot().recoveryId, query.operationId);
});

test("explicit retry first GETs unknown then sends exact original command, without a new operation ID", async () => {
  let ids = 0; const x = setup(async (url, init) => String(url).includes("rule-sources") ? reply(source()) : init?.method === "GET" ? reply(missing()) : reply(captured()), { operationId: () => { ids++; return query.operationId; } });
  x.store.values.set(x.client.storageKey, JSON.stringify(pendingSlot())); await x.client.initialize();
  await x.client.retry(); assert.equal(ids, 0); assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(String(x.calls[1].init.body)), { query, command });
});

test("GET-null alone and paused retry never POST or clear original pending", async () => {
  const x = setup(async () => reply(missing(false))); const original = JSON.stringify(pendingSlot()); x.store.values.set(x.client.storageKey, original);
  await x.client.initialize(); await x.client.recover(); await x.client.retry();
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "GET"]); assert.equal(x.store.values.get(x.client.storageKey), original);
  assert.equal(x.client.getSnapshot().phase, "unconfirmed");
});

test("first definite rejection releases new pending, while an uncertain original retry rejection never releases it", async () => {
  for (const [code, status] of [["attendance_invalid_request", 400], ["attendance_platform_paused", 403], ["attendance_rule_capture_limit", 409], ["attendance_rule_capture_incomplete", 409], ["attendance_rule_capture_worker_inactive", 409]] as const) {
    const x = setup(async url => reply(String(url).includes("rule-sources") ? source() : { ok: false, error: code }, String(url).includes("rule-sources") ? 200 : status));
    await read(x.client); await x.client.capture(command.reason); assert.equal(x.client.getSnapshot().pending, null, code); assert.equal(x.client.getSnapshot().phase, "blocked");
    assert.match(x.client.getSnapshot().message, /^本次未保存/); assert.doesNotMatch(x.client.getSnapshot().message, /恢复|原编号/);
    const original = JSON.stringify(pendingSlot()), y = setup(async (_, init) => init?.method === "GET" ? reply(missing()) : reply({ ok: false, error: code }, status));
    y.store.values.set(y.client.storageKey, original); await y.client.initialize(); await y.client.retry();
    assert.equal(y.store.values.get(y.client.storageKey), original, code); assert(y.client.getSnapshot().pending);
  }
});

test("auth/identity failures and invalid status/error envelopes retain original pending bytes", async () => {
  for (const [body, status] of [[{ ok: false, error: "attendance_access_denied" }, 403], [{ ok: false, error: "attendance_rule_capture_identity_changed" }, 409],
    [{ ok: false, error: "attendance_rule_capture_limit" }, 400], [{ ok: false, error: "attendance_rule_capture_limit", debug: "secret" }, 409], [{ ok: false, error: "unknown" }, 409]] as const) {
    const x = setup(async url => String(url).includes("rule-sources") ? reply(source()) : reply(body, status)); await read(x.client); await x.client.capture(command.reason);
    assert(x.client.getSnapshot().pending); assert.equal(persisted(x.client, x.store).pending.command.operationId, query.operationId);
    assert(!x.client.getSnapshot().message.includes("secret"));
  }
});

test("manual other ID is forbidden during pending and duplicate calls cannot create extra POSTs", async () => {
  const held = deferred<Response>(), x = setup(async url => String(url).includes("rule-sources") ? reply(source()) : held.promise);
  await read(x.client); const saving = x.client.capture(command.reason); await turn();
  await x.client.capture("second"); await x.client.retry(); await x.client.recover(ruleSourcesId(8)); assert.equal(x.calls.length, 2);
  held.resolve(reply(captured())); await saving; assert.equal(x.calls.length, 2);
  const y = setup(); y.store.values.set(y.client.storageKey, JSON.stringify(pendingSlot())); await y.client.initialize(); await y.client.recover(ruleSourcesId(8)); assert.equal(y.calls.length, 0);
});

test("corrupt/wrong-identity/unavailable session storage is fail-closed without overwriting or networking", async () => {
  for (const raw of ["{", JSON.stringify({ ...pendingSlot(), ownerId: ruleSourcesId(8) }), JSON.stringify({ ...pendingSlot(), extra: true }), JSON.stringify({ ...pendingSlot(), pending: { query, command: { ...command, operationId: ruleSourcesId(8) } } })]) {
    const x = setup(); x.store.values.set(x.client.storageKey, raw); await x.client.initialize(); await x.client.read(command.fromDate, command.throughDate); await x.client.capture(command.reason);
    assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.calls.length, 0); assert.equal(x.store.values.get(x.client.storageKey), raw); assert.equal(x.store.writes.length, 0);
  }
  const x = setup(undefined, { storage: () => { throw Error("unavailable"); } }); await x.client.initialize(); await x.client.read(command.fromDate, command.throughDate); assert.equal(x.calls.length, 0);
});

test("pending persistence failure or replaced session slot prevents POST and preserves a discoverable original ID", async () => {
  const x = setup(); await read(x.client); x.store.storage.setItem = () => { throw Error("full"); }; await x.client.capture(command.reason);
  assert.equal(x.calls.length, 1); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().recoveryId, query.operationId);
  const y = setup(); await read(y.client); y.store.values.set(y.client.storageKey, "replaced"); await y.client.capture(command.reason);
  assert.equal(y.calls.length, 1); assert.equal(y.store.values.get(y.client.storageKey), "replaced");
});

test("CAS mismatch and failed settlement never erase changed pending or publish a receipt", async () => {
  const x = setup(async url => {
    if (String(url).includes("rule-sources")) return reply(source());
    x.store.values.set(x.client.storageKey, "substituted"); return reply(captured());
  });
  await read(x.client); await x.client.capture(command.reason); assert.equal(x.client.getSnapshot().result, null); assert(x.client.getSnapshot().pending); assert.equal(x.store.values.get(x.client.storageKey), "substituted");
  const y = setup(); await read(y.client); const set = y.store.storage.setItem; let sets = 0;
  y.store.storage.setItem = (key, value) => { if (++sets === 2) throw Error("settle_failed"); set(key, value); };
  await y.client.capture(command.reason); assert(y.client.getSnapshot().pending); assert.equal(y.client.getSnapshot().result, null);
});

test("loading/saving observers may synchronously pause before first request or persistence", async () => {
  const x = setup(); await x.client.initialize(); x.client.subscribe(() => { if (x.client.getSnapshot().phase === "loading") x.client.pause(); });
  await x.client.read(command.fromDate, command.throughDate); assert.equal(x.calls.length, 0);
  const y = setup(); await read(y.client); y.client.subscribe(() => { if (y.client.getSnapshot().phase === "saving") y.client.pause(); });
  await y.client.capture(command.reason); assert.equal(y.calls.length, 1); assert.equal(y.store.writes.length, 0);
});

test("storage/random-ID callbacks may synchronously hide/pause and cannot cause late POST", async () => {
  const x: ReturnType<typeof setup> = setup(undefined, { operationId: () => { x.client.pause(); return query.operationId; } });
  await read(x.client); await x.client.capture(command.reason); assert.equal(x.calls.length, 1);
  const y = setup(); await read(y.client); const set = y.store.storage.setItem;
  y.store.storage.setItem = (key, value) => { set(key, value); y.client.pause(); }; await y.client.capture(command.reason);
  assert.equal(y.calls.length, 1); assert(y.client.getSnapshot().pending); assert.equal(persisted(y.client, y.store).pending.command.operationId, query.operationId);
});

test("an unknown GET observer pause prevents the explicit retry POST and ready settlement is atomic", async () => {
  const x = setup(async () => reply(missing())); x.store.values.set(x.client.storageKey, JSON.stringify(pendingSlot())); await x.client.initialize();
  x.client.subscribe(() => { if (x.client.getSnapshot().result?.receipt === null) x.client.pause(); }); await x.client.retry();
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert(x.client.getSnapshot().pending);
  const y = setup(); await read(y.client); const seen: string[] = [];
  y.client.subscribe(() => { const s = y.client.getSnapshot(); if (!s.pending && s.result?.receipt) { seen.push("settled"); y.client.pause(); } });
  y.client.subscribe(() => { if (y.client.getSnapshot().result?.receipt) seen.push("stale"); });
  await y.client.capture(command.reason); assert.deepEqual(seen, ["settled"]); assert.equal(y.client.getSnapshot().result, null); assert.equal(y.client.getSnapshot().pending, null);
});

test("late headers/body after pause do not restore sources or clear original pending", async () => {
  const held = deferred<Response>(), x = setup(async () => held.promise), reading = x.client.read(command.fromDate, command.throughDate);
  await turn(); x.client.pause(); held.resolve(reply(source())); await reading; assert.equal(x.client.getSnapshot().source, null);
  let stream!: ReadableStreamDefaultController<Uint8Array>; const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; } });
  const y = setup(async url => String(url).includes("rule-sources") ? reply(source()) : new Response(body, { headers: { "content-type": "application/json" } }));
  await read(y.client); const saving = y.client.capture(command.reason); await turn(); const raw = y.store.values.get(y.client.storageKey); y.client.pause(); await saving;
  try { stream.enqueue(new TextEncoder().encode(JSON.stringify(captured()))); stream.close(); } catch { /* cancelled stream */ }
  assert.equal(y.store.values.get(y.client.storageKey), raw); assert.equal(y.client.getSnapshot().result, null); assert(y.client.getSnapshot().pending);
});

test("late WebCrypto digest obeys the same deadline and cannot settle after pause", async () => {
  const subtle = globalThis.crypto.subtle, descriptor = Object.getOwnPropertyDescriptor(subtle, "digest"), native = subtle.digest.bind(subtle), started = deferred<void>(), held = deferred<ArrayBuffer>();
  Object.defineProperty(subtle, "digest", { configurable: true, value: async (...args: Parameters<SubtleCrypto["digest"]>) => { const hash = await native(...args); started.resolve(); await held.promise; return hash; } });
  try {
    const x = setup(); await read(x.client); const saving = x.client.capture(command.reason); await started.promise; const raw = x.store.values.get(x.client.storageKey); x.client.pause(); await saving;
    held.resolve(new ArrayBuffer(0)); await turn(); assert.equal(x.store.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().result, null); assert(x.client.getSnapshot().pending);
  } finally { if (descriptor) Object.defineProperty(subtle, "digest", descriptor); else Reflect.deleteProperty(subtle, "digest"); }
});

test("header plus body plus hash share the configured deadline including fetch implementations ignoring abort", async () => {
  const x = setup(async () => new Promise<Response>(() => {}), { timeoutMs: 20 }); await x.client.read(command.fromDate, command.throughDate); assert.equal(x.client.getSnapshot().phase, "blocked");
  const subtle = globalThis.crypto.subtle, descriptor = Object.getOwnPropertyDescriptor(subtle, "digest");
  Object.defineProperty(subtle, "digest", { configurable: true, value: async () => new Promise<ArrayBuffer>(() => {}) });
  try {
    const y = setup(undefined, { timeoutMs: 40 }); await read(y.client); await y.client.capture(command.reason);
    assert(y.client.getSnapshot().pending); assert.equal(y.client.getSnapshot().phase, "unconfirmed"); assert.equal(y.client.getSnapshot().result, null);
  } finally { if (descriptor) Object.defineProperty(subtle, "digest", descriptor); else Reflect.deleteProperty(subtle, "digest"); }
});

test("hidden state prevents network and identity-keyed reload never adopts another target's pending", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); let isHidden = true;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  try {
    const x = setup(); await x.client.initialize(); await x.client.read(command.fromDate, command.throughDate); await x.client.recover(); assert.equal(x.calls.length, 0);
    isHidden = false; await read(x.client); assert.equal(x.calls.length, 1);
    x.client.subscribe(() => { if (x.client.getSnapshot().phase === "saving") isHidden = true; }); await x.client.capture(command.reason); assert.equal(x.calls.length, 1);
  } finally { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); }
  const x = setup(); x.store.values.set(x.client.storageKey, JSON.stringify(pendingSlot()));
  const other = new AttendanceRuleCapturesClient({ ...x.options, workerId: ruleSourcesId(8) }); await other.initialize(); assert.equal(other.getSnapshot().pending, null); assert.equal(x.store.values.get(x.client.storageKey), JSON.stringify(pendingSlot()));
});

test("paused/inactive/unbound/incomplete preflight cannot capture, while inactive-group complete observation may", async () => {
  for (const change of [
    (s: ReturnType<typeof source>) => { s.moduleEnabled = false; }, (s: ReturnType<typeof source>) => { s.data.worker.active = false; },
    (s: ReturnType<typeof source>) => { s.data.worker.employeeActive = false; },
    (s: ReturnType<typeof source>) => { s.data.worker.employeeId = null; s.data.worker.employeeAuthUserId = null; s.data.worker.employeeActive = false; s.data.personal = { revision: 0, limited: false, items: [] }; },
    (s: ReturnType<typeof source>) => { s.data.personal = { limited: true, revision: 3, items: [] }; },
    (s: ReturnType<typeof source>) => { s.data.rules = { limited: true, items: [] }; },
    (s: ReturnType<typeof source>) => { s.data.assignments = { limited: true, items: [] }; s.data.rules = { limited: true, items: [] }; },
  ]) { const raw = source(); change(raw); const x = setup(async () => reply(raw)); await read(x.client); await x.client.capture(command.reason); assert.equal(x.calls.length, 1); assert.equal(x.store.writes.length, 0); }
  const raw = source(); raw.data.assignments.items[0].currentGroup.active = false;
  const x = setup(async url => reply(String(url).includes("rule-sources") ? raw : captured())); await read(x.client); await x.client.capture(command.reason); assert.equal(x.calls.length, 2);
});

test("invalid transport headers/status/UTF8 and oversized errors never become a verified receipt", async () => {
  const cases: Array<() => Response> = [() => new Response("{}", { headers: { "content-type": "text/html" } }),
    () => reply(captured(), 201), () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    () => { const r = reply(captured()); Object.defineProperty(r, "redirected", { value: true }); return r; },
    () => new Response(JSON.stringify({ ok: false, error: "attendance_rule_capture_limit" }) + " ".repeat(4096), { status: 409, headers: { "content-type": "application/json" } })];
  for (const make of cases) { const x = setup(async url => String(url).includes("rule-sources") ? reply(source()) : make()); await read(x.client); await x.client.capture(command.reason); assert(x.client.getSnapshot().pending); assert.equal(x.client.getSnapshot().result, null); }
});

test("every request is no-store/no-redirect and editing after ready requires a new explicit preflight", async () => {
  const x = setup(); await read(x.client); x.client.invalidate(); await x.client.capture(command.reason); assert.equal(x.calls.length, 1); assert.equal(x.client.getSnapshot().source, null);
  await x.client.read(command.fromDate, command.throughDate); await x.client.capture(command.reason);
  assert(x.calls.every(c => c.init.cache === "no-store" && c.init.redirect === "error" && c.init.signal instanceof AbortSignal));
});

test("last successful ID is discovered locally and a fresh definite rejection preserves it without suggesting recovery", async () => {
  const previous = ruleSourcesId(33), x = setup(async url => String(url).includes("rule-sources") ? reply(source()) : reply({ ok: false, error: "attendance_rule_capture_limit" }, 409));
  x.store.values.set(x.client.storageKey, JSON.stringify({ ...pendingSlot(), pending: null, latestId: previous }));
  await x.client.initialize(); assert.equal(x.calls.length, 0); assert.equal(x.client.getSnapshot().recoveryId, previous);
  await x.client.read(command.fromDate, command.throughDate); await x.client.capture(command.reason);
  assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.client.getSnapshot().recoveryId, previous);
  assert.equal(persisted(x.client, x.store).latestId, previous); assert.match(x.client.getSnapshot().message, /本次未保存.*容量/);
  assert.doesNotMatch(x.client.getSnapshot().message, /恢复|原编号/);
});

test("synchronous abort reentry owns the newer read and cannot be clobbered by old pause/finally", async () => {
  const held = deferred<Response>(); let number = 0, newer: Promise<void> | undefined;
  const x: ReturnType<typeof setup> = setup(async (_, init) => {
    if (++number === 1) { init?.signal?.addEventListener("abort", () => { newer = x.client.read(command.fromDate, command.throughDate); }, { once: true }); return held.promise; }
    return reply(source());
  });
  const first = x.client.read(command.fromDate, command.throughDate); await turn(); x.client.pause(); await first; await newer;
  assert.equal(x.client.getSnapshot().phase, "ready"); assert(x.client.getSnapshot().source); assert.equal(x.calls.length, 2);
  held.resolve(reply(source())); await turn(); assert.equal(x.client.getSnapshot().phase, "ready");
});

test("capture HTTP envelope budget includes worst JSON escaping while still rejecting one byte over limit", async () => {
  const limit = 6 * 1048576 + 65536, text = JSON.stringify(captured()), padded = text + " ".repeat(limit - new TextEncoder().encode(text).byteLength);
  const x = setup(async () => new Response(padded, { headers: { "content-type": "application/json" } }));
  await x.client.recover(query.operationId); assert(x.client.getSnapshot().result?.receipt);
  const y = setup(async () => new Response(padded + " ", { headers: { "content-type": "application/json" } }));
  await y.client.recover(query.operationId); assert.equal(y.client.getSnapshot().result, null); assert.equal(y.client.getSnapshot().phase, "blocked");
});
