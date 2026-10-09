import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLeaveNotificationsClient } from "./merchantAttendanceLeaveNotificationsClient";
import { parseNotificationBody, parseNotificationHttpQuery, type NotificationDetail, type NotificationItem,
  type NotificationQuery } from "./merchantAttendanceLeaveNotifications";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(101), workerId = id(201), actorId = id(99);
const readAt = "2026-10-04T10:00:00.000001Z";
const firstQuery = (): NotificationQuery => ({ siteId, expectedEmployeeId: employeeId, expectedWorkerId: null,
  notificationId: null, beforeAt: null, beforeId: null });
const asItem = (row: NotificationDetail): NotificationItem => ({ notificationId: row.notificationId, requestId: row.requestId,
  revision: row.revision, type: row.type, decidedAt: row.decidedAt, startAt: row.startAt, endAt: row.endAt,
  timeZone: row.timeZone, readAt: row.readAt });

function setup() {
  const memory = new Map<string, string>(), rows = new Map<string, NotificationDetail>();
  const calls: { url: string; method: string; body: string | null; signal: AbortSignal | null | undefined }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); } };
  let writes = 0, enabled = true, mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const seed = (n = 501): NotificationDetail => {
    const row: NotificationDetail = { notificationId: id(n), requestId: id(n + 1000), revision: 2, type: "approved",
      decidedAt: "2026-10-04T09:00:00.123456Z", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z",
      timeZone: "Europe/Madrid", readAt: null, currentStatus: "approved", currentRevision: 2 };
    rows.set(row.notificationId, row); return row;
  };
  const reply = (query: NotificationQuery) => {
    const row = query.notificationId ? rows.get(query.notificationId) : null;
    if (query.notificationId && !row) return Response.json({ ok: false, error: "attendance_notification_not_found" }, { status: 404 });
    const listed = query.notificationId ? [] : [...rows.values()].filter(r => !query.beforeAt
      || r.decidedAt < query.beforeAt || r.decidedAt === query.beforeAt && r.notificationId < query.beforeId!)
      .sort((a, b) => a.decidedAt === b.decidedAt ? a.notificationId < b.notificationId ? 1 : -1 : a.decidedAt < b.decidedAt ? 1 : -1);
    const items = listed.slice(0, 25).map(asItem);
    return Response.json({ ok: true, moduleEnabled: enabled, protocol: "leave-notifications-v1", siteId, actorId, employeeId, workerId,
      items, nextCursor: listed.length > 25 ? { at: items[24].decidedAt, id: items[24].notificationId } : null, detail: row ?? null });
  };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null;
    calls.push({ url, method, body, signal: init?.signal }); assert.equal(init?.cache, "no-store");
    if (transport) return transport(url, init);
    if (method === "GET") return reply(parseNotificationHttpQuery(new URL(url, "https://fixture.invalid").href));
    const { query, command } = parseNotificationBody(JSON.parse(body!));
    const key = `faolla:attendance:leave-notifications:v1:${siteId}:${employeeId}`;
    assert.deepEqual(JSON.parse(memory.get(key)!), { siteId, employeeId, actorId, workerId, notificationId: command.notificationId }, "complete intent must be persisted and read back before POST");
    assert.equal(init?.headers && new Headers(init.headers).get("content-type"), "application/json");
    if (mode === "unsent") throw Error("request not delivered");
    const row = rows.get(command.notificationId)!; assert.ok(row);
    if (!row.readAt) {
      if (!enabled) return Response.json({ ok: false, error: "attendance_platform_paused" }, { status: 403 });
      row.readAt = readAt; writes++;
    }
    if (mode === "lost") throw Error("committed 200 response lost");
    return reply(query);
  };
  const create = (patch: Partial<{ timeoutMs: number; storage: () => typeof storage }> = {}) =>
    new AttendanceLeaveNotificationsClient({ siteId, employeeId, apiFetch, storage: () => storage, timeoutMs: 1000, ...patch });
  return { create, client: create(), memory, storage, rows, calls, seed, reply, writes: () => writes,
    enabled: (value: boolean) => { enabled = value; }, mode: (value: typeof mode) => { mode = value; },
    transport: (value: typeof transport) => { transport = value; } };
}

