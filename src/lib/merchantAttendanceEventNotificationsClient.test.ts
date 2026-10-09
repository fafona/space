import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEventNotificationsClient as Client, eventNotificationsPendingKey, type EventNotificationsClientOptions, type EventNotificationsPending } from "./merchantAttendanceEventNotificationsClient";
import { parseEventNotificationsBody, parseEventNotificationsHttpQuery, type EventNotificationsQuery } from "./merchantAttendanceEventNotifications";
import { eventNotificationsId as id, eventNotificationsWire as wire, eventNotificationsTime as time } from "../../scripts/fixtures/attendance-event-notifications-model";
const http = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status, headers: { "content-type": "application/json" } });
function fixture(options: Partial<EventNotificationsClientOptions> = {}) {
  const values = new Map<string, string>(), keys: string[] = [], calls: { method: string; q: EventNotificationsQuery }[] = [];
  const storage = { getItem: (key: string) => { keys.push(key); return values.get(key) ?? null; }, setItem: (key: string, raw: string) => { values.set(key, raw); }, removeItem: (key: string) => { values.delete(key); } };
  let get: ((q: EventNotificationsQuery) => Promise<Response>) | null = null, post: ((q: EventNotificationsQuery) => Promise<Response>) | null = null;
  const client = new Client({ siteId: "98400200", employeeId: id(2), enabled: true, expectedAuthUserId: id(3), storage: () => storage,
    apiFetch: async (input, init) => { const method = init?.method ?? "GET", body = method === "POST" ? parseEventNotificationsBody(JSON.parse(String(init?.body))) : null;
      const q = body?.query ?? parseEventNotificationsHttpQuery("https://local" + String(input)); calls.push({ method, q });
      if (body) { assert.ok(values.has(client.storageKey), "intent is durable before POST"); if (post) return post(q); const r = wire(q); r.detail!.readAt = time; return http({ ok: true, ...r }); }
      return get ? get(q) : http({ ok: true, ...wire(q) }); }, ...options });
  return { client, values, keys, calls, storage, get: (fn: typeof get) => { get = fn; }, post: (fn: typeof post) => { post = fn; } };
}
async function prepared(f = fixture()) { await f.client.initialize(); await f.client.load(); await f.client.detail(id(10)); return f; }
const pending = (): EventNotificationsPending => ({ version: 1, siteId: "98400200", employeeId: id(2), actorId: id(3), workerId: id(4), notificationId: id(10) });

test("initialize is local only; list/detail do not mark, one explicit mark persists and clears exact read proof", async () => {
  const f = fixture(); await f.client.initialize(); assert.equal(f.calls.length, 0); await f.client.load(); await f.client.detail(id(99)); assert.equal(f.calls.length, 1);
  await f.client.detail(id(10)); assert.equal(f.values.size, 0); await f.client.markRead(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal(f.values.size, 0); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.client.getSnapshot().result?.detail?.readAt, time);
  await f.client.markRead(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1); assert.ok(f.keys.every(k => k === f.client.storageKey));
});
test("unknown write keeps exact intent; recovery GET unread never posts; explicit repeat uses same ID", async () => {
  const f = await prepared(); f.post(async () => { throw Error("lost response"); }); await f.client.markRead(); const raw = f.values.get(f.client.storageKey)!;
  await f.client.markRead(); await f.client.load(); assert.equal(f.calls.length, 3); await f.client.recover(); assert.equal(f.calls.length, 4); assert.equal(f.calls[3].method, "GET");
  assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  f.post(null); await f.client.markRead(); assert.equal(f.calls[4].q.notificationId, id(10)); assert.equal(f.values.size, 0);
});
test("matching GET read proof clears, but errors/null/read identity mismatch never delete pending", async () => {
  const f = await prepared(); f.post(async () => { throw Error("unknown"); }); await f.client.markRead(); const raw = f.values.get(f.client.storageKey)!;
  for (const kind of ["error", "null", "auth", "worker", "differentId"] as const) { f.get(async q => { if (kind === "error") return http({ ok: false, error: "attendance_event_notification_not_found" }, 404);
    const r = wire(q); if (kind === "null") r.detail = null; if (kind === "auth") r.actorId = id(90); if (kind === "worker") r.workerId = id(90); if (kind === "differentId") r.detail!.notificationId = id(90); return http({ ok: true, ...r }); });
    await f.client.recover(); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().result, null); }
  f.get(async q => { const r = wire(q); r.detail!.readAt = time; r.canMarkRead = false; return http({ ok: true, ...r }); }); await f.client.recover(); assert.equal(f.values.size, 0);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});
