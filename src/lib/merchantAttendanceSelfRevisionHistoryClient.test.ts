import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceSelfRevisionHistoryClient } from "./merchantAttendanceSelfRevisionHistoryClient";
import type { SelfRevisionHistoryResult } from "./merchantAttendanceSelfRevisionHistory";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { RevisionHistoryStatus } from "./merchantAttendanceRevisionHistory";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { siteId: "99990001", employeeId: id(20), workerId: id(30) };
const asOf = "2026-10-03T12:00:00.000001Z", submittedAt = "2026-10-03T10:00:00.123456Z";
function wire(count = 1, first = 200): SelfRevisionHistoryResult & { ok: true; moduleEnabled: boolean } {
  return { ok: true, moduleEnabled: true, protocol: "self-revision-history-v1", readOnly: true, ...identity, asOf, scanned: count,
    items: Array.from({ length: count }, (_, index) => ({ requestId: id(first - index), rootRequestId: id(900 + index % 2),
      workerId: identity.workerId, employeeId: identity.employeeId, workerName: "合成员工", workerNo: "SELF-REVISION",
      submittedRevision: index + 1, submittedAt, proposedStartAt: "2026-10-03T08:00:00.123456Z", proposedEndAt: "2026-10-03T09:00:00.123456Z",
      status: "submitted", closedAt: null, decisionOperationId: null })),
    nextCursor: count === 50 ? { recordedAt: submittedAt, requestId: id(first - 49) } : null };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const contextBody = () => ({ ok: true, moduleEnabled: false, ...identity, locationId: id(90) });
function setup(reply: AttendanceApiFetch = async () => json(wire()), timeoutMs?: number, contextReply: AttendanceApiFetch = async () => json(contextBody())) {
  const calls: { path: string; init?: RequestInit }[] = [], contextCalls: typeof calls = [];
  const client = new AttendanceSelfRevisionHistoryClient({ siteId: identity.siteId, employeeId: identity.employeeId, timeoutMs,
    apiFetch: async (path, init) => {
      if (path.startsWith("/api/merchant-enterprise/attendance/corrections/context?")) { contextCalls.push({ path, init }); return contextReply(path, init); }
      calls.push({ path, init }); return reply(path, init);
    } });
  return { client, calls, contextCalls };
}
async function reached(check: () => boolean) { for (let n = 0; n < 100 && !check(); n++) await Promise.resolve(); assert(check(), "expected request was not reached"); }
const params = (path: string) => Object.fromEntries(new URL(path, "https://example.test").searchParams);

test("constructor and next are inert; explicit GET returns multiple own roots and preserves microseconds", async () => {
  const h = setup(async () => json(wire(2))), states: string[] = [], unsubscribe = h.client.subscribe(() => states.push(h.client.getSnapshot().phase));
  await h.client.next(); assert.equal(h.calls.length, 0); assert.equal(h.contextCalls.length, 0); assert.equal(h.client.getSnapshot().phase, "idle");
  await h.client.begin(); const call = h.calls[0];
  assert.deepEqual(params(h.contextCalls[0].path), { siteId: identity.siteId }); assert.equal(h.contextCalls[0].init?.method, "GET");
  assert.equal(new URL(call.path, "https://example.test").pathname, "/api/merchant-enterprise/attendance/self-revision-history");
  assert.deepEqual(params(call.path), { siteId: identity.siteId, expectedWorkerId: identity.workerId, status: "all" });
  assert.equal(call.init?.method, "GET"); assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.body, undefined);
  assert.equal(h.client.getSnapshot().result?.items[0].submittedAt, submittedAt);
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.rootRequestId), [id(900), id(901)]);
  assert.equal(h.client.getSnapshot().page, 1); unsubscribe(); const n = states.length; h.client.pause(); assert.equal(states.length, n);
});