async function openDetail(f: ReturnType<typeof setup>) {
  f.seed(); await f.client.initialize(); await f.client.detail(id(501));
  assert.equal(f.client.getSnapshot().result?.detail?.notificationId, id(501));
}

test("constructor is inert; only initialize reads, employee identity is not the auth ID, and viewing does not mark read", async () => {
  const f = setup(), unrelated = `faolla:attendance:leave:v1:${siteId}:self:${employeeId}`;
  f.memory.set(unrelated, "other feature pending"); f.seed();
  let changes = 0; const off = f.client.subscribe(() => { changes++; });
  await f.client.next(); await f.client.detail(id(501)); await f.client.markRead(); assert.equal(f.calls.length, 0);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready");
  assert.equal(f.client.getSnapshot().result?.employeeId, employeeId); assert.equal(f.client.getSnapshot().result?.actorId, actorId);
  assert.notEqual(employeeId, actorId); assert.equal(f.client.storageKey, `faolla:attendance:leave-notifications:v1:${siteId}:${employeeId}`);
  await f.client.detail(id(501)); assert.deepEqual(f.calls.map(c => c.method), ["GET", "GET"]); assert.equal(f.writes(), 0);
  assert.equal(f.client.getSnapshot().result?.detail?.readAt, null); assert.ok(changes > 0);
  off(); const n = changes; f.client.pause(); assert.equal(changes, n); assert.equal(f.client.getSnapshot().result, null);
  assert.equal(f.memory.get(unrelated), "other feature pending");
});

test("explicit mark-read persists all five identity fields and repeats keep the first timestamp and the original notification ID", async () => {
  const f = setup(); await openDetail(f); await f.client.markRead();
  assert.equal(f.client.getSnapshot().result?.detail?.readAt, readAt); assert.equal(f.client.getSnapshot().pending, null);
  assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
  await f.client.markRead(); assert.equal(f.client.getSnapshot().result?.detail?.readAt, readAt); assert.equal(f.writes(), 1);
  const posts = f.calls.filter(c => c.method === "POST"); assert.ok(posts.length >= 1);
  for (const call of posts) assert.deepEqual(JSON.parse(call.body!).command, { action: "mark_read", notificationId: id(501) });
  assert.ok(f.calls.every(c => c.url.startsWith("/api/merchant-enterprise/attendance/leave-notifications")));
});

test("lost successful mark-read recovers by the exact pending GET even during platform pause without another POST", async () => {
  const f = setup(); await openDetail(f); f.mode("lost"); await f.client.markRead();
  const raw = f.memory.get(f.client.storageKey)!;
  assert.deepEqual(JSON.parse(raw), { siteId, employeeId, actorId, workerId, notificationId: id(501) });
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.writes(), 1);
  f.enabled(false); const restored = f.create(), n = f.calls.length; await restored.initialize();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  const q = parseNotificationHttpQuery(new URL(f.calls[n].url, "https://fixture.invalid").href);
  assert.deepEqual(q, { ...firstQuery(), expectedWorkerId: workerId, notificationId: id(501) });
  assert.equal(restored.getSnapshot().result?.detail?.readAt, readAt); assert.equal(restored.getSnapshot().result?.moduleEnabled, false);
  assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
});

test("unread pending survives initialize and list/detail attempts; explicit retry GETs first and repeats only the byte-identical original POST", async () => {
  const f = setup(); await openDetail(f); f.mode("unsent"); await f.client.markRead();
  const raw = f.memory.get(f.client.storageKey), original = f.calls.at(-1)!.body;
  const restored = f.create(), n = f.calls.length; await restored.initialize();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
  assert.ok(restored.getSnapshot().pending); assert.equal(restored.getSnapshot().phase, "unconfirmed");
  const pendingCalls = f.calls.length; await restored.list(); await restored.next(); await restored.detail(id(999)); await restored.markRead();
  assert.equal(f.calls.length, pendingCalls);
  f.mode("normal"); const beforeRetry = f.calls.length; await restored.retry();
  assert.deepEqual(f.calls.slice(beforeRetry).map(c => c.method), ["GET", "POST"]); assert.equal(f.calls.at(-1)!.body, original);
  assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
});

