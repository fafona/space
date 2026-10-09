import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLocationClockClient, attendanceLocationClockPendingKey, parseAttendanceLocationClockPending } from "./merchantAttendanceLocationClockClient";
import { parseAttendanceLocationClockCommand } from "./merchantAttendanceLocationClock";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { AttendanceEvent } from "./merchantAttendance";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3), at = "2026-09-30T10:00:00.000Z";
const policy = { settingsVersion: 1, workerVersion: 1, locationVersion: 1, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const memory = new Map<string, string>(), storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  let geoCalls = 0, reads = 0, posts = 0, count = 40, sequence = 0, last: AttendanceEvent | null = null;
  let mode = "normal", moduleEnabled = true, channelEnabled = true, visible = true, noticeReady = true, noticeRevision = 1;
  let success: PositionCallback | null = null, failed: PositionErrorCallback | null = null;
  const records = new Map<string, { event: AttendanceEvent; summary: Record<string, unknown>; gate?: Record<string, unknown> }>();
  const geo = { getCurrentPosition: (s: PositionCallback, e?: PositionErrorCallback | null) => { geoCalls++; success = s; failed = e ?? null;
    if (mode !== "hold_device") queueMicrotask(() => mode === "deny_device" ? e?.({ code: 1 } as GeolocationPositionError) : s({ timestamp: Date.parse(at), coords: { latitude: 37.3, longitude: -5.9, accuracy: 10 } } as GeolocationPosition)); } };
  const response = (operation: string | null = null) => {
    const record = records.get(operation ?? "");
    return { ok: true, moduleEnabled, siteId, employeeId, workerId, locationId, channelEnabled, policy,
      noticeGate: { ready: noticeReady, reason: noticeReady ? "ready" : "withdrawn", revision: noticeRevision },
      finish: last && last.action !== "clock_out" ? { locationId, settingsVersion: 1, workerVersion: 1, locationVersion: 1 } : null,
      receiptGate: record?.gate ?? null,
      state: { sequence, status: !last || last.action === "clock_out" ? "off" : last.action === "break_start" ? "break" : "working", lastEvent: last },
      receipt: record?.event ?? null, locationResult: record?.summary ?? null, replayed: false };
  };
  const fetch: AttendanceApiFetch = async (url, init) => {
    assert.match(url, /^\/api\/merchant-enterprise\/attendance\/location-clock(?:\?|$)/); assert.equal(init?.cache, "no-store");
    if (init?.method !== "POST") {
      reads++;
      if (mode === "bad_read") return Response.json({ ...response(), employeeId: id(99) });
      if (mode === "offline") throw Error("offline");
      if (mode === "read_identity_reject") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
      if (mode === "read_worker_changed") return Response.json({ ok: false, error: "attendance_worker_changed" }, { status: 409 });
      const op = new URL(url, "https://local.invalid").searchParams.get("operationId"); return Response.json(response(op));
    }
    posts++;
    const raw = storage.getItem(attendanceLocationClockPendingKey(siteId, employeeId)); assert.ok(raw, "intent saved before POST");
    assert.doesNotMatch(raw, /latitude|longitude|position|capturedAt|accuracyMeters/);
    const { command } = parseAttendanceLocationClockCommand(JSON.parse(String(init.body)));
    assert.equal(JSON.parse(raw).intent.operationId, command.operationId);
    if (mode === "explicit_reject") return Response.json({ ok: false, error: "attendance_sequence_conflict" }, { status: 409 });
    if (mode === "identity_reject") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
    if (mode === "worker_changed") return Response.json({ ok: false, error: "attendance_worker_changed" }, { status: 409 });
    if (mode === "before_commit_lost") throw Error("not delivered");
    if (mode === "changed_employee") return Response.json({ ...response(), employeeId: id(99) });
    if (command.expectedSequence !== sequence) return Response.json({ ok: false, error: "attendance_sequence_conflict" }, { status: 409 });
    if (!records.has(command.operationId)) {
      sequence++;
      last = { id: id(++count), siteId, workerId, locationId, operationId: command.operationId, action: command.action,
        breakPaid: command.action === "break_start" ? false : null, occurredAt: at, timeZone: "UTC", sequence };
      const sqlCommand = Object.fromEntries(Object.entries(command).filter(([key]) => !["expectedWorkerId", "position", "positionFailure"].includes(key)));
      records.set(command.operationId, { event: last, gate: { safeFinish: command.safeFinish, noticeRevision: command.noticeRevision, command: sqlCommand }, summary: { eventId: last.id, settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1,
        reason: command.position ? "inside" : command.positionFailure, needsReview: !command.position, capturedAt: command.position?.capturedAt ?? null,
        accuracyMeters: command.position?.accuracyMeters ?? null, distanceMeters: command.position ? 0 : null } });
    }
    if (mode === "lost") throw Error("response lost after commit");
    if (mode === "post_timeout") return new Promise<Response>(() => {});
    return Response.json(response(command.operationId));
  };
  const create = (overrides: Partial<ConstructorParameters<typeof AttendanceLocationClockClient>[0]> = {}) => new AttendanceLocationClockClient({ siteId, employeeId, workerId, canClock: true,
    apiFetch: fetch, storage: () => storage, randomId: () => id(30), timeoutMs: 50, locationTimeoutMs: 50,
    environment: { isSecureContext: () => true, isVisible: () => visible, geolocation: () => geo }, ...overrides });
  return { create, storage, memory, records, response, mode: (v: string) => { mode = v; }, module: (v: boolean) => { moduleEnabled = v; },
    channel: (v: boolean) => { channelEnabled = v; }, visible: (v: boolean) => { visible = v; },
    notice: (ready: boolean, revision = 1) => { noticeReady = ready; noticeRevision = revision; channelEnabled = ready; },
    metrics: () => ({ geoCalls, reads, posts, sequence }),
    release: () => success?.({ timestamp: Date.parse(at), coords: { latitude: 37.3, longitude: -5.9, accuracy: 10 } } as GeolocationPosition),
    fail: () => failed?.({ code: 1 } as GeolocationPositionError),
  };
}
test("location clock constructor/init/read perform no device lookup or POST", async () => {
  const f = fixture(), c = f.create(); assert.deepEqual(f.metrics(), { geoCalls: 0, reads: 0, posts: 0, sequence: 0 });
  await c.initialize(); assert.equal(c.getSnapshot().phase, "ready"); assert.deepEqual(f.metrics(), { geoCalls: 0, reads: 1, posts: 0, sequence: 0 });
});

