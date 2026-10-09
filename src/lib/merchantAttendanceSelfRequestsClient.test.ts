import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceSelfRequestsClient } from "./merchantAttendanceSelfRequestsClient";
import type { SelfRequestKind, SelfRequestStatus, SelfRequestsResult } from "./merchantAttendanceSelfRequests";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { siteId: "99990001", employeeId: id(20), workerId: id(30) };
const asOf = "2026-10-03T12:00:00.000001Z";
const submittedAt = "2026-10-03T10:00:00.123456Z";
type Wire = SelfRequestsResult & { ok: true; moduleEnabled: boolean };

function wire(count = 1, first = 200, status: SelfRequestStatus = "submitted"): Wire {
  return {
    ok: true,
    moduleEnabled: true,
    protocol: "self-requests-v1",
    readOnly: true,
    ...identity,
    asOf,
    scanned: count,
    items: Array.from({ length: count }, (_, index) => {
      const requestId = id(first - index);
      return {
        kind: "correction" as const,
        requestId,
        rootRequestId: requestId,
        workerId: identity.workerId,
        employeeId: identity.employeeId,
        workerName: "合成员工",
        workerNo: "SELF-REQUESTS",
        submittedAt,
        proposedStartAt: "2026-10-03T08:00:00.123456Z",
        proposedEndAt: "2026-10-03T09:00:00.123456Z",
        status,
        closedAt: status === "submitted" ? null : "2026-10-03T11:00:00.123456Z",
      };
    }),
    nextCursor: count === 50 ? { recordedAt: submittedAt, kind: "correction", requestId: id(first - 49) } : null,
  };
}

function threeKinds(): Wire {
  const base = wire().items[0];
  return {
    ...wire(3),
    items: [
      { ...base, kind: "missing", requestId: id(500), rootRequestId: id(500) },
      { ...base, kind: "revision", requestId: id(400), rootRequestId: id(900) },
      { ...base, kind: "correction", requestId: id(300), rootRequestId: id(300) },
    ],
    nextCursor: null,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const contextBody = () => ({ ok: true, moduleEnabled: false, ...identity, locationId: id(90) });
function setup(
  reply: AttendanceApiFetch = async () => json(wire()),
  timeoutMs?: number,
  contextReply: AttendanceApiFetch = async () => json(contextBody()),
) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const contextCalls: typeof calls = [];
  const client = new AttendanceSelfRequestsClient({
    siteId: identity.siteId,
    employeeId: identity.employeeId,
    timeoutMs,
    apiFetch: async (path, init) => {
      if (path.startsWith("/api/merchant-enterprise/attendance/corrections/context?")) {
        contextCalls.push({ path, init });
        return contextReply(path, init);
      }
      calls.push({ path, init });
      return reply(path, init);
    },
  });
  return { client, calls, contextCalls };
}
async function reached(check: () => boolean) {
  for (let n = 0; n < 100 && !check(); n++) await Promise.resolve();
  assert(check(), "expected request was not reached");
}
const params = (path: string) => Object.fromEntries(new URL(path, "https://example.test").searchParams);

test("constructor and next are inert; an explicit identity-bound GET accepts all three kinds", async () => {
  const h = setup(async () => json(threeKinds()));
  const states: string[] = [];
  const unsubscribe = h.client.subscribe(() => states.push(h.client.getSnapshot().phase));
  await h.client.next();
  assert.equal(h.calls.length, 0);
  assert.equal(h.contextCalls.length, 0);
  await h.client.begin();
  assert.deepEqual(params(h.contextCalls[0].path), { siteId: identity.siteId });
  assert.equal(h.contextCalls[0].init?.method, "GET");
  assert.equal(new URL(h.calls[0].path, "https://example.test").pathname, "/api/merchant-enterprise/attendance/self-requests");
  assert.deepEqual(params(h.calls[0].path), {
    siteId: identity.siteId,
    expectedEmployeeId: identity.employeeId,
    expectedWorkerId: identity.workerId,
    kind: "all",
    status: "all",
  });
  assert.equal(h.calls[0].init?.method, "GET");
  assert.equal(h.calls[0].init?.cache, "no-store");
  assert.equal(h.calls[0].init?.body, undefined);
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.kind), ["missing", "revision", "correction"]);
  assert.equal(h.client.getSnapshot().result?.items[0].submittedAt, submittedAt);
  unsubscribe();
  const length = states.length;
  h.client.pause();
  assert.equal(states.length, length);
});