test("all follow-up list, detail and pending recovery responses pin actor, worker and enterprise employee", async () => {
  for (const field of ["actorId", "employeeId", "workerId", "siteId"] as const) {
    const f = setup(); await openDetail(f); f.mode("unsent"); await f.client.markRead();
    const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async url => { const response = await f.reply(parseNotificationHttpQuery(new URL(url, "https://fixture.invalid").href));
      return Response.json({ ...await response.json(), [field]: field === "siteId" ? "99990002" : id(777) }); });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    assert.equal(f.memory.get(f.client.storageKey), raw); assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  }
  for (const field of ["actorId", "workerId"] as const) {
    const f = setup(); f.seed(); await f.client.initialize();
    f.transport(async url => { const response = f.reply(parseNotificationHttpQuery(new URL(url, "https://fixture.invalid").href));
      return Response.json({ ...await response.json(), [field]: id(777) }); });
    await f.client.detail(id(501)); assert.equal(f.client.getSnapshot().result, null);
    assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  }
});

test("fresh initialization never claims a different authenticated actor's pending identity", async () => {
  const f = setup(); await openDetail(f); f.mode("unsent"); await f.client.markRead();
  const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
  f.transport(async url => { const response = f.reply(parseNotificationHttpQuery(new URL(url, "https://fixture.invalid").href));
    return Response.json({ ...await response.json(), actorId: id(777) }); });
  const other = f.create(); await other.initialize();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(other.getSnapshot().result, null);
  assert.equal(f.memory.get(f.client.storageKey), raw); assert.ok(other.getSnapshot().pending);
});

test("malformed storage and cross-tab identity replacement are preserved without reads or POSTs", async () => {
  const pending = { siteId, employeeId, actorId, workerId, notificationId: id(501) };
  for (const raw of ["{invalid", "x".repeat(8193), JSON.stringify({ ...pending, employeeId: id(777) }),
    JSON.stringify({ ...pending, siteId: "99990002" }), JSON.stringify({ ...pending, operationId: id(601) }),
    JSON.stringify({ ...pending, workerId: null })]) {
    const f = setup(); f.memory.set(f.client.storageKey, raw); await f.client.initialize();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0); assert.equal(f.memory.get(f.client.storageKey), raw);
  }
  const f = setup(); await openDetail(f); f.mode("unsent"); await f.client.markRead();
  const raw = JSON.stringify({ ...pending, notificationId: id(888) }); f.memory.set(f.client.storageKey, raw);
  const n = f.calls.length; await f.client.retry(); assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  assert.equal(f.client.getSnapshot().result, null);
});

test("storage write errors and read-back mismatches prevent POST and never remove unrelated storage", async () => {
  for (const broken of ["throws", "discard", "replace"] as const) {
    const f = setup(); f.seed(); const key = f.client.storageKey;
    const other = `faolla:attendance:self:${employeeId}`; f.memory.set(other, "untouched");
    const custom = { ...f.storage, setItem: (name: string, value: string) => {
      if (broken === "throws") throw Error("storage disabled");
      if (broken === "replace") f.memory.set(name, value.replace(id(501), id(777)));
    } };
    const client = f.create({ storage: () => custom }); await client.initialize(); await client.detail(id(501)); await client.markRead();
    assert.equal(f.calls.filter(c => c.method === "POST").length, 0); assert.equal(f.memory.get(other), "untouched");
    if (broken === "replace") assert.match(f.memory.get(key)!, new RegExp(id(777)));
  }
});