test("unconfirmed/withdrawn notice blocks GPS acquisition as well as POST", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.notice(false, 2);
  await c.submit("clock_in"); assert.equal(f.metrics().geoCalls, 0); assert.equal(f.metrics().posts, 0);
  assert.equal(f.memory.size, 0);
});

test("explicit safe finish after pause and withdrawal never samples GPS and records original operation", async () => {
  const f = fixture(); let op = 30; const c = f.create({ randomId: () => id(op++) });
  await c.initialize(); await c.submit("clock_in"); f.module(false); f.notice(false, 2);
  await c.refresh(); await c.finish();
  assert.equal(f.metrics().geoCalls, 1); assert.equal(f.metrics().posts, 2); assert.equal(c.getSnapshot().result?.state.status, "off");
  assert.equal(c.getSnapshot().confirmed?.receiptGate?.safeFinish, true); assert.equal(c.getSnapshot().confirmed?.receiptGate?.noticeRevision, null);
  assert.equal(c.getSnapshot().confirmed?.locationResult?.needsReview, true);
  await c.finish(); assert.equal(f.metrics().posts, 2);
});

test("safe finish preserves an uncertain operation through remount without repeat sampling or POST", async () => {
  const f = fixture(); let op = 30; const c = f.create({ randomId: () => id(op++) });
  await c.initialize(); await c.submit("clock_in"); f.notice(false, 2); await c.refresh(); f.mode("lost"); await c.finish();
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().pending?.intent.safeFinish, true);
  f.mode("normal"); const restored = f.create(); await restored.initialize();
  assert.equal(restored.getSnapshot().confirmed?.receiptGate?.safeFinish, true); assert.equal(f.metrics().posts, 2); assert.equal(f.metrics().geoCalls, 1);
});

test("safe finish retry keeps same ID and mode, regardless of a newly restored operational channel", async () => {
  const f = fixture(); let op = 30; const c = f.create({ randomId: () => id(op++) });
  await c.initialize(); await c.submit("clock_in"); f.notice(false, 2); await c.refresh(); f.mode("before_commit_lost"); await c.finish();
  const pending = c.getSnapshot().pending!.intent.operationId; f.notice(true, 3); f.mode("normal"); await c.retry();
  assert.equal(c.getSnapshot().confirmed?.receipt?.operationId, pending); assert.equal(c.getSnapshot().confirmed?.receiptGate?.safeFinish, true);
  assert.equal(f.metrics().geoCalls, 1); assert.equal(f.metrics().posts, 3);
});

