import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceOwnerBacklogClient } from "./merchantAttendanceOwnerBacklogClient";
import type { OwnerBacklogKind, OwnerBacklogQuery, OwnerBacklogResult } from "./merchantAttendanceOwnerBacklog";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { siteId: "99990001", ownerId: id(99) };
const asOf = "2026-10-03T12:00:00.000001Z", submittedAt = "2026-08-03T10:00:00.123456Z";
function wire(count = 1, first = 200, kind: OwnerBacklogKind = "correction"): OwnerBacklogResult & { ok: true; moduleEnabled: boolean } {
  return { ok: true, moduleEnabled: false, protocol: "owner-backlog-v1", readOnly: true, ...identity, asOf, scanned: count,
    items: Array.from({ length: count }, (_, index) => ({ kind, requestId: id(first + index), workerId: id(30), workerName: "合成员工", workerNo: "BACKLOG-ONLY",
      submittedAt, proposedStartAt: "2026-08-03T08:00:00.123456Z", proposedEndAt: "2026-08-03T09:00:00.123456Z", status: "submitted" })),
    nextCursor: count === 50 ? { recordedAt: submittedAt, kind, requestId: id(first + 49) } : null };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup(reply: AttendanceApiFetch = async () => json(wire()), timeoutMs?: number) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new AttendanceOwnerBacklogClient({ ...identity, timeoutMs, apiFetch: async (path, init) => { calls.push({ path, init }); return reply(path, init); } });
  return { client, calls };
}
const params = (path: string) => Object.fromEntries(new URL(path, "https://example.test").searchParams);

test("construction is inert; explicit single GET has no date window, preserves three source identities and microseconds", async () => {
  const value = wire(3); value.items = value.items.map((item, index) => ({ ...item, requestId: id(200), kind: (["correction", "revision", "missing"] as const)[index] }));
  const h = setup(async () => json(value)), states: string[] = [], unsubscribe = h.client.subscribe(() => states.push(h.client.getSnapshot().phase));
  await h.client.next(); assert.equal(h.calls.length, 0); await h.client.begin();
  assert.equal(new URL(h.calls[0].path, "https://example.test").pathname, "/api/merchant-enterprise/attendance/owner-backlog");
  assert.deepEqual(params(h.calls[0].path), { ...{ siteId: identity.siteId }, kind: "all" });
  assert.equal(h.calls[0].init?.method, "GET"); assert.equal(h.calls[0].init?.cache, "no-store"); assert.equal(h.calls[0].init?.body, undefined);
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.kind), ["correction", "revision", "missing"]);
  assert.equal(h.client.getSnapshot().result?.items[0].submittedAt, submittedAt); assert.equal(h.client.getSnapshot().result?.moduleEnabled, false);
  unsubscribe(); const n = states.length; h.client.pause(); assert.equal(states.length, n);
});

test("next fixes the cutoff and all three cursor keys, replaces rather than appends; changing kind starts an explicit new first page", async () => {
  let index = 0;
  const h = setup(async () => json(index++ === 0 ? wire(50) : index === 2 ? wire(3, 250) : wire(0, 300, "revision")));
  await h.client.begin(); await h.client.next();
  assert.deepEqual(params(h.calls[1].path), { siteId: identity.siteId, kind: "all", asOf, cursorAt: submittedAt, cursorKind: "correction", cursorId: id(249) });
  assert.equal(h.client.getSnapshot().page, 2); assert.equal(h.client.getSnapshot().result?.items.length, 3);
  assert.equal(h.client.getSnapshot().result?.items[0].requestId, id(250)); await h.client.next(); assert.equal(h.calls.length, 2);
  await h.client.begin("revision"); assert.deepEqual(params(h.calls[2].path), { siteId: identity.siteId, kind: "revision" }); assert.equal(h.client.getSnapshot().page, 1);
});

test("an empty scanned page is not a false no-backlog result and explicit next can reach the final empty page", async () => {
  let index = 0; const h = setup(async () => json(index++ === 0 ? { ...wire(50, 200, "missing"), items: [] } : wire(0, 300, "missing")));
  await h.client.begin("missing"); assert.match(h.client.getSnapshot().message, /仍有下一页/); assert.equal(h.calls.length, 1);
  await h.client.next(); assert.match(h.client.getSnapshot().message, /已到末页/); assert.equal(h.client.getSnapshot().result?.nextCursor, null);
  assert.equal(params(h.calls[1].path).cursorKind, "missing"); assert.equal(h.calls.length, 2);
});