test("next replaces the page with the fixed asOf and complete three-part cursor; either filter restarts", async () => {
  let index = 0;
  const h = setup(async () => json(index++ === 0 ? wire(50) : index === 2 ? wire(11, 150) : wire(0)));
  await h.client.begin();
  await h.client.next();
  assert.equal(h.contextCalls.length, 1);
  assert.deepEqual(params(h.calls[1].path), {
    siteId: identity.siteId,
    expectedEmployeeId: identity.employeeId,
    expectedWorkerId: identity.workerId,
    kind: "all",
    status: "all",
    asOf,
    cursorAt: submittedAt,
    cursorKind: "correction",
    cursorId: id(151),
  });
  assert.equal(h.client.getSnapshot().page, 2);
  assert.equal(h.client.getSnapshot().result?.items[0].requestId, id(150));
  await h.client.next();
  assert.equal(h.calls.length, 2);
  await h.client.begin("revision", "approved");
  assert.deepEqual(params(h.calls[2].path), {
    siteId: identity.siteId,
    expectedEmployeeId: identity.employeeId,
    expectedWorkerId: identity.workerId,
    kind: "revision",
    status: "approved",
  });
  assert.equal(h.contextCalls.length, 2);
  assert.equal(h.client.getSnapshot().page, 1);
});

test("an empty filtered intermediate page is distinct from the final page", async () => {
  let index = 0;
  const h = setup(async () => json(index++ === 0 ? { ...wire(50), items: [] } : wire(0)));
  await h.client.begin("correction", "approved");
  assert.match(h.client.getSnapshot().message, /仍有下一页/);
  assert.equal(h.client.getSnapshot().result?.items.length, 0);
  await h.client.next();
  assert.match(h.client.getSnapshot().message, /已到末页/);
  assert.equal(h.client.getSnapshot().result?.nextCursor, null);
});

test("identity substitution, permission failures and transient errors clear rows without retries or error leakage", async () => {
  const substituted = wire();
  substituted.employeeId = id(21);
  substituted.items = substituted.items.map(item => ({ ...item, employeeId: id(21) }));
  const refused = setup(async () => json(substituted));
  await refused.client.begin();
  assert.equal(refused.client.getSnapshot().phase, "blocked");
  assert.equal(refused.client.getSnapshot().result, null);
  assert.match(refused.client.getSnapshot().message, /已清除列表/);

  for (const [status, error] of [[401, "unauthorized"], [403, "attendance_access_denied"], [409, "attendance_worker_changed"],
    [429, "attendance_rate_limited"], [503, "attendance_unavailable"], [0, "private_network_error"]] as const) {
    let failing = false;
    const h = setup(async () => {
      if (!failing) return json(wire(50));
      if (!status) throw Error(error);
      return json({ ok: false, error }, status);
    });
    await h.client.begin();
    failing = true;
    await h.client.next();
    assert.equal(h.client.getSnapshot().phase, "blocked");
    assert.equal(h.client.getSnapshot().result, null);
    assert.equal(h.client.getSnapshot().query, null);
    await h.client.next();
    assert.equal(h.calls.length, 2);
    assert(!h.client.getSnapshot().message.includes("private_network_error"));
  }
});

test("strict DTO, full-tuple ordering, bounded body and deadline failures never retain an old page", async () => {
  const duplicate = wire(2);
  duplicate.items[1] = { ...duplicate.items[0] };
  for (const body of [
    { ...wire(), privateReason: "private" },
    { ...wire(), workerId: id(31) },
    { ...wire(), siteId: "99990002" },
    { ...wire(), readOnly: false },
    { ...wire(), scanned: 51 },
    { ...wire(), moduleEnabled: "true" },
    duplicate,
    { ...wire(2), items: [...wire(2).items].reverse() },
    { ...wire(), items: [{ ...wire().items[0], rootRequestId: id(999) }] },
  ]) {
    let first = true;
    const h = setup(async () => {
      if (first) { first = false; return json(wire()); }
      return json(body);
    });
    await h.client.begin();
    assert.equal(h.client.getSnapshot().phase, "ready");
    await h.client.begin();
    assert.equal(h.client.getSnapshot().phase, "blocked");
    assert.equal(h.client.getSnapshot().result, null);
  }
  const large = setup(async () => json({ ...wire(), privateData: "x".repeat(131073) }));
  await large.client.begin();
  assert.equal(large.client.getSnapshot().result, null);
  const slow = setup(async () => new Promise<Response>(() => {}), 30);
  await slow.client.begin();
  assert.equal(slow.client.getSnapshot().phase, "blocked");
  assert.equal(slow.calls[0].init?.signal?.aborted, true);
});