test("new immutable notice revision fences undelivered old intent so a fresh explicit safe close is possible", async () => {
  const f = fixture(); let op = 30; const c = f.create({ randomId: () => id(op++) });
  await c.initialize(); await c.submit("clock_in"); f.mode("before_commit_lost"); await c.submit("clock_out");
  assert.equal(c.getSnapshot().phase, "unconfirmed"); f.notice(false, 2); f.mode("normal"); await c.refresh();
  assert.equal(c.getSnapshot().pending, null); assert.equal(c.getSnapshot().confirmed, null); assert.equal(f.memory.size, 0);
  await c.finish(); assert.equal(c.getSnapshot().result?.state.status, "off"); assert.equal(f.metrics().geoCalls, 2);
});

test("another location's higher notice revision cannot discard the original location's uncertain intent", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("before_commit_lost"); await c.submit("clock_in");
  f.notice(true, 99);
  const moved = f.create({ apiFetch: async () => Response.json({ ...f.response(), locationId: id(9) }) });
  await moved.initialize(); assert.equal(moved.getSnapshot().phase, "unconfirmed"); assert.ok(moved.getSnapshot().pending); assert.equal(f.memory.size, 1);
  assert.equal(f.metrics().geoCalls, 1); assert.equal(f.metrics().posts, 1);
});

test("stale safe-finish confirmation cannot close a later sequence discovered during preflight", async () => {
  const f = fixture(); let op = 30; const first = f.create({ randomId: () => id(op++) });
  await first.initialize(); await first.submit("clock_in");
  const second = f.create({ randomId: () => id(op++) }); await second.initialize(); await second.submit("break_start"); await second.submit("break_end");
  await first.finish(); assert.equal(first.getSnapshot().phase, "blocked"); assert.equal(f.metrics().posts, 3); assert.equal(f.metrics().sequence, 3);
});