test("owner identity substitution is rejected, even when the envelope is otherwise strictly valid", async () => {
  const h = setup(async () => json({ ...wire(), ownerId: id(98) })); await h.client.begin();
  assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().query, null);
  assert.match(h.client.getSnapshot().message, /负责人权限/); assert.equal(h.calls.length, 1);
});

test("authorization, transient and network errors clear previous rows and cursors without automatic reads or fallback", async () => {
  for (const [status, error] of [[401, "unauthorized"], [403, "attendance_access_denied"], [409, "attendance_settings_required"],
    [429, "attendance_rate_limited"], [503, "attendance_unavailable"], [0, "private_network_detail"]] as const) {
    let failure = false;
    const h = setup(async () => { if (!failure) return json(wire(50)); if (!status) throw Error(error); return json({ ok: false, error }, status); });
    await h.client.begin(); failure = true; await h.client.next();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().query, null);
    assert(!h.client.getSnapshot().message.includes("private_network_detail")); await h.client.next(); assert.equal(h.calls.length, 2);
    failure = false; await h.client.begin(); assert.equal(h.client.getSnapshot().phase, "ready");
    assert.deepEqual(params(h.calls[2].path), { siteId: identity.siteId, kind: "all" });
  }
});

test("strict shape, source order, same-source duplication and body/deadline bounds never expose a partial result", async () => {
  const reversed = wire(2); reversed.items.reverse();
  const duplicate = wire(2); duplicate.items[1] = { ...duplicate.items[0] };
  const wrongRank = wire(2); wrongRank.items[0].kind = "missing";
  for (const value of [{ ...wire(), privateReason: "private" }, { ...wire(), siteId: "99990002" }, { ...wire(), readOnly: false },
    { ...wire(), scanned: 51 }, { ...wire(), moduleEnabled: "false" }, reversed, duplicate, wrongRank,
    { ...wire(), items: [{ ...wire().items[0], status: "approved" }] }]) {
    let first = true; const h = setup(async () => { if (first) { first = false; return json(wire()); } return json(value); });
    await h.client.begin(); assert.equal(h.client.getSnapshot().phase, "ready"); await h.client.begin();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
  }
  const oversized = setup(async () => json({ ...wire(), privateData: "x".repeat(131073) })); await oversized.client.begin(); assert.equal(oversized.client.getSnapshot().result, null);
  const slow = setup(async () => new Promise<Response>(() => {}), 5); await slow.client.begin();
  assert.equal(slow.client.getSnapshot().phase, "blocked"); assert.equal(slow.calls[0].init?.signal?.aborted, true);
});

test("busy calls deduplicate; pause aborts and a late success or denial cannot replace a newer explicit page", async () => {
  for (const late of [() => json(wire()), () => json({ ok: false, error: "attendance_access_denied" }, 403)]) {
    const held = deferred<Response>(); let index = 0;
    const h = setup(async () => index++ === 0 ? held.promise : json(wire(1, 300)));
    const pending = h.client.begin(); await h.client.begin("revision"); await h.client.next(); assert.equal(h.calls.length, 1);
    h.client.pause(); assert.equal(h.calls[0].init?.signal?.aborted, true); assert.equal(h.client.getSnapshot().query, null);
    await h.client.begin(); held.resolve(late()); await pending;
    assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal(h.client.getSnapshot().result?.items[0].requestId, id(300)); assert.equal(h.calls.length, 2);
  }
});

test("hidden documents neither query nor publish a delayed response and returning visible never initiates a read", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const held = deferred<Response>(), h = setup(async () => held.promise);
    await h.client.begin(); assert.equal(h.calls.length, 0); doc.hidden = false; assert.equal(h.calls.length, 0);
    const pending = h.client.begin(); doc.hidden = true; held.resolve(json(wire())); await pending;
    assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().query, null);
    doc.hidden = false; await Promise.resolve(); assert.equal(h.calls.length, 1);
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});

test("invalid identities or source filters fail before network and a paused client requires an explicit fresh begin", async () => {
  for (const patch of [{ siteId: "all" }, { ownerId: "" }]) assert.throws(() => new AttendanceOwnerBacklogClient({ ...identity, ...patch,
    apiFetch: async () => { throw Error("must_not_fetch"); } }));
  const h = setup(); await h.client.begin("unknown" as OwnerBacklogQuery["kind"]); assert.equal(h.calls.length, 0);
  await h.client.begin(); h.client.pause(); await h.client.next(); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().result, null);
  await h.client.begin(); assert.equal(h.calls.length, 2); assert.equal(h.client.getSnapshot().phase, "ready");
});