test("busy reads deduplicate; pause aborts and stale success cannot replace a fresh result", async () => {
  const old = deferred<Response>();
  let index = 0;
  const h = setup(async () => index++ === 0 ? old.promise : json(wire(1, 150)));
  const pending = h.client.begin();
  await reached(() => h.calls.length === 1);
  await h.client.begin("missing", "withdrawn");
  await h.client.next();
  assert.equal(h.calls.length, 1);
  h.client.pause();
  assert.equal(h.calls[0].init?.signal?.aborted, true);
  assert.equal(h.client.getSnapshot().result, null);
  await h.client.begin();
  old.resolve(json(wire()));
  await pending;
  assert.equal(h.client.getSnapshot().phase, "ready");
  assert.equal(h.client.getSnapshot().result?.items[0].requestId, id(150));
  assert.equal(h.calls.length, 2);
});

test("hidden documents do not query or accept late data and visibility does not trigger an automatic read", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const response = deferred<Response>();
    const h = setup(async () => response.promise);
    await h.client.begin();
    assert.equal(h.calls.length, 0);
    assert.equal(h.contextCalls.length, 0);
    doc.hidden = false;
    assert.equal(h.calls.length, 0);
    const pending = h.client.begin();
    await reached(() => h.calls.length === 1);
    doc.hidden = true;
    response.resolve(json(wire()));
    await pending;
    assert.equal(h.client.getSnapshot().result, null);
    doc.hidden = false;
    await Promise.resolve();
    assert.equal(h.calls.length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("invalid filters and malformed or substituted context identities never query the list", async () => {
  const invalid = setup();
  await invalid.client.begin("unknown" as SelfRequestKind);
  await invalid.client.begin("all", "unknown" as SelfRequestStatus);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.contextCalls.length, 0);
  for (const body of [
    { ...contextBody(), employeeId: id(21) },
    { ...contextBody(), workerId: null },
    { ...contextBody(), siteId: "99990002" },
    { ...contextBody(), privateValue: "x" },
    { ...contextBody(), moduleEnabled: "false" },
    { ...contextBody(), privateValue: "x".repeat(2049) },
  ]) {
    const h = setup(undefined, undefined, async () => json(body));
    await h.client.begin();
    assert.equal(h.calls.length, 0);
    assert.equal(h.client.getSnapshot().phase, "blocked");
    assert.equal(h.client.getSnapshot().query, null);
  }
  for (const patch of [{ siteId: "all" }, { employeeId: "" }]) assert.throws(() =>
    new AttendanceSelfRequestsClient({ ...identity, ...patch, apiFetch: async () => { throw Error("must_not_fetch"); } }));
});

test("pause discards delayed context; a fresh explicit query binds only the newly resolved worker", async () => {
  const old = deferred<Response>();
  let reads = 0;
  const nextWorker = id(31);
  const nextResult = wire();
  nextResult.workerId = nextWorker;
  nextResult.items = nextResult.items.map(item => ({ ...item, workerId: nextWorker }));
  const h = setup(async () => json(nextResult), undefined, async () => reads++ === 0
    ? old.promise
    : json({ ...contextBody(), workerId: nextWorker }));
  const pending = h.client.begin();
  assert.equal(h.contextCalls.length, 1);
  h.client.pause();
  assert.equal(h.contextCalls[0].init?.signal?.aborted, true);
  await h.client.begin();
  old.resolve(json(contextBody()));
  await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.client.getSnapshot().result?.workerId, nextWorker);
  assert.equal(params(h.calls[0].path).expectedEmployeeId, identity.employeeId);
  assert.equal(params(h.calls[0].path).expectedWorkerId, nextWorker);
});