test("UI flag off permits only exact pending GET; current Auth mismatch/corruption never scans or deletes", async () => {
  const p = pending(), raw = JSON.stringify(p);
  for (const auth of [id(3), id(99)]) { const f = fixture({ enabled: false, expectedAuthUserId: auth }); f.values.set(f.client.storageKey, raw);
    await f.client.initialize(); await f.client.load(); await f.client.markRead(); assert.equal(f.calls.length, 0); await f.client.recover(); assert.equal(f.calls.length, auth === id(3) ? 1 : 0); assert.equal(f.values.get(f.client.storageKey), raw);
    assert.ok(f.keys.every(k => k === f.client.storageKey)); }
  for (const raw of ["{", JSON.stringify({ ...p, actorId: [id(3)] }), JSON.stringify({ ...p, employeeId: id(99) }), JSON.stringify({ ...p, reason: "private" })]) { const f = fixture(); f.values.set(f.client.storageKey, raw);
    await f.client.initialize(); await f.client.load(); await f.client.recover(); assert.equal(f.calls.length, 0); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.client.hasLeaveRisk(), true); }
  assert.equal(eventNotificationsPendingKey("98400200", id(2)), "faolla:attendance:event-notifications:v1:98400200:" + id(2));
});
test("CAS, changed liveAuth and pause reject late read proof without clearing durable intent", async () => {
  for (const kind of ["CAS", "auth", "pause"] as const) { let live = true; const f = await prepared(fixture({ isCurrentAuth: () => live })); let release!: (response: Response) => void;
    f.post(q => new Promise(resolve => { release = () => { const r = wire(q); r.detail!.readAt = time; resolve(http({ ok: true, ...r })); }; }));
    const writing = f.client.markRead(); while (!release) await new Promise(r => setTimeout(r, 0));
    if (kind === "CAS") f.values.set(f.client.storageKey, "replacement"); if (kind === "auth") live = false; if (kind === "pause") f.client.pause(); release(http({})); await writing;
    assert.equal(f.client.getSnapshot().result, null); assert.ok(f.values.has(f.client.storageKey)); if (kind === "CAS") assert.equal(f.values.get(f.client.storageKey), "replacement"); }
});
test("subscriber pause and storage callbacks cannot POST before verified durable intent or strand unpublished state", async () => {
  for (const phase of ["saving", "pending"] as const) { const f = await prepared(); let once = false; const unsub = f.client.subscribe(() => { const s = f.client.getSnapshot(); if (!once && (phase === "pending" ? s.pending !== null : s.phase === "saving")) { once = true; f.client.pause(); } });
    await f.client.markRead(); unsub(); assert.equal(f.calls.filter(c => c.method === "POST").length, 0); await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, phase === "pending" ? "unconfirmed" : "idle"); }
  for (const kind of ["pause", "throw_before", "throw_after"] as const) { const f = await prepared(), original = f.storage.setItem;
    f.storage.setItem = (key, raw) => { if (kind !== "throw_before") original(key, raw); if (kind === "pause") f.client.pause(); else throw Error("storage"); };
    await f.client.markRead(); assert.equal(f.calls.filter(c => c.method === "POST").length, 0); f.storage.setItem = original; await f.client.initialize();
    assert.equal(f.client.getSnapshot().phase, kind === "throw_before" ? "idle" : "unconfirmed"); }
});
test("paused SQL can read but explicit repeat remains disabled; GET errors never clear intent", async () => {
  const f = await prepared(); f.post(async () => http({ ok: false, error: "attendance_platform_paused" }, 403)); await f.client.markRead(); const raw = f.values.get(f.client.storageKey)!;
  f.get(async q => http({ ok: true, ...wire(q), canMarkRead: false })); await f.client.recover(); await f.client.markRead(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1); assert.equal(f.values.get(f.client.storageKey), raw);
});
test("transport rejects non200 success, status mismatch, UTF8, redirect/content type/oversize and body timeout", async () => {
  for (const kind of ["201", "status", "utf8", "type", "large", "duplicate", "stall"] as const) { const f = await prepared(fixture({ timeoutMs: 25 }));
    f.post(async q => { const r = wire(q); r.detail!.readAt = time;
      if (kind === "201") return http({ ok: true, ...r }, 201); if (kind === "status") return http({ ok: false, error: "attendance_platform_paused" }, 400);
      if (kind === "utf8") return new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }); if (kind === "type") return new Response("{}", { headers: { "content-type": "text/html" } });
      if (kind === "large") return http({ value: "x".repeat(131073) }); if (kind === "duplicate") return new Response('{"ok":true,"ok":false}', { headers: { "content-type": "application/json" } });
      return new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }), { headers: { "content-type": "application/json" } }); });
    await f.client.markRead(); assert.equal(f.values.size, 1, kind); assert.equal(f.client.getSnapshot().phase, "unconfirmed", kind);
  }
});