test("break safe finish does not silently clock out; second explicit action is required", async () => {
  const f = fixture(); let op = 30; const c = f.create({ randomId: () => id(op++) });
  await c.initialize(); await c.submit("clock_in"); await c.submit("break_start"); f.notice(false, 2); await c.refresh();
  await c.finish(); assert.equal(c.getSnapshot().result?.state.status, "working"); assert.equal(c.getSnapshot().confirmed?.receipt?.action, "break_end");
  await c.finish(); assert.equal(c.getSnapshot().result?.state.status, "off"); assert.equal(f.metrics().posts, 4); assert.equal(f.metrics().geoCalls, 2);
});
test("explicit sample submit persists intent only, then confirms paired event and summary", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.submit("clock_in");
  assert.deepEqual(f.metrics(), { geoCalls: 1, reads: 2, posts: 1, sequence: 1 }); assert.equal(c.getSnapshot().phase, "ready");
  assert.equal(c.getSnapshot().confirmed?.receipt?.id, c.getSnapshot().confirmed?.locationResult?.eventId);
  assert.doesNotMatch(JSON.stringify(c.getSnapshot()), /latitude|longitude|internalFence/); assert.equal(f.memory.size, 0);
});
test("lost response recovers same receipt on remount; never resamples or posts automatically", async () => {
  const f = fixture(), first = f.create(); await first.initialize(); f.mode("lost"); await first.submit("clock_in");
  assert.equal(first.getSnapshot().phase, "unconfirmed"); assert.equal(f.memory.size, 1); const op = first.getSnapshot().pending!.intent.operationId;
  first.pause(); f.mode("normal"); const second = f.create(); await second.initialize();
  assert.equal(second.getSnapshot().confirmed?.receipt?.operationId, op); assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().geoCalls, 1); assert.equal(f.memory.size, 0);
});
test("manual retry first checks receipt, does not create a second event or acquire fresh GPS when already committed", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("lost"); await c.submit("clock_in");
  f.mode("normal"); await c.retry(); assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().geoCalls, 1); assert.equal(f.records.size, 1); assert.equal(c.getSnapshot().phase, "ready");
});
test("undelivered original operation retries explicitly with same ID and fresh location, never a new ID", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("before_commit_lost"); await c.submit("clock_in");
  const op = c.getSnapshot().pending!.intent.operationId; assert.equal(f.records.size, 0); f.mode("normal"); await c.retry();
  assert.equal(c.getSnapshot().confirmed?.receipt?.operationId, op); assert.equal(f.records.size, 1); assert.equal(f.metrics().posts, 2); assert.equal(f.metrics().geoCalls, 2);
});
test("denied location never automatically submits fallback; fallback requires separate explicit action", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("deny_device"); await c.submit("clock_in");
  assert.equal(f.metrics().posts, 0); assert.equal(f.memory.size, 0); assert.equal(c.getSnapshot().phase, "blocked");
  f.mode("normal"); await c.refresh(); await c.submit("clock_in", "denied");
  assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().geoCalls, 1); assert.equal(c.getSnapshot().confirmed?.locationResult?.needsReview, true);
  assert.equal(c.getSnapshot().confirmed?.locationResult?.accuracyMeters, null); assert.match(c.getSnapshot().message, /待核查/);
});
test("cancel/hidden while locating sends neither durable intent nor POST; late sample ignored", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("hold_device"); const sending = c.submit("clock_in"); await tick();
  assert.equal(c.getSnapshot().phase, "locating"); f.visible(false); c.pause(); f.release(); await sending;
  assert.equal(f.metrics().posts, 0); assert.equal(f.memory.size, 0); assert.equal(c.getSnapshot().result, null);
});
test("cancel after POST preserves recovery intent and does not claim rollback", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("post_timeout"); const sending = c.submit("clock_in"); await tick();
  assert.equal(f.metrics().posts, 1); c.pause(); await sending; assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(f.memory.size, 1);
  f.mode("normal"); await c.initialize(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(f.metrics().posts, 1); assert.equal(f.memory.size, 0);
});
test("HTTP timeout after commit preserves original ID; subsequent GET recovers it", async () => {
  const f = fixture(), c = f.create({ timeoutMs: 5 }); await c.initialize(); f.mode("post_timeout"); await c.submit("clock_in");
  assert.equal(c.getSnapshot().phase, "unconfirmed"); f.mode("normal"); await c.refresh(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(f.metrics().posts, 1);
});
test("first definitive refusal clears brand-new intent, retry refusal keeps possible previous receipt", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("explicit_reject"); await c.submit("clock_in", "not_provided");
  assert.equal(c.getSnapshot().pending, null); assert.equal(f.memory.size, 0);
  f.mode("normal"); await c.refresh(); f.mode("before_commit_lost"); await c.submit("clock_in", "not_provided");
  const op = c.getSnapshot().pending!.intent.operationId; f.mode("explicit_reject"); await c.retry("not_provided");
  assert.equal(c.getSnapshot().pending?.intent.operationId, op); assert.equal(f.memory.size, 1); assert.equal(c.getSnapshot().phase, "unconfirmed");
});
for (const rejection of ["identity_reject", "worker_changed"]) test(`first ${rejection} and retry preserve the original intent for identity review`, async () => {
  const f = fixture(), c = f.create();
  await c.initialize(); f.mode(rejection); await c.submit("clock_in", "not_provided");
  assert.equal(c.getSnapshot().phase, "blocked");
  const pending = f.storage.getItem(c.storageKey); assert.ok(pending); assert.equal(f.memory.size, 1);
  assert.equal(c.getSnapshot().pending?.intent.operationId, id(30));
  assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().confirmed, null);
  assert.match(c.getSnapshot().message, /联系负责人.*核验/);
  assert.equal(f.records.size, 0); assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().geoCalls, 0);
  const blockedMetrics = f.metrics(); await c.retry(); await c.submit("clock_in"); await c.finish();
  assert.deepEqual(f.metrics(), blockedMetrics);
  // A successful read may enable explicit original-ID retry, not a new intent.
  f.mode("normal"); const restored = f.create(); await restored.initialize();
  assert.equal(restored.getSnapshot().phase, "unconfirmed"); assert.equal(f.storage.getItem(c.storageKey), pending);
  f.mode(rejection); await restored.retry("not_provided");
  assert.equal(restored.getSnapshot().phase, "blocked");
  assert.deepEqual(JSON.parse(f.storage.getItem(c.storageKey)!), JSON.parse(pending));
  assert.equal(restored.getSnapshot().result, null); assert.equal(restored.getSnapshot().confirmed, null);
  assert.equal(f.records.size, 0); assert.equal(f.metrics().posts, 2); assert.equal(f.metrics().geoCalls, 0);
  f.mode("normal"); await restored.refresh(); await restored.retry("not_provided");
  assert.equal(restored.getSnapshot().confirmed?.receipt?.operationId, id(30));
  assert.equal(f.memory.size, 0); assert.equal(f.records.size, 1); assert.equal(f.metrics().posts, 3);
});