test("unknown, malformed and identity-denial errors retain the exact pending notification without automatic writes", async () => {
  for (const [body, status] of [[{ ok: false, error: "attendance_access_denied" }, 403],
    [{ ok: false, error: "attendance_worker_changed" }, 409], [{ ok: false, error: "attendance_notification_not_found" }, 404],
    [{ ok: false, error: "attendance_not_available" }, 404], [{ ok: false, error: "attendance_notification_invalid" }, 503],
    [{ ok: true, error: "attendance_platform_paused" }, 403], [{ error: "attendance_platform_paused" }, 403],
    [{ ok: false, error: "attendance_platform_paused", extra: true }, 403],
    [{ ok: false, error: "attendance_platform_paused" }, 500], [{ ok: false, error: "private SQL detail" }, 503]] as [unknown, number][]) {
    const f = setup(); await openDetail(f); f.mode("unsent"); await f.client.markRead();
    const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async () => Response.json(body, { status })); await f.client.retry();
    assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
    assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("malformed success cannot settle a possibly committed read or introduce a new notification identity", async () => {
  for (const variant of ["html", "wrong-notice", "extra-field", "oversized", "wrong-flag"] as const) {
    const f = setup(); await openDetail(f); f.mode("lost"); await f.client.markRead();
    const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async url => {
      if (variant === "html") return new Response("login", { headers: { "content-type": "text/html" } });
      const body = await f.reply(parseNotificationHttpQuery(new URL(url, "https://fixture.invalid").href)).json();
      if (variant === "wrong-notice") body.detail.notificationId = id(777);
      if (variant === "extra-field") body.detail.reason = "private";
      if (variant === "oversized") body.privateData = "x".repeat(131073);
      if (variant === "wrong-flag") body.moduleEnabled = "true";
      return Response.json(body);
    });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    assert.equal(f.memory.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("platform pause keeps existing history readable and blocks fresh marking and unread pending replay", async () => {
  const f = setup(); f.seed(); f.enabled(false); await f.client.initialize(); await f.client.detail(id(501)); await f.client.markRead();
  assert.equal(f.client.getSnapshot().result?.detail?.notificationId, id(501)); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  f.enabled(true); await f.client.list(); await f.client.detail(id(501)); f.mode("unsent"); await f.client.markRead();
  const raw = f.memory.get(f.client.storageKey), n = f.calls.length; f.enabled(false); await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw); assert.ok(f.client.getSnapshot().pending);
});

test("explicit pagination pins worker, preserves microseconds and limits details to notifications on the current page", async () => {
  const f = setup(); for (let n = 501; n <= 530; n++) f.seed(n); await f.client.initialize();
  assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result?.items.length, 25);
  await f.client.next(); assert.equal(f.client.getSnapshot().result?.items.length, 5);
  const page = parseNotificationHttpQuery(new URL(f.calls[1].url, "https://fixture.invalid").href);
  assert.equal(page.beforeId, id(506)); assert.equal(page.beforeAt, "2026-10-04T09:00:00.123456Z"); assert.equal(page.expectedWorkerId, workerId);
  const n = f.calls.length; await f.client.next(); await f.client.detail(id(530)); await f.client.detail(id(999)); assert.equal(f.calls.length, n);
  await f.client.detail(id(501)); assert.equal(f.client.getSnapshot().result?.detail?.notificationId, id(501));
  assert.deepEqual(f.client.getSnapshot().result?.items, []); assert.equal(f.client.getSnapshot().result?.nextCursor, null);
  await f.client.list(); assert.equal(f.client.getSnapshot().result?.items.length, 25);
});

test("hidden requests are inert; paused late GET success or denial cannot overwrite a new explicit result", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const hidden = setup(); await hidden.client.initialize(); await hidden.client.list(); assert.equal(hidden.calls.length, 0); doc.hidden = false;
  for (const denial of [false, true]) {
    const f = setup(); let release!: (r: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const reading = f.client.initialize(); await f.client.initialize(); assert.equal(f.calls.length, 1); f.client.pause();
    assert.equal(f.calls[0].signal?.aborted, true); assert.equal(f.client.getSnapshot().result, null);
    f.transport(null); f.seed(600); await f.client.initialize(); const fresh = f.client.getSnapshot();
    release(denial ? Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }) : f.reply(firstQuery()));
    await reading; assert.equal(f.client.getSnapshot(), fresh); assert.equal(f.client.getSnapshot().result?.items[0].notificationId, id(600));
  }
});

test("fresh notification client preserves paused intent across denied reopen and late successful or definitive POST reply", async t => {
  for (const committed of [true, false]) await t.test(`late ${committed ? "success" : "definitive refusal"}`, async () => {
    const f = setup(), unrelated = `faolla:attendance:leave:v1:${siteId}:self:${employeeId}`;
    f.memory.set(unrelated, "unrelated leave pending bytes"); await openDetail(f);
    let release!: (response: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const writing = f.client.markRead(), post = f.calls.at(-1)!, raw = f.memory.get(f.client.storageKey);
    assert.equal(post.method, "POST"); assert.ok(raw);
    const { query, command } = parseNotificationBody(JSON.parse(post.body!));
    if (committed) f.rows.get(command.notificationId)!.readAt = readAt;
    const late = committed ? f.reply(query) : Response.json({ ok: false, error: "attendance_platform_paused" }, { status: 403 });
    f.client.pause(); const paused = f.client.getSnapshot();
    assert.equal(post.signal?.aborted, true); assert.equal(paused.result, null);
    assert.equal(f.memory.get(f.client.storageKey), raw);

    f.transport(async () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }));
    const reopened = f.create(), beforeReopen = f.calls.length;
    assert.notEqual(reopened, f.client); assert.equal(reopened.storageKey, f.client.storageKey);
    await reopened.initialize(); const denied = reopened.getSnapshot();
    assert.deepEqual(f.calls.slice(beforeReopen).map(call => call.method), ["GET"]);
    const recoveryQuery = parseNotificationHttpQuery(new URL(f.calls[beforeReopen].url, "https://fixture.invalid").href);
    assert.deepEqual(recoveryQuery, { ...firstQuery(), expectedWorkerId: workerId, notificationId: command.notificationId });
    assert.equal(denied.phase, "unconfirmed"); assert.equal(denied.result, null);
    assert.deepEqual(denied.pending, JSON.parse(raw)); assert.equal(f.memory.get(f.client.storageKey), raw);

    release(late); await writing;
    assert.equal(f.client.getSnapshot(), paused); assert.equal(reopened.getSnapshot(), denied);
    assert.equal(f.memory.get(f.client.storageKey), raw); assert.equal(f.memory.get(unrelated), "unrelated leave pending bytes");
    f.transport(null); f.enabled(false); const beforeRecovery = f.calls.length;
    await reopened.initialize();
    assert.deepEqual(f.calls.slice(beforeRecovery).map(call => call.method), ["GET"]);
    assert.deepEqual(parseNotificationHttpQuery(new URL(f.calls[beforeRecovery].url, "https://fixture.invalid").href), recoveryQuery);
    assert.equal(reopened.getSnapshot().result?.moduleEnabled, false);
    if (committed) {
      assert.equal(reopened.getSnapshot().pending, null); assert.equal(f.memory.has(f.client.storageKey), false);
      assert.equal(reopened.getSnapshot().result?.detail?.readAt, readAt);
    } else {
      assert.equal(reopened.getSnapshot().phase, "unconfirmed"); assert.equal(reopened.getSnapshot().result?.detail?.readAt, null);
      assert.deepEqual(reopened.getSnapshot().pending, JSON.parse(raw)); assert.equal(f.memory.get(f.client.storageKey), raw);
    }
    assert.equal(reopened.getSnapshot().result?.detail?.notificationId, command.notificationId);
    assert.equal(f.memory.get(unrelated), "unrelated leave pending bytes");
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  });
});

