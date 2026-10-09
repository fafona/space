import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceNoticeCoverageClient } from "./merchantAttendanceNoticeCoverageClient";
import type { CoverageResult } from "./merchantAttendanceNoticeCoverage";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { siteId: "99990001", locationId: id(90), ownerId: id(99) };
function wire(count = 1, start = 1): CoverageResult & { ok: true; moduleEnabled: boolean } {
  const assigned = count === 50 || start > 1 ? 51 : count;
  return { ok: true, moduleEnabled: true, siteId: identity.siteId,
    location: { id: identity.locationId, name: "合成地点", active: true, version: 3 }, settingsVersion: 4,
    notice: { revision: 2, action: "publish", recordedAt: "2026-10-03T10:00:00.123456Z" }, noticeCurrent: true,
    observedAt: "2026-10-03T12:00:00.123456Z", counts: { assigned, eligible: assigned, excluded: 0, confirmed: 0, pending: assigned },
    items: Array.from({ length: count }, (_, index) => { const n = start + index; return { workerId: id(n), workerNo: `COVERAGE-${n}`,
      displayName: `合成员工 ${n}`, employeeId: id(1000 + n), eligible: true, exclusion: null, acknowledgedAt: null }; }),
    nextCursor: count === 50 ? id(start + 49) : null };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup(reply: AttendanceApiFetch = async () => json(wire())) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new AttendanceNoticeCoverageClient({ ...identity, apiFetch: async (path, init) => { calls.push({ path, init }); return reply(path, init); } });
  return { client, calls };
}

test("construction is inert; explicit first page is a no-store GET with no cursor or write", async () => {
  const h = setup(), phases: string[] = [], unsubscribe = h.client.subscribe(() => phases.push(h.client.getSnapshot().phase));
  await h.client.loadNext(); assert.equal(h.calls.length, 0); assert.equal(h.client.getSnapshot().phase, "idle");
  await h.client.loadFirst(); assert.equal(h.calls.length, 1);
  const call = h.calls[0], url = new URL(call.path, "https://example.test");
  assert.equal(url.pathname, "/api/merchant-enterprise/attendance/location-notice-coverage");
  assert.deepEqual(Object.fromEntries(url.searchParams), { siteId: identity.siteId, locationId: identity.locationId });
  assert.equal(call.init?.method, "GET"); assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.body, undefined);
  assert.equal(h.client.getSnapshot().result?.observedAt, wire().observedAt); assert.equal(h.client.getSnapshot().phase, "ready");
  unsubscribe(); const seen = phases.length; h.client.invalidate(); assert.equal(phases.length, seen); assert.equal(h.calls.length, 1);
});

test("next page uses exact observed notice/config fences, replaces 50 rows, and first-page restart removes the cursor", async () => {
  let index = 0;
  const h = setup(async () => json(index++ === 0 ? wire(50) : wire(1, 51)));
  await h.client.loadFirst(); await h.client.loadNext();
  const query = Object.fromEntries(new URL(h.calls[1].path, "https://example.test").searchParams);
  assert.deepEqual(query, { siteId: identity.siteId, locationId: identity.locationId, expectedNoticeRevision: "2",
    expectedSettingsVersion: "4", expectedLocationVersion: "3", cursorWorkerId: id(50) });
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.workerId), [id(51)]);
  await h.client.loadNext(); assert.equal(h.calls.length, 2);
  await h.client.loadFirst(); assert.deepEqual(Object.fromEntries(new URL(h.calls[2].path, "https://example.test").searchParams),
    { siteId: identity.siteId, locationId: identity.locationId });
});

test("all denials, temporary errors and failed network clear a previous page and prohibit next-page retries", async () => {
  for (const [status, error] of [[401, "unauthorized"], [403, "attendance_access_denied"], [409, "attendance_version_conflict"],
    [429, "attendance_rate_limited"], [503, "attendance_unavailable"], [0, "network"]] as const) {
    let failed = false;
    const h = setup(async () => { if (!failed) return json(wire(50)); if (status === 0) throw Error(error); return json({ ok: false, error }, status); });
    await h.client.loadFirst(); failed = true; await h.client.loadNext();
    assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().phase, "blocked");
    assert(!h.client.getSnapshot().message.includes("network")); await h.client.loadNext(); assert.equal(h.calls.length, 2);
    failed = false; await h.client.loadFirst(); assert.equal(h.calls.length, 3); assert.equal(h.client.getSnapshot().phase, "ready");
  }
});