test("next replaces the page with an exact fixed-asOf dual-key cursor; new status explicitly restarts at the first page", async () => {
  let index = 0;
  const h = setup(async () => json(index++ === 0 ? wire(50) : index === 2 ? wire(11, 150) : wire(0)));
  await h.client.begin(); await h.client.next();
  assert.equal(h.contextCalls.length, 1);
  assert.deepEqual(params(h.calls[1].path), { siteId: identity.siteId, expectedWorkerId: identity.workerId, status: "all", asOf,
    cursorAt: submittedAt, cursorId: id(151) });
  assert.equal(h.client.getSnapshot().page, 2); assert.equal(h.client.getSnapshot().result?.items.length, 11);
  assert.equal(h.client.getSnapshot().result?.items[0].requestId, id(150)); assert.equal(h.client.getSnapshot().result?.asOf, asOf);
  await h.client.next(); assert.equal(h.calls.length, 2);
  await h.client.begin("approved"); assert.deepEqual(params(h.calls[2].path), { siteId: identity.siteId, expectedWorkerId: identity.workerId, status: "approved" });
  assert.equal(h.contextCalls.length, 2);
  assert.equal(h.client.getSnapshot().page, 1);
});

test("an empty filtered page with a cursor is not the end; explicit next reaches a separately labelled final page", async () => {
  let index = 0;
  const h = setup(async () => json(index++ === 0 ? { ...wire(50), items: [] } : wire(0)));
  await h.client.begin("approved"); assert.match(h.client.getSnapshot().message, /仍有下一页/);
  assert.equal(h.client.getSnapshot().result?.items.length, 0); assert.equal(h.calls.length, 1);
  await h.client.next(); assert.match(h.client.getSnapshot().message, /已到末页/); assert.equal(h.client.getSnapshot().result?.nextCursor, null);
  assert.equal(h.calls.length, 2);
});

test("whole-response employee substitution is refused even when all substituted row identities are internally consistent", async () => {
  const body = wire(); body.employeeId = id(21); body.items = body.items.map(item => ({ ...item, employeeId: id(21) }));
  const h = setup(async () => json(body)); await h.client.begin();
  assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
  assert.match(h.client.getSnapshot().message, /身份或权限/); assert.equal(h.client.getSnapshot().query, null);
});

test("binding/permission errors and temporary failures all clear previous rows without automatic or cursor retries", async () => {
  for (const [status, error] of [[401, "unauthorized"], [403, "attendance_access_denied"], [409, "attendance_worker_changed"],
    [429, "attendance_rate_limited"], [503, "attendance_unavailable"], [0, "private_network_error"]] as const) {
    let failing = false;
    const h = setup(async () => { if (!failing) return json(wire(50)); if (!status) throw Error(error); return json({ ok: false, error }, status); });
    await h.client.begin(); failing = true; await h.client.next();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().query, null);
    await h.client.next(); assert.equal(h.calls.length, 2); assert(!h.client.getSnapshot().message.includes("private_network_error"));
    failing = false; await h.client.begin(); assert.equal(h.client.getSnapshot().phase, "ready");
    assert.deepEqual(params(h.calls[2].path), { siteId: identity.siteId, expectedWorkerId: identity.workerId, status: "all" });
  }
});

test("strict DTO, ordering, bounded body and bounded deadline failures never retain or partially show an old page", async () => {
  const duplicate = wire(2); duplicate.items[1] = { ...duplicate.items[0] };
  for (const body of [{ ...wire(), privateReason: "private" }, { ...wire(), workerId: id(31) }, { ...wire(), siteId: "99990002" },
    { ...wire(), readOnly: false }, { ...wire(), scanned: 51 }, { ...wire(), moduleEnabled: "true" }, duplicate,
    { ...wire(), items: [...wire(2).items].reverse(), scanned: 2 }, { ...wire(), items: [{ ...wire().items[0], employeeId: id(21) }] }]) {
    let first = true;
    const h = setup(async () => { if (first) { first = false; return json(wire()); } return json(body); });
    await h.client.begin(); assert.equal(h.client.getSnapshot().phase, "ready"); await h.client.begin();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
  }
  const large = setup(async () => json({ ...wire(), privateData: "x".repeat(131073) })); await large.client.begin(); assert.equal(large.client.getSnapshot().result, null);
  const slow = setup(async () => new Promise<Response>(() => {}), 30); await slow.client.begin();
  assert.equal(slow.client.getSnapshot().phase, "blocked"); assert.equal(slow.calls[0].init?.signal?.aborted, true);
});

