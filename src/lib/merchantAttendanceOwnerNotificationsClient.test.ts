import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { AttendanceOwnerNotificationsClient, ownerNotificationsPendingKey, parseOwnerNotificationsPending, type OwnerNotificationsClientOptions } from "./merchantAttendanceOwnerNotificationsClient";
import { parseOwnerNotificationsHttpQuery, parseOwnerNotificationsBody, parseOwnerNotificationsResponse, type OwnerNotificationsItem } from "./merchantAttendanceOwnerNotifications";

const id = (n: number) => `23600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actorId = id(1), siteId = "99990236", op = id(9), stamp = "2026-10-08T08:00:00.000000Z";
const item: OwnerNotificationsItem = { notificationId: id(2), sourceCategory: "period", sourceOperationId: id(3), sourceId: id(4), sourceRevision: 2,
  workerId: id(5), employeeId: id(6), employeeAuthUserId: id(7), occurredAt: stamp, readAt: null, target: { periodId: id(4), fromDate: "2026-09-01", throughDate: "2026-09-02" } };
const base = { protocol: "owner-attendance-notifications-v1", siteId, actorId };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function fixture(overrides: Partial<OwnerNotificationsClientOptions> = {}) {
  const values = new Map<string, string>(), calls: { path: string; init: RequestInit }[] = [];
  let behavior: ((path: string, init: RequestInit) => Promise<Response>) | null = null;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const defaults: OwnerNotificationsClientOptions = { siteId, actorId, enabled: true, storage: () => storage, randomId: () => op,
    apiFetch: async (path, init = {}) => { calls.push({ path, init }); if (behavior) return behavior(path, init);
      const command = init.method === "POST" ? parseOwnerNotificationsBody(JSON.parse(init.body as string)).command : null;
      const q = command ? parseOwnerNotificationsBody(JSON.parse(init.body as string)).query : parseOwnerNotificationsHttpQuery(`https://local.invalid${path}`);
      const raw = { ok: true, ...base, ...(command || q.mode === "recover" ? { kind: "receipt", receipt: { operationId: op, notificationId: item.notificationId, actorId, readAt: stamp } }
        : q.mode === "detail" ? { kind: "detail", item, canMarkRead: true } : { kind: "list", items: [item], nextCursor: null }) };
      parseOwnerNotificationsResponse(raw, q, actorId, command); return response(raw); }, ...overrides };
  const client = new AttendanceOwnerNotificationsClient(defaults);
  return { client, calls, values, storage, defaults, setBehavior: (next: typeof behavior) => { behavior = next; } };
}
async function detail(f: ReturnType<typeof fixture>) { await f.client.initialize(); await f.client.load(); await f.client.detail(item.notificationId); }
async function lost(f: ReturnType<typeof fixture>) { await detail(f); f.setBehavior(async () => { throw Error("lost"); }); await f.client.markRead(); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); }
function receipt(operationId = op, notificationId = item.notificationId, actor = actorId) {
  return { ok: true, ...base, kind: "receipt", receipt: { operationId, notificationId, actorId: actor, readAt: stamp } };
}
function requestClock(t: TestContext) {
  type Timer = ReturnType<typeof setTimeout>;
  let now = 1000, sequence = 0;
  const timers = new Map<Timer, { at: number; callback: () => void }>();
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, ms = 0) => {
    const handle = ++sequence as unknown as Timer;
    timers.set(handle, { at: now + ms, callback }); return handle;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", ((handle: Timer) => { timers.delete(handle); }) as typeof clearTimeout);
  return {
    advance: (ms: number) => { now += ms; },
    fireDeadline: () => {
      assert.equal(timers.size, 1, "exactly one request deadline is armed");
      const [handle, timer] = [...timers][0]; now = timer.at; timers.delete(handle); timer.callback();
    },
    timers: () => timers.size,
  };
}
test("mount and local initialize have zero HTTP, no storage writes; explicit list/detail never mark read", async () => {
  const f = fixture(); await detail(f); assert.equal(f.calls.length, 2); assert.ok(f.calls.every(x => x.init.method === "GET")); assert.equal(f.values.size, 0);
  assert.equal(f.client.getSnapshot().result?.kind, "detail"); assert.ok(Object.isFrozen(f.client.getSnapshot().result));
});
test("only exact current detail can mark, durable exact intent precedes the sole POST", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.markRead(); assert.equal(f.calls.length, 0); await f.client.load(); await f.client.markRead(); assert.equal(f.calls.length, 1);
  await f.client.detail(item.notificationId); f.setBehavior(async (_path, init) => {
    const saved = parseOwnerNotificationsPending(f.values.get(f.client.storageKey)!, siteId, actorId); assert.deepEqual(JSON.parse(init.body as string), { query: saved.query, command: saved.command });
    assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error"); return response(receipt()); });
  await f.client.markRead(); assert.equal(f.calls.filter(x => x.init.method === "POST").length, 1); assert.equal(f.values.size, 0);
  assert.equal(f.client.getSnapshot().pending, null); await f.client.markRead(); assert.equal(f.calls.length, 3);
});
test("lost POST survives pause/reload and flag off; recovery uses GET without body and clears only matching receipt", async () => {
  const f = fixture(); await lost(f); const raw = f.values.get(f.client.storageKey)!; assert.ok(!raw.includes("sourceCategory")); f.client.pause();
  f.setBehavior(null); const recovered = new AttendanceOwnerNotificationsClient({ ...f.defaults, enabled: false, recoveryOnly: true });
  await recovered.initialize(); await recovered.load(); assert.equal(f.calls.length, 3); await recovered.recover();
  assert.equal(f.calls.at(-1)?.init.method, "GET"); assert.equal(f.calls.at(-1)?.init.body, undefined);
  assert.equal(recovered.getSnapshot().pending, null); assert.equal(f.values.size, 0);
});
test("null, malformed, different operation, recipient or actor receipts never clear unknown intent", async () => {
  for (const raw of [{ ok: true, ...base, kind: "receipt", receipt: null }, { ok: true }, receipt(id(99)), receipt(op, id(99)), receipt(op, item.notificationId, id(99))]) {
    const f = fixture(); await lost(f); const saved = f.values.get(f.client.storageKey); f.setBehavior(async () => response(raw)); await f.client.recover();
    assert.equal(f.values.get(f.client.storageKey), saved); assert.ok(f.client.getSnapshot().pending); assert.equal(f.calls.filter(x => x.init.method === "POST").length, 1);
  }
});
test("HTTP rejection including disabled/conflict and 5xx never certifies original operation absence", async () => {
  for (const [error, status] of [["attendance_owner_notification_disabled", 403], ["attendance_operation_conflict", 409], ["attendance_unavailable", 503]] as const) {
    const f = fixture(); await detail(f); f.setBehavior(async () => response({ ok: false, error }, status)); await f.client.markRead();
    assert.ok(f.client.getSnapshot().pending); assert.ok(f.values.has(f.client.storageKey)); await f.client.recover(); assert.ok(f.values.has(f.client.storageKey));
  }
});
test("unknown pending prevents list, another detail and a second POST", async () => {
  const f = fixture(); await lost(f); await f.client.load(); await f.client.detail(id(77)); await f.client.markRead(); assert.equal(f.calls.length, 3);
});
test("concurrent stored replacement before recovery completion is never removed", async () => {
  const f = fixture(); await lost(f); let release!: (r: Response) => void;
  f.setBehavior(async () => new Promise(r => { release = r; })); const run = f.client.recover();
  const replacement = f.values.get(f.client.storageKey)!.replaceAll(op, id(88)); f.values.set(f.client.storageKey, replacement); release(response(receipt())); await run;
  assert.equal(f.values.get(f.client.storageKey), replacement); assert.ok(f.client.getSnapshot().pending);
});
test("Auth change after headers and first byte leaves original bytes intact", async () => {
  let current = true; const f = fixture({ isCurrentAuth: () => current }); await lost(f); const saved = f.values.get(f.client.storageKey);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const bytes = new TextEncoder().encode(JSON.stringify(receipt())); f.setBehavior(async () => new Response(new ReadableStream({ start(c) { stream = c; c.enqueue(bytes.slice(0, 1)); } }), { headers: { "content-type": "application/json" } }));
  const run = f.client.recover(); await new Promise(resolve => setImmediate(resolve)); current = false; stream.enqueue(bytes.slice(1)); stream.close(); await run;
  assert.equal(f.values.get(f.client.storageKey), saved); assert.equal(f.client.getSnapshot().result, null);
});
test("pause aborts a request even when fetch ignores its signal; late result never repopulates", async () => {
  const f = fixture(); await f.client.initialize(); let release!: (r: Response) => void; f.setBehavior(async () => new Promise(r => { release = r; }));
  const run = f.client.load(); f.client.pause(); await run; release(response({ ok: true, ...base, kind: "list", items: [item], nextCursor: null }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.values.size, 0);
});
test("one bounded request deadline includes an unending response body", async t => {
  const clock = requestClock(t), f = fixture({ timeoutMs: 8 }); await f.client.initialize();
  let cancelled = false, reads = 0, entered!: () => void;
  const pendingRead = new Promise<void>(resolve => { entered = resolve; });
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const getReader = body.getReader.bind(body);
  t.mock.method(body, "getReader", (() => {
    const reader = getReader(), read = reader.read.bind(reader);
    t.mock.method(reader, "read", () => { const part = read(); if (++reads === 2) entered(); return part; });
    return reader;
  }) as typeof body.getReader);
  f.setBehavior(async () => new Response(body, { headers: { "content-type": "application/json" } }));
  const run = f.client.load(); await pendingRead;
  assert.equal(reads, 2); assert.equal(body.locked, true); assert.equal(cancelled, false);
  assert.equal(f.calls.at(-1)?.init.signal?.aborted, false);
  clock.advance(7);
  assert.equal(f.client.getSnapshot().phase, "loading", "deadline minus one remains in the pending read");
  assert.equal(f.calls.at(-1)?.init.signal?.aborted, false); assert.equal(cancelled, false);
  clock.fireDeadline(); await run;
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
  assert.equal(cancelled, true); assert.equal(body.locked, false); assert.equal(clock.timers(), 0);
});

test("headers arriving exactly at deadline cancel body even before the timeout signal fires", async t => {
  const clock = requestClock(t), f = fixture({ timeoutMs: 8 }); await f.client.initialize(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  f.setBehavior(async (_path, init) => {
    assert.equal(init.signal?.aborted, false);
    const result = new Response(body, { headers: { "content-type": "application/json" } });
    clock.advance(8); assert.equal(init.signal?.aborted, false, "deadline callback has not run");
    return result;
  });
  await f.client.load();
  assert.equal(f.calls.at(-1)?.init.signal?.aborted, true, "post-headers lease guard aborts the request");
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
  assert.equal(cancelled, true); assert.equal(body.locked, false); assert.equal(clock.timers(), 0);
});

test("recovery headers after deadline cancel body while retaining the exact unresolved write intent", async t => {
  const clock = requestClock(t), f = fixture({ timeoutMs: 8 }); await lost(f);
  const saved = f.values.get(f.client.storageKey); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(receipt()))); }, cancel() { cancelled = true; } });
  f.setBehavior(async (_path, init) => {
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.signal?.aborted, false);
    const result = new Response(body, { headers: { "content-type": "application/json" } });
    clock.advance(9); assert.equal(init.signal?.aborted, false); return result;
  });
  await f.client.recover();
  assert.equal(f.values.get(f.client.storageKey), saved);
  assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.calls.filter(x => x.init.method === "POST").length, 1);
  assert.equal(cancelled, true); assert.equal(body.locked, false); assert.equal(clock.timers(), 0);
});
test("strict body rejects duplicate keys, invalid UTF8, oversize, non200 and wrong MIME", async () => {
  const bad = [() => new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    () => new Response(" ".repeat(131073), { headers: { "content-type": "application/json" } }),
    () => response({ ok: true, ...base, kind: "list", items: [], nextCursor: null }, 201), () => new Response("{}")];
  for (const make of bad) { const f = fixture(); await f.client.initialize(); f.setBehavior(async () => make()); await f.client.load(); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null); }
});
test("storage failure or synchronous observer invalidation cannot cause a POST", async () => {
  for (const mode of ["storage", "observer"] as const) {
    const f = fixture(); await detail(f);
    if (mode === "storage") f.storage.setItem = () => { throw Error("quota"); };
    else f.client.subscribe(() => { if (f.client.getSnapshot().phase === "saving") f.client.pause(); });
    await f.client.markRead(); assert.equal(f.calls.filter(x => x.init.method === "POST").length, 0);
  }
});
test("observer reentry during saving cannot double submit", async () => {
  const f = fixture(); await detail(f); f.client.subscribe(() => { if (f.client.getSnapshot().phase === "saving") void f.client.markRead(); });
  await f.client.markRead(); assert.equal(f.calls.filter(x => x.init.method === "POST").length, 1);
});
test("invalid or cross-identity durable intent blocks without removing or reading", async () => {
  for (const value of ["broken", JSON.stringify({ version: 1, actorId: id(8), query: {}, command: {} }), " ".repeat(4097)]) {
    const f = fixture(); f.values.set(f.client.storageKey, value); await f.client.initialize(); await f.client.load();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.values.get(f.client.storageKey), value); assert.equal(f.calls.length, 0);
  }
  assert.notEqual(ownerNotificationsPendingKey(siteId, actorId), ownerNotificationsPendingKey(siteId, id(8)));
});
test("detail must be explicitly selected from current authorized result", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.detail(item.notificationId); assert.equal(f.calls.length, 0);
  await f.client.load(); await f.client.detail(id(88)); assert.equal(f.calls.length, 1);
});