test("pausing in-flight POST rejects late success or denial without clearing intent, then GET alone resolves the original notice", async () => {
  for (const committed of [true, false]) {
    const f = setup(); await openDetail(f); let release!: (r: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const writing = f.client.markRead(), raw = f.memory.get(f.client.storageKey); assert.ok(raw); assert.equal(f.calls.at(-1)?.method, "POST");
    const { query } = parseNotificationBody(JSON.parse(f.calls.at(-1)!.body!));
    if (committed) f.rows.get(id(501))!.readAt = readAt;
    const late = committed ? f.reply(query) : Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
    f.client.pause(); const paused = f.client.getSnapshot(); assert.equal(f.calls.at(-1)?.signal?.aborted, true);
    release(late); await writing; assert.equal(f.client.getSnapshot(), paused); assert.equal(paused.result, null); assert.ok(paused.pending);
    assert.equal(f.memory.get(f.client.storageKey), raw);
    f.transport(null); const n = f.calls.length; await f.client.initialize();
    assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
    if (committed) { assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.memory.has(f.client.storageKey), false); }
    else { assert.ok(f.client.getSnapshot().pending); assert.equal(f.memory.get(f.client.storageKey), raw); }
  }
});

test("slow error streams time out, cancel and unlock their reader while retaining the exact pending identity", async () => {
  const f = setup(); f.seed(); const client = f.create({ timeoutMs: 25 }); await client.initialize(); await client.detail(id(501));
  let cancelled = 0; const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":')); }, cancel() { cancelled++; } });
  f.transport(async () => new Response(stream, { status: 503, headers: { "content-type": "application/json" } }));
  await client.markRead(); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(f.calls.at(-1)?.signal?.aborted, true);
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(client.getSnapshot().pending); assert.ok(f.memory.get(client.storageKey));
});