for (const rejection of ["read_identity_reject", "read_worker_changed"]) test(`${rejection} blocks recovery across outage and remount without losing the original receipt ID`, async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("lost"); await c.submit("clock_in", "not_provided");
  const pending = f.storage.getItem(c.storageKey); assert.ok(pending);
  f.mode(rejection); await c.refresh();
  assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(f.storage.getItem(c.storageKey), pending);
  assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().confirmed, null);
  assert.match(c.getSnapshot().message, /联系负责人.*核验/);
  const blockedMetrics = f.metrics(); await c.retry(); assert.deepEqual(f.metrics(), blockedMetrics);
  f.mode("offline"); await c.refresh(); assert.equal(c.getSnapshot().phase, "unconfirmed");
  f.mode(rejection); const beforeRetry = f.metrics(); await c.retry();
  assert.equal(f.metrics().reads, beforeRetry.reads + 1); assert.equal(c.getSnapshot().phase, "blocked");
  assert.equal(f.storage.getItem(c.storageKey), pending); assert.equal(f.metrics().geoCalls, 0); assert.equal(f.metrics().posts, 1);
  c.pause(); const restored = f.create(); await restored.initialize();
  assert.equal(restored.getSnapshot().phase, "blocked"); assert.equal(f.storage.getItem(c.storageKey), pending);
  // Once ownership can be verified, GET alone recovers the already-committed receipt.
  f.mode("normal"); await restored.refresh();
  assert.equal(restored.getSnapshot().phase, "ready"); assert.equal(restored.getSnapshot().confirmed?.receipt?.operationId, id(30));
  assert.equal(f.memory.size, 0); assert.equal(f.records.size, 1); assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().geoCalls, 0);
});

test("identity refusal without pending clears a previously confirmed display without creating a new operation", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.submit("clock_in", "not_provided");
  assert.ok(c.getSnapshot().confirmed?.receipt); f.mode("read_identity_reject"); await c.refresh();
  assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().pending, null);
  assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().confirmed, null); assert.equal(f.memory.size, 0);
  await c.submit("clock_out"); await c.finish();
  assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().geoCalls, 0);
});

test("disabled channel, wrong action and read-only identity cannot request GPS or submit", async () => {
  for (const mode of ["channel", "module", "readonly", "wrong_action"] as const) {
    const f = fixture(), c = f.create({ canClock: mode !== "readonly" }); if (mode === "channel") f.channel(false); if (mode === "module") f.module(false);
    await c.initialize(); await c.submit(mode === "wrong_action" ? "clock_out" : "clock_in"); assert.equal(f.metrics().geoCalls, 0); assert.equal(f.metrics().posts, 0);
  }
});
test("paused platform still permits explicit close with review fallback", async () => {
  const f = fixture(), c = f.create({ randomId: (() => { let n = 30; return () => id(n++); })() });
  await c.initialize(); await c.submit("clock_in", "not_provided"); f.module(false); await c.refresh(); await c.submit("clock_out", "unsupported");
  assert.equal(f.metrics().posts, 2); assert.equal(c.getSnapshot().confirmed?.receipt?.action, "clock_out"); assert.equal(c.getSnapshot().confirmed?.locationResult?.needsReview, true);
});
test("stale/wrong employee response clears successful display and triggers no new GPS", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("bad_read"); await c.submit("clock_in");
  assert.equal(c.getSnapshot().result, null); assert.equal(f.metrics().geoCalls, 0); assert.equal(f.metrics().posts, 0);
});
test("storage failure and another instance's pending ID are never overwritten to enable a punch", async () => {
  const f = fixture(), c = f.create({ storage: () => ({ ...f.storage, setItem() { throw Error("full"); } }) });
  await c.initialize(); await c.submit("clock_in", "not_provided"); assert.equal(f.metrics().posts, 0);
  const second = f.create(); await second.initialize();
  const pending = { version: 1, siteId, employeeId, intent: { expectedWorkerId: workerId, operationId: id(99), action: "clock_in", locationId, expectedSequence: 0, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false } };
  const key = attendanceLocationClockPendingKey(siteId, employeeId); f.storage.setItem(key, JSON.stringify(pending));
  await second.submit("clock_in", "not_provided"); assert.equal(JSON.parse(f.storage.getItem(key)!).intent.operationId, id(99)); assert.equal(f.metrics().posts, 0);
});
test("persistent intent parser rejects mixed identity, coords, new/unknown fields and oversized data", () => {
  const p = { version: 1, siteId, employeeId, intent: { expectedWorkerId: workerId, operationId: id(30), action: "clock_in", locationId, expectedSequence: 0, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false } };
  assert.deepEqual(parseAttendanceLocationClockPending(JSON.stringify(p), siteId, employeeId), p);
  for (const extra of [{ employeeId: id(9) }, { siteId: "99990002" }, { version: 2 }, { position: {} }, { intent: { ...p.intent, latitude: 0 } }])
    assert.throws(() => parseAttendanceLocationClockPending(JSON.stringify({ ...p, ...extra }), siteId, employeeId));
  assert.throws(() => parseAttendanceLocationClockPending("x".repeat(2049), siteId, employeeId));
});
