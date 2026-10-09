import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLocationReviewCaseClient, AttendanceLocationReviewListClient } from "./merchantAttendanceLocationReviewClient";
import type { AttendanceLocationReviewQuery } from "./merchantAttendanceLocationReview";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { createAttendanceReviewFixture, reviewFixtureEvent as eventId, reviewFixtureSite as siteId, reviewFixtureOwner as ownerId, reviewFixtureId as id } from "../../scripts/fixtures/attendance-location-review-model";
const query: Extract<AttendanceLocationReviewQuery, { mode: "list" }> = { siteId, mode: "list", fromAt: "2026-09-01T00:00:00.000000Z", toAt: "2026-10-01T00:00:00.000000Z", workerId: null, locationId: null, status: "all", asOf: null, cursorAt: null, cursorId: null };
function fixture() {
  const f = createAttendanceReviewFixture(), memory = new Map<string, string>(), storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  let operation = 20;
  const create = (extra: Partial<ConstructorParameters<typeof AttendanceLocationReviewCaseClient>[0]> = {}) => new AttendanceLocationReviewCaseClient({ siteId, ownerId, apiFetch: f.apiFetch, storage: () => storage, timeoutMs: 40, randomId: () => id(operation++), ...extra });
  const list = new AttendanceLocationReviewListClient({ siteId, apiFetch: f.apiFetch, timeoutMs: 40 });
  return { ...f, create, memory, storage, list };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
test("case constructor and empty mount are inert, detail loads only on explicit selection", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); assert.equal(f.calls.length, 0);
  await c.select(eventId); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(f.calls[0].method, "GET");
});
test("review success persists intent before write and clears after original receipt", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); await c.submit("noted", "Checked", 0);
  assert.equal(c.getSnapshot().result?.item.reviewState, "reviewed"); assert.equal(f.writes(), 1); assert.equal(f.memory.size, 0);
  await c.submit("reopen", "New information", 1); assert.equal(c.getSnapshot().result?.item.reviewState, "pending"); assert.equal(f.writes(), 2);
});
test("cannot reopen an already pending case and cannot submit blank note", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); await c.submit("reopen", "Reason", 0); assert.equal(f.writes(), 0);
  await c.initialize(); await c.submit("noted", " ", 0); assert.equal(f.writes(), 0); assert.equal(f.memory.size, 0);
});
test("lost response recovers across remount with GET only, even when new attendance is paused", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("lost"); await c.submit("follow_up", "Need clarification", 0);
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(f.writes(), 1); f.enabled(false); const n = f.calls.length;
  const restored = f.create(); await restored.initialize(); assert.deepEqual(f.calls.slice(n).map(r => r.method), ["GET"]); assert.equal(restored.getSnapshot().phase, "ready"); assert.equal(f.memory.size, 0);
});
test("explicit retry queries receipt then resends identical original payload if missing", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("unsent"); await c.submit("noted", "Checked", 0);
  const original = f.calls.at(-1)?.body; f.mode("normal"); await c.retry(); assert.deepEqual(f.calls.slice(-2).map(r => r.method), ["GET", "POST"]); assert.equal(f.calls.at(-1)?.body, original); assert.equal(f.writes(), 1);
});
test("retry after prior success never creates another annotation", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("lost"); await c.submit("noted", "Checked", 0); const n = f.calls.length;
  await c.retry(); assert.deepEqual(f.calls.slice(n).map(r => r.method), ["GET"]); assert.equal(f.writes(), 1);
});
test("failed receipt lookup cannot trigger POST or drop pending", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("unsent"); await c.submit("noted", "Checked", 0); f.mode("denied"); const n = f.calls.length;
  await c.retry(); assert.deepEqual(f.calls.slice(n).map(r => r.method), ["GET"]); assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null);
});
test("other review advancing revision fences an uncommitted old operation", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("unsent"); await c.submit("noted", "Original", 0);
  f.history.push({ revision: 1, outcome: "follow_up", note: "Another review", recordedAt: "2026-09-30T11:00:00.000001Z", actorRef: "b".repeat(32), byCurrentOwner: false });
  f.mode("normal"); await c.initialize(); assert.equal(c.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 0);
});
test("first definitive refusal may clear intent, uncertain retries preserve it", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("reject"); await c.submit("noted", "Checked", 0); assert.equal(c.getSnapshot().pending, null);
  f.mode("normal"); await c.initialize(); f.mode("unsent"); await c.submit("noted", "Checked", 0); f.mode("reject"); await c.retry(); assert.ok(c.getSnapshot().pending);
});
test("hiding after POST clears sensitive view and keeps recovery intent without further POST", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("post_timeout"); const pending = c.submit("noted", "Checked", 0);
  await new Promise(resolve => setImmediate(resolve)); c.pause(); await pending; assert.equal(c.getSnapshot().result, null); assert.ok(c.getSnapshot().pending); const n = f.calls.length;
  await c.retry(); assert.equal(f.calls.length, n); f.mode("normal"); await c.initialize(); assert.deepEqual(f.calls.slice(n).map(r => r.method), ["GET"]);
});
for (const delayedMethod of ["POST", "GET"] as const) {
  test(`resolvable late review ${delayedMethod} success cannot clear pending across pause, denied remount and original-ID recovery`, { timeout: 5000 }, async () => {
    const f = fixture(), held = deferred<Response>(), release = deferred<void>();
    let armed = false, returned = 0;
    const observed = { signal: null as AbortSignal | null };
    const apiFetch: AttendanceApiFetch = async (url, init) => {
      const delay = armed && (init?.method ?? "GET") === delayedMethod;
      if (delay) armed = false;
      const response = await f.apiFetch(url, init);
      if (delay) {
        observed.signal = init?.signal ?? null;
        held.resolve(response);
        // Intentionally ignore abort: the real successful response must settle
        // after the old client has been paused, unlike the timeout fixture.
        await release.promise;
        returned++;
      }
      return response;
    };
    const old = f.create({ apiFetch, timeoutMs: 2000 });
    let current: AttendanceLocationReviewCaseClient | undefined;
    let waiting: Promise<void> | undefined;
    const staleStates: ReturnType<typeof old.getSnapshot>[] = [];
    let unsubscribe = () => {};
    try {
      await old.initialize(); await old.select(eventId);
      if (delayedMethod === "GET") {
        f.mode("lost"); await old.submit("follow_up", "Original private review", 0); f.mode("normal");
      }
      armed = true;
      waiting = delayedMethod === "POST" ? old.submit("follow_up", "Original private review", 0) : old.initialize();
      const response = await held.promise;
      assert.equal(response.status, 200); assert.equal(f.writes(), 1);
      const raw = f.memory.get(old.storageKey); assert.ok(raw);
      const intent = JSON.parse(raw), operationId = intent.command.operationId;
      assert.equal(f.detail(operationId).receipt?.note, intent.command.note);
      assert.equal(f.detail(operationId).receipt?.operationId, operationId);
      unsubscribe = old.subscribe(() => staleStates.push(old.getSnapshot()));
      old.pause(); await waiting;
      assert.equal(observed.signal?.aborted, true);
      assert.equal(old.getSnapshot().result, null); assert.equal(old.getSnapshot().phase, "unconfirmed");
      assert.equal(f.memory.get(old.storageKey), raw);

      // A replacement client models re-entry after unmount. A genuine typed
      // GET403 must preserve the same committed-but-unconfirmed operation.
      f.mode("denied"); const afterCommit = f.calls.length;
      current = f.create({ apiFetch, timeoutMs: 2000 }); await current.initialize();
      assert.equal(current.getSnapshot().result, null); assert.equal(current.getSnapshot().phase, "unconfirmed");
      assert.equal(current.getSnapshot().pending?.command.operationId, operationId);
      assert.equal(f.memory.get(old.storageKey), raw);
      release.resolve(); await new Promise<void>(done => setImmediate(done));
      assert.equal(returned, 1, "the successful old response really resolved after pause");
      assert(staleStates.length > 0);
      assert(staleStates.every(state => state.result === null && state.pending?.command.operationId === operationId));
      assert.equal(old.getSnapshot().result, null); assert.equal(current.getSnapshot().result, null);
      assert.equal(f.memory.get(old.storageKey), raw, "late success must not delete another generation's recovery intent");

      f.mode("normal"); await current.initialize();
      assert.equal(current.getSnapshot().result?.receipt?.operationId, operationId);
      assert.equal(current.getSnapshot().result?.receipt?.note, intent.command.note);
      assert.equal(current.getSnapshot().phase, "ready"); assert.equal(current.getSnapshot().pending, null);
      assert.equal(f.memory.get(old.storageKey), undefined);
      assert.deepEqual(f.calls.slice(afterCommit).map(call => call.method), ["GET", "GET"]);
      for (const call of f.calls.slice(afterCommit)) {
        const params = new URL(call.url, "https://local.invalid").searchParams;
        assert.equal(params.get("operationId"), operationId); assert.equal(params.get("eventId"), eventId);
      }
      assert.equal(f.calls.filter(call => call.method === "POST").length, 1); assert.equal(f.writes(), 1);
    } finally {
      release.resolve(); old.pause(); current?.pause(); unsubscribe(); await waiting;
    }
  });
}
test("unknown write cannot switch cases, start a new operation or double-submit", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); f.mode("post_timeout"); await Promise.all([c.submit("noted", "Checked", 0), c.submit("follow_up", "Other", 0)]);
  await c.select(id(99)); assert.equal(c.getSnapshot().eventId, eventId); assert.equal(f.calls.filter(r => r.method === "POST").length, 1);
});
test("storage unavailable or overwritten intent prevents write and cannot delete a competing operation", async () => {
  const f = fixture(), bad = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("blocked"); } }) }); await bad.initialize(); await bad.select(eventId); await bad.submit("noted", "Checked", 0); assert.equal(f.writes(), 0);
  const c = f.create(); await c.initialize(); await c.select(eventId); f.mode("unsent"); await c.submit("noted", "Checked", 0);
  const other = JSON.parse(f.memory.get(c.storageKey)!); other.command.operationId = id(999); f.memory.set(c.storageKey, JSON.stringify(other)); const n = f.calls.length;
  await c.retry(); assert.equal(f.calls.length, n); assert.equal(JSON.parse(f.memory.get(c.storageKey)!).command.operationId, id(999));
});
test("new-attendance pause does not block current owner's existing-case review", async () => {
  const f = fixture(), c = f.create(); f.enabled(false); await c.initialize(); await c.select(eventId); await c.submit("noted", "Reviewed while paused", 0);
  assert.equal(f.writes(), 1); assert.equal(c.getSnapshot().result?.moduleEnabled, false);
});
test("list can advance through empty matching batch and keeps exact cursor", async () => {
  const f = fixture(); f.mode("empty_page"); await f.list.load(query); assert.equal(f.list.getSnapshot().result?.items.length, 0); assert.ok(f.list.getSnapshot().result?.nextCursor);
  await f.list.next(); assert.equal(f.list.getSnapshot().result?.items.length, 1); assert.match(f.calls.at(-1)!.url, /cursorAt=2026-09-30T10%3A30%3A00.000001Z/);
});
test("list cancellation, timeout, wrong tenant and denial cannot retain old employee data", async () => {
  const f = fixture(); await f.list.load(query); f.list.invalidate(); assert.equal(f.list.getSnapshot().result, null);
  for (const mode of ["timeout", "wrong_site", "denied"]) { f.mode(mode); await f.list.load(query); assert.equal(f.list.getSnapshot().phase, "blocked"); assert.equal(f.list.getSnapshot().result, null); }
  assert.equal(f.calls.filter(r => r.method === "POST").length, 0);
});
test("explicit selection can reauthorize after a cleared view without resuming a write", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.select(eventId); c.pause(); assert.equal(c.getSnapshot().result, null);
  await c.select(eventId); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(f.calls.filter(r => r.method === "POST").length, 0);
});