test("storage replaced during a committed POST cannot be cleared or displayed by its late success", async () => {
  const f = setup(); await openDetail(f); let release!: (r: Response) => void;
  f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
  const writing = f.client.markRead(); assert.equal(f.calls.at(-1)?.method, "POST");
  const { query } = parseNotificationBody(JSON.parse(f.calls.at(-1)!.body!));
  const raw = JSON.stringify({ siteId, employeeId, actorId, workerId, notificationId: id(777) });
  f.memory.set(f.client.storageKey, raw); f.rows.get(id(501))!.readAt = readAt;
  release(f.reply(query)); await writing;
  assert.equal(f.memory.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().result, null);
  assert.equal(f.client.getSnapshot().pending?.notificationId, id(501));
  const n = f.calls.length; await f.client.retry(); assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("cross-tab pending appearing during an ordinary GET is preserved and its unrelated response is not displayed", async () => {
  const f = setup(); f.seed(); let release!: (r: Response) => void;
  f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
  const reading = f.client.initialize();
  const raw = JSON.stringify({ siteId, employeeId, actorId, workerId, notificationId: id(777) }); f.memory.set(f.client.storageKey, raw);
  release(f.reply(firstQuery())); await reading;
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.memory.get(f.client.storageKey), raw);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});

test("an unbound first page is empty and cannot silently adopt a later worker within the same pinned client", async () => {
  const f = setup();
  f.transport(async () => Response.json({ ok: true, moduleEnabled: true, protocol: "leave-notifications-v1", siteId,
    actorId, employeeId, workerId: null, items: [], nextCursor: null, detail: null }));
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().result?.workerId, null);
  const n = f.calls.length; await f.client.next(); await f.client.detail(id(501)); await f.client.markRead(); assert.equal(f.calls.length, n);
  f.transport(null); f.seed(); await f.client.list();
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});

test("document becoming hidden before GET resolves independently clears ordinary content and rejects both success and denial", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: false };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  for (const denied of [false, true]) {
    doc.hidden = false; const f = setup(); f.seed(); let release!: (r: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; })); const reading = f.client.initialize();
    doc.hidden = true;
    release(denied ? Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }) : f.reply(firstQuery()));
    await reading; assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "idle");
    const n = f.calls.length; await f.client.list(); await f.client.markRead(); assert.equal(f.calls.length, n);
  }
});

test("error bodies over 4KiB are cancelled before they can settle pending regardless of an apparent refusal code", async () => {
  const f = setup(); await openDetail(f); let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: false, error: "attendance_platform_paused", padding: "x".repeat(4096) }))); },
    cancel() { cancelled++; } });
  f.transport(async () => new Response(stream, { status: 403, headers: { "content-type": "application/json" } }));
  await f.client.markRead(); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.ok(f.client.getSnapshot().pending);
  assert.ok(f.memory.get(f.client.storageKey)); assert.equal(f.client.getSnapshot().result, null);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});
