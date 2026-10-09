// Synthetic HTTP/storage only. This does not execute SQL, real Auth or a UI.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AttendanceDayReviewAttempt } from "./merchantAttendanceDayReviewClient";
import { DAY_REVIEW_API, DAY_REVIEW_PROTOCOL, DAY_REVIEW_RESPONSE_LIMIT, dayReviewCommandFingerprintText,
  type DayReviewDecideCommand, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { dayReviewPendingKey } from "./merchantAttendanceDayReviewRecovery";
const id = (n: number) => `19900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990199", actorId = id(1), member = id(2);
const query = (): DayReviewQuery => ({ siteId, access: "owner", mode: "preview", workerId: id(3), workDate: "2026-10-07", slotId: null, caseId: null });
const command = (): DayReviewDecideCommand => ({ action: "decide", operationId: id(10), caseId: id(11), expectedRevision: 0,
  workerId: id(3), employeeId: id(4), employeeAuthUserId: member, expectedFingerprint: "a".repeat(64), outcome: "follow_up",
  calendarReference: null, selfStatementOperationId: null, reason: "继续核查，不推定旷工或工时" });
const key = dayReviewPendingKey(siteId, "owner", actorId);
function storage() { const items = new Map<string, string>(); return { items,
  getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); }, removeItem: (k: string) => { items.delete(k); } }; }
function receipt(q = query(), c = command(), replayed = false) { return { protocol: DAY_REVIEW_PROTOCOL, siteId, actorId, readAt: "2026-10-08T12:00:01.123456Z",
  kind: "receipt", replayed, receipt: { operationId: c.operationId, caseId: c.caseId, revision: 1, action: c.action, actorId,
    recordedAt: "2026-10-08T12:00:00.123456Z", commandFingerprint: createHash("sha256").update(dayReviewCommandFingerprintText(q, actorId, c)).digest("hex") } }; }
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });

test("C15-A one explicit POST is durably staged first; even success clears only after explicit original GET", async () => {
  const store = storage(), calls: string[] = [];
  const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store,
    apiFetch: async (url, init) => { calls.push(String(init?.method)); assert(store.items.has(key));
      if (init?.method === "POST") { assert.equal(url, DAY_REVIEW_API); assert.deepEqual(JSON.parse(String(init.body)), { query: query(), command: command() }); return response(receipt()); }
      assert.match(String(url), /mode=recover/); assert.doesNotMatch(String(url), /access=|workerId=/); return response(receipt(query(), command(), true)); } });
  assert.equal(await attempt.load(), null); assert.deepEqual(calls, []);
  assert.equal((await attempt.post(query(), command())).kind, "receipt"); assert.deepEqual(calls, ["POST"]); assert(store.items.has(key));
  await assert.rejects(attempt.post(query(), command())); assert.deepEqual(calls, ["POST"]);
  assert.equal((await attempt.recover()).kind, "receipt"); assert.deepEqual(calls, ["POST", "GET"]); assert.equal(store.getItem(key), null);
});

test("C15-A stage snapshots before crypto; storage failure or a damaged pending number forbids POST", async () => {
  const store = storage(); let requests = 0;
  const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store, apiFetch: async () => { requests++; return response(receipt()); } });
  const q = query(), c = command(), pending = attempt.post(q, c); Object.assign(c, { reason: "too late mutation" });
  await pending; assert.equal(requests, 1); assert.equal(JSON.parse(store.getItem(key)!).command.reason, command().reason);
  store.setItem(key, "damaged original bytes"); await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 1);
  assert.equal(store.getItem(key), "damaged original bytes");
  const throwing = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => ({ ...store, setItem() { throw Error("quota"); } }),
    apiFetch: async () => { requests++; return response(receipt()); } });
  store.removeItem(key); await assert.rejects(throwing.post(query(), command())); assert.equal(requests, 1);
});

test("C15-A malformed, redirected, oversized or foreign replies retain the original and never retry", async () => {
  const bad = [() => new Response("oops", { status: 503 }), () => new Response("{\"ok\":true,\"ok\":true}", { headers: { "Content-Type": "application/json" } }),
    () => response({ ...receipt(), actorId: member }), () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    () => new Response(" ".repeat(DAY_REVIEW_RESPONSE_LIMIT + 1), { headers: { "Content-Type": "application/json" } }),
    () => new Response(JSON.stringify({ ok: true, data: receipt() }), { headers: { "Content-Type": "text/html" } })];
  for (const reply of bad) { const store = storage(); let requests = 0;
    const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store,
      apiFetch: async () => { requests++; return reply(); } });
    await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 1); assert(store.items.has(key));
    await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 1);
    assert.equal((await attempt.load())?.command.operationId, command().operationId);
  }
});

test("C15-A scope changes before durable staging or late POST response cannot cause a new write or clear intent", async () => {
  const store = storage(); let active = true, requests = 0;
  const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store, isCurrent: () => active,
    apiFetch: async () => { requests++; active = false; return response(receipt()); } });
  active = false; await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 0); assert.equal(store.getItem(key), null);
  active = true; await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 1); assert(store.items.has(key));
  active = true; assert.equal((await attempt.load())?.command.operationId, command().operationId);
});

test("C15-A pause aborts a pending POST; timeout has no automatic retry and preserves the number", async () => {
  for (const paused of [true, false]) {
    const store = storage(); let started!: () => void, requestSignal: AbortSignal | null = null, requests = 0;
    const start = new Promise<void>(resolve => { started = resolve; });
    const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store, timeoutMs: 100,
      apiFetch: async (_url, init) => { requests++; requestSignal = init?.signal ?? null; started(); return new Promise<Response>(() => {}); } });
    const pending = attempt.post(query(), command()); await start; if (paused) attempt.pause();
    await assert.rejects(pending); assert.equal(requests, 1); assert(store.items.has(key));
    assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
    await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 1);
  }
});

test("C15-A two simultaneous explicit actions cannot race the same pending slot", async () => {
  const store = storage(); let release!: (response: Response) => void, started!: () => void, requests = 0;
  const start = new Promise<void>(resolve => { started = resolve; });
  const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store,
    apiFetch: async () => { requests++; started(); return new Promise<Response>(resolve => { release = resolve; }); } });
  const first = attempt.post(query(), command()); await start;
  await assert.rejects(attempt.post(query(), command())); await assert.rejects(attempt.load()); await assert.rejects(attempt.recover());
  release(response(receipt())); await first; assert.equal(requests, 1); assert(store.items.has(key));
});

test("C15-A a replaced pending slot rejects the late POST result without deleting the replacement", async () => {
  const store = storage(); let requests = 0;
  const attempt = new AttendanceDayReviewAttempt({ siteId, actorId, access: "owner", storage: () => store,
    apiFetch: async () => { requests++; store.setItem(key, "different original number"); return response(receipt()); } });
  await assert.rejects(attempt.post(query(), command())); assert.equal(requests, 1);
  assert.equal(store.getItem(key), "different original number");
  await assert.rejects(attempt.recover()); assert.equal(requests, 1); assert.equal(store.getItem(key), "different original number");
});