test("strict responses reject leaked fields, mismatched identity, invalid counts, duplicates and HTML without retaining the old page", async () => {
  const duplicate = wire(2); duplicate.items[1] = { ...duplicate.items[0] };
  for (const body of [{ ...wire(), nonce: "private" }, { ...wire(), siteId: "99990002" },
    { ...wire(), location: { ...wire().location, id: id(91) } }, { ...wire(), counts: { ...wire().counts, eligible: 4 } },
    { ...wire(), moduleEnabled: "true" }, duplicate, wire(51)]) {
    let first = true;
    const h = setup(async () => { if (first) { first = false; return json(wire()); } return json(body); });
    await h.client.loadFirst(); assert.equal(h.client.getSnapshot().phase, "ready"); await h.client.loadFirst();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
  }
  const h = setup(async () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
  await h.client.loadFirst(); assert.equal(h.client.getSnapshot().result, null);
});

test("concurrent clicks are deduplicated; invalidation aborts and ignores delayed success while a new manual page survives", async () => {
  const old = deferred<Response>(); let index = 0;
  const h = setup(async () => index++ === 0 ? old.promise : json(wire(1, 7)));
  const pending = h.client.loadFirst(); await h.client.loadFirst(); await h.client.loadNext(); assert.equal(h.calls.length, 1);
  h.client.invalidate(); assert.equal(h.calls[0].init?.signal?.aborted, true); assert.equal(h.client.getSnapshot().result, null);
  await h.client.loadFirst(); old.resolve(json(wire())); await pending;
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.workerId), [id(7)]); assert.equal(h.calls.length, 2);
});

test("an invalidated delayed denial cannot clear a new successful page", async () => {
  const old = deferred<Response>(); let index = 0;
  const h = setup(async () => index++ === 0 ? old.promise : json(wire()));
  const pending = h.client.loadFirst(); h.client.invalidate(); await h.client.loadFirst();
  old.resolve(json({ ok: false, error: "attendance_access_denied" }, 403)); await pending;
  assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal(h.client.getSnapshot().result?.items.length, 1);
});

test("hidden documents neither query nor accept a success; visible state never triggers a request", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const response = deferred<Response>(), h = setup(async () => response.promise);
    await h.client.loadFirst(); assert.equal(h.calls.length, 0);
    doc.hidden = false; assert.equal(h.calls.length, 0); const pending = h.client.loadFirst();
    doc.hidden = true; response.resolve(json(wire())); await pending;
    assert.equal(h.client.getSnapshot().result, null); doc.hidden = false; await Promise.resolve(); assert.equal(h.calls.length, 1);
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});

test("unpublished and withdrawn versions keep null confirmation totals, while paused/stale publication remains only a read", async () => {
  for (const notice of [null, { revision: 3, action: "withdraw" as const, recordedAt: wire().notice!.recordedAt }]) {
    const body = { ...wire(50), notice, noticeCurrent: false, counts: { ...wire(50).counts, confirmed: null, pending: null } };
    let first = true;
    const h = setup(async () => { if (first) { first = false; return json(body); } return json({ ...body, items: wire(1, 51).items, nextCursor: null }); });
    await h.client.loadFirst();
    assert.equal(h.client.getSnapshot().result?.counts.confirmed, null); assert.equal(h.client.getSnapshot().result?.counts.pending, null);
    await h.client.loadNext(); const query = new URL(h.calls[1].path, "https://example.test").searchParams;
    assert.equal(query.get("expectedNoticeRevision"), notice ? "3" : "0");
    assert.equal(h.client.getSnapshot().phase, "ready"); assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.workerId), [id(51)]);
  }
  const body = { ...wire(), moduleEnabled: false, noticeCurrent: false };
  const h = setup(async () => json(body)); await h.client.loadFirst();
  assert.equal(h.client.getSnapshot().result?.moduleEnabled, false); assert.equal(h.client.getSnapshot().result?.noticeCurrent, false);
  assert(h.calls.every(call => call.init?.method === "GET"));
});

test("invalid identity inputs reject before any request", () => {
  for (const patch of [{ siteId: "*" }, { locationId: "all" }, { ownerId: "" }]) assert.throws(() =>
    new AttendanceNoticeCoverageClient({ ...identity, ...patch, apiFetch: async () => { throw Error("must_not_fetch"); } }));
});