test("busy calls deduplicate; pause aborts and delayed success or refusal cannot alter a fresh manual result", async () => {
  for (const late of [() => json(wire()), () => json({ ok: false, error: "attendance_access_denied" }, 403)]) {
    const old = deferred<Response>(); let index = 0;
    const h = setup(async () => index++ === 0 ? old.promise : json(wire(1, 150)));
    const pending = h.client.begin(); await reached(() => h.calls.length === 1); await h.client.begin(); await h.client.next(); assert.equal(h.calls.length, 1);
    h.client.pause(); assert.equal(h.calls[0].init?.signal?.aborted, true); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().query, null);
    await h.client.begin(); old.resolve(late()); await pending;
    assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal(h.client.getSnapshot().result?.items[0].requestId, id(150));
    assert.equal(h.calls.length, 2);
  }
});

test("hidden documents do not query or accept late data; returning visible has no automatic read", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const response = deferred<Response>(), h = setup(async () => response.promise);
    await h.client.begin(); assert.equal(h.calls.length, 0); doc.hidden = false; assert.equal(h.calls.length, 0);
    const pending = h.client.begin(); await reached(() => h.calls.length === 1); doc.hidden = true; response.resolve(json(wire())); await pending;
    assert.equal(h.client.getSnapshot().result, null); doc.hidden = false; await Promise.resolve(); assert.equal(h.calls.length, 1);
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});

test("pause and view-only module state are readonly; invalid identities or statuses never send a request", async () => {
  const h = setup(async () => json({ ...wire(), moduleEnabled: false })); await h.client.begin();
  assert.equal(h.client.getSnapshot().result?.moduleEnabled, false); assert.equal(h.calls[0].init?.method, "GET"); h.client.pause();
  await h.client.begin("unknown" as RevisionHistoryStatus); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().result, null);
  for (const patch of [{ siteId: "all" }, { employeeId: "" }]) assert.throws(() =>
    new AttendanceSelfRevisionHistoryClient({ ...identity, ...patch, apiFetch: async () => { throw Error("must_not_fetch"); } }));
});

test("context is a bounded independent identity read; absent, malformed or substituted identities cannot query history", async () => {
  for (const body of [{ ...contextBody(), employeeId: id(21) }, { ...contextBody(), workerId: null },
    { ...contextBody(), siteId: "99990002" }, { ...contextBody(), privateValue: "x" }, { ...contextBody(), moduleEnabled: "false" },
    { ...contextBody(), privateValue: "x".repeat(2049) }]) {
    const h = setup(undefined, undefined, async () => json(body)); await h.client.begin();
    assert.equal(h.calls.length, 0); assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().query, null);
  }
  const denied = setup(undefined, undefined, async () => json({ ok: false, error: "attendance_access_denied" }, 403));
  await denied.client.begin(); assert.equal(denied.calls.length, 0); assert.match(denied.client.getSnapshot().message, /身份或权限/);
  const slow = setup(undefined, 5, async () => new Promise<Response>(() => {})); await slow.client.begin();
  assert.equal(slow.calls.length, 0); assert.equal(slow.contextCalls[0].init?.signal?.aborted, true);
});

test("pause discards a delayed context before history and fresh explicit begin resolves a new worker without old binding", async () => {
  const old = deferred<Response>(); let reads = 0;
  const nextWorker = id(31), nextResult = wire(); nextResult.workerId = nextWorker;
  nextResult.items = nextResult.items.map(item => ({ ...item, workerId: nextWorker }));
  const h = setup(async () => json(nextResult), undefined, async () => reads++ === 0 ? old.promise : json({ ...contextBody(), workerId: nextWorker }));
  const pending = h.client.begin(); assert.equal(h.contextCalls.length, 1); h.client.pause();
  assert.equal(h.contextCalls[0].init?.signal?.aborted, true); await h.client.begin(); old.resolve(json(contextBody())); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().result?.workerId, nextWorker);
  assert.equal(params(h.calls[0].path).expectedWorkerId, nextWorker);
});
