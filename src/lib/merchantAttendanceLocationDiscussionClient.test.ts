import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceDiscussionClient } from "./merchantAttendanceLocationDiscussionClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { createDiscussionFixture, discussionSite as siteId, discussionEmployee as actorId, discussionOwner, discussionEvent as eventId, discussionId as id, discussionListQuery as list } from "../../scripts/fixtures/attendance-location-discussion-model";
function setup(access: "self" | "owner" = "self") {
  const f = createDiscussionFixture(), memory = new Map<string, string>(); let serial = 10;
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  const create = (patch: Partial<ConstructorParameters<typeof AttendanceDiscussionClient>[0]> = {}) => new AttendanceDiscussionClient({ siteId, actorId: access === "self" ? actorId : discussionOwner, access, apiFetch: f.apiFetch, storage: () => storage, randomId: () => id(serial++), timeoutMs: 20, ...patch });
  const c = create(), open = async () => { await c.initialize(); await c.load(list(access)); await c.select(eventId); assert.equal(c.getSnapshot().phase, "ready"); };
  return { ...f, c, create, open, memory, storage };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
test("discussion constructor and empty initialization are inert; normal write has a receipt", async () => {
  const f = setup(); assert.equal(f.calls.length, 0); await f.c.initialize(); assert.equal(f.calls.length, 0); await f.open(); await f.c.submit("Explanation");
  assert.equal(f.writes(), 1); assert.equal(f.c.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.c.getSnapshot().detail?.receipt?.note, "Explanation");
});
test("owner public reply is separate; attendance pause does not disable existing-case correspondence", async () => {
  const f = setup("owner"); f.enabled(false); await f.open(); await f.c.submit("Public reply"); assert.equal(f.c.getSnapshot().detail?.item.lastAuthor, "owner"); assert.equal(f.c.getSnapshot().detail?.moduleEnabled, false);
});
test("lost success resumes with GET only, including after remount", async () => {
  const f = setup(); await f.open(); f.mode("lost"); await f.c.submit("Explanation"); assert.ok(f.c.getSnapshot().pending); const n = f.calls.length;
  const again = f.create(); await again.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(again.getSnapshot().pending, null); assert.equal(f.writes(), 1);
});
test("unsent write needs explicit same-ID retry after successful lookup", async () => {
  const f = setup(); await f.open(); f.mode("unsent"); await f.c.submit("Explanation"); const original = f.calls.at(-1)!.body;
  f.mode("normal"); const n = f.calls.length; await f.c.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET", "POST"]); assert.equal(f.calls.at(-1)!.body, original); assert.equal(f.writes(), 1);
});
test("failed lookup, worker rebind or revoked identity never resends nor drops unknown intent", async () => {
  for (const mode of ["denied", "rebound", "offline", "wrong_actor", "wrong_site", "timeout"]) {
    const f = setup(); await f.open(); f.mode("unsent"); await f.c.submit("Original"); f.mode(mode); const n = f.calls.length; await f.c.retry();
    assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.ok(f.c.getSnapshot().pending); assert.equal(f.c.getSnapshot().detail, null);
  }
});
test("concurrent newer message fences an old unsent operation without silently sending it", async () => {
  const f = setup(); await f.open(); f.mode("unsent"); await f.c.submit("Old"); f.history.push({ revision: 1, author: "owner", note: "New reply", recordedAt: "2026-09-30T11:00:00.000001Z" });
  f.mode("normal"); await f.c.retry(); assert.equal(f.c.getSnapshot().pending, null); assert.equal(f.writes(), 0); assert.match(f.c.getSnapshot().message, /原操作未写入/);
});
test("first definitive refusal may clear; rejection after uncertain retry preserves original intent", async () => {
  const f = setup(); await f.open(); f.mode("reject"); await f.c.submit("Refused"); assert.equal(f.c.getSnapshot().pending, null);
  f.mode("normal"); await f.c.initialize(); f.mode("unsent"); await f.c.submit("Unknown"); f.mode("reject"); await f.c.retry(); assert.ok(f.c.getSnapshot().pending);
});
test("hidden view clears personal data, ignores late response and never retries automatically", async () => {
  const f = setup(); await f.open(); f.mode("post_timeout"); const p = f.c.submit("Explanation"); await new Promise(r => setImmediate(r)); f.c.pause(); await p;
  assert.equal(f.c.getSnapshot().detail, null); assert.equal(f.c.getSnapshot().list, null); assert.ok(f.c.getSnapshot().pending);
  const n = f.calls.length; await f.c.retry(); assert.equal(f.calls.length, n); f.mode("normal"); await f.c.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
});
for (const delayedMethod of ["POST", "GET"] as const) {
  test(`resolvable late discussion ${delayedMethod} success cannot clear pending across pause, denied remount and original-ID recovery`, { timeout: 5000 }, async () => {
    const f = setup(), held = deferred<Response>(), release = deferred<void>();
    let armed = false, returned = 0;
    const observed = { signal: null as AbortSignal | null };
    const apiFetch: AttendanceApiFetch = async (url, init) => {
      const delay = armed && (init?.method ?? "GET") === delayedMethod;
      if (delay) armed = false;
      const response = await f.apiFetch(url, init);
      if (delay) {
        observed.signal = init?.signal ?? null;
        held.resolve(response);
        // Do not reject on abort: explicitly deliver the committed success
        // after the component-equivalent pause and replacement client's GET403.
        await release.promise;
        returned++;
      }
      return response;
    };
    const old = f.create({ apiFetch, timeoutMs: 2000 });
    let current: AttendanceDiscussionClient | undefined;
    let waiting: Promise<void> | undefined;
    const staleStates: ReturnType<typeof old.getSnapshot>[] = [];
    let unsubscribe = () => {};
    try {
      await old.initialize(); await old.load(list()); await old.select(eventId);
      if (delayedMethod === "GET") {
        f.mode("lost"); await old.submit("Original employee explanation"); f.mode("normal");
      }
      armed = true;
      waiting = delayedMethod === "POST" ? old.submit("Original employee explanation") : old.initialize();
      const response = await held.promise;
      assert.equal(response.status, 200); assert.equal(f.writes(), 1);
      const raw = f.memory.get(old.storageKey); assert.ok(raw);
      const intent = JSON.parse(raw), operationId = intent.command.operationId;
      assert.equal(f.detail("self", operationId).receipt?.note, intent.command.note);
      assert.equal(f.detail("self", operationId).receipt?.operationId, operationId);
      unsubscribe = old.subscribe(() => staleStates.push(old.getSnapshot()));
      old.pause(); await waiting;
      assert.equal(observed.signal?.aborted, true);
      assert.equal(old.getSnapshot().detail, null); assert.equal(old.getSnapshot().list, null);
      assert.equal(old.getSnapshot().phase, "unconfirmed"); assert.equal(f.memory.get(old.storageKey), raw);

      f.mode("denied"); const afterCommit = f.calls.length;
      current = f.create({ apiFetch, timeoutMs: 2000 }); await current.initialize();
      assert.equal(current.getSnapshot().detail, null); assert.equal(current.getSnapshot().list, null);
      assert.equal(current.getSnapshot().phase, "unconfirmed");
      assert.equal(current.getSnapshot().pending?.command.operationId, operationId);
      assert.equal(f.memory.get(old.storageKey), raw);
      release.resolve(); await new Promise<void>(done => setImmediate(done));
      assert.equal(returned, 1, "the successful old response really resolved after pause");
      assert(staleStates.length > 0);
      assert(staleStates.every(state => state.detail === null && state.list === null && state.pending?.command.operationId === operationId));
      assert.equal(old.getSnapshot().detail, null); assert.equal(current.getSnapshot().detail, null);
      assert.equal(f.memory.get(old.storageKey), raw, "late success must not delete another generation's recovery intent");

      f.mode("normal"); await current.initialize();
      assert.equal(current.getSnapshot().detail?.receipt?.operationId, operationId);
      assert.equal(current.getSnapshot().detail?.receipt?.note, intent.command.note);
      assert.equal(current.getSnapshot().phase, "ready"); assert.equal(current.getSnapshot().pending, null);
      assert.equal(f.memory.get(old.storageKey), undefined);
      assert.deepEqual(f.calls.slice(afterCommit).map(call => call.method), ["GET", "GET"]);
      for (const call of f.calls.slice(afterCommit)) {
        const params = new URL(call.url, "https://local.invalid").searchParams;
        assert.equal(params.get("operationId"), operationId); assert.equal(params.get("eventId"), eventId);
        assert.equal(params.get("expectedWorkerId"), intent.query.expectedWorkerId); assert.equal(params.get("access"), "self");
      }
      assert.equal(f.calls.filter(call => call.method === "POST").length, 1); assert.equal(f.writes(), 1);
    } finally {
      release.resolve(); old.pause(); current?.pause(); unsubscribe(); await waiting;
    }
  });
}
test("pending submission blocks double-click, another case and a new list", async () => {
  const f = setup(); await f.open(); f.mode("post_timeout"); await Promise.all([f.c.submit("A"), f.c.submit("B")]); await f.c.load(list()); await f.c.select(id(99));
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1); assert.equal(f.c.getSnapshot().query?.mode, "detail");
});
test("storage failure forbids POST; competing pending intent is never deleted", async () => {
  const f = setup(), bad = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("blocked"); } }) });
  await bad.initialize(); await bad.load(list()); await bad.select(eventId); await bad.submit("A"); assert.equal(f.writes(), 0);
  await f.open(); f.mode("unsent"); await f.c.submit("B"); const p = JSON.parse(f.memory.get(f.c.storageKey)!); p.command.operationId = id(99); f.memory.set(f.c.storageKey, JSON.stringify(p));
  const n = f.calls.length; await f.c.retry(); assert.equal(f.calls.length, n); assert.equal(JSON.parse(f.memory.get(f.c.storageKey)!).command.operationId, id(99));
});
test("malformed persisted intent, extra command identity and self-view-only block new writes", async () => {
  const f = setup(); f.memory.set(f.c.storageKey, "{broken"); await f.c.initialize(); assert.equal(f.c.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0);
  f.memory.clear(); f.canPost(false); await f.open(); await f.c.submit("No"); assert.equal(f.writes(), 0);
  f.canPost(true); await f.open(); f.mode("unsent"); await f.c.submit("Unknown");
  const saved = JSON.parse(f.memory.get(f.c.storageKey)!); saved.command.siteId = "99990002"; f.memory.set(f.c.storageKey, JSON.stringify(saved));
  const remount = f.create(), n = f.calls.length; await remount.initialize(); assert.equal(remount.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, n);
});
test("sparse anomaly batches retain scanned cursor and current worker pin", async () => {
  const f = setup(); f.mode("empty_page"); await f.c.load(list()); assert.equal(f.c.getSnapshot().list?.items.length, 0); assert.ok(f.c.getSnapshot().list?.nextCursor);
  await f.c.next(); assert.equal(f.c.getSnapshot().list?.items.length, 1); assert.match(f.calls.at(-1)!.url, /expectedWorkerId=/); assert.match(f.calls.at(-1)!.url, /000001Z/);
});
test("failed refresh and stale actor cannot leave previous employee information visible", async () => {
  for (const mode of ["wrong_actor", "wrong_site", "denied"]) { const f = setup(); await f.c.load(list()); f.mode(mode); await f.c.load(list()); assert.equal(f.c.getSnapshot().list, null); assert.equal(f.c.getSnapshot().phase, "blocked"); }
});
