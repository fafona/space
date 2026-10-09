import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLeaveReviewClient } from "./merchantAttendanceLeaveReviewClient";
import { parseLeaveReviewHttpQuery, type LeaveReviewItem, type LeaveReviewQuery } from "./merchantAttendanceLeaveReview";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(99), submittedAt = "2026-10-04T09:00:00.123456Z";
const item = (n = 501): LeaveReviewItem => ({ requestId: id(n), workerName: "Synthetic leave applicant",
  startAt: "2027-10-05T07:00:00.000Z", endAt: "2027-10-05T15:00:00.000Z", timeZone: "Europe/Madrid",
  submittedAt, revision: 1, status: "submitted" });
const firstQuery = (): LeaveReviewQuery => ({ siteId, afterAt: null, afterId: null });
const json = (value: unknown, status = 200) => Response.json(value, { status });
const queryFrom = (url: string) => parseLeaveReviewHttpQuery(new URL(url, "https://fixture.invalid").href);
function setup(timeoutMs = 1000) {
  const rows: { item: LeaveReviewItem; pending: boolean }[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];
  let enabled = true, transport: AttendanceApiFetch | null = null;
  const seed = (n: number, pending = true) => { rows.push({ item: item(n), pending }); };
  const reply = (query = firstQuery()) => {
    const candidates = rows.filter(row => !query.afterAt || row.item.submittedAt > query.afterAt
      || row.item.submittedAt === query.afterAt && row.item.requestId > query.afterId!)
      .sort((a, b) => a.item.submittedAt === b.item.submittedAt ? a.item.requestId.localeCompare(b.item.requestId) : a.item.submittedAt.localeCompare(b.item.submittedAt));
    const scanned = candidates.slice(0, 50), last = scanned.at(-1)?.item;
    return json({ ok: true, moduleEnabled: enabled, protocol: "leave-review-v1", siteId, ownerId,
      items: scanned.filter(row => row.pending).map(row => row.item), scanned: scanned.length,
      nextCursor: candidates.length > 50 ? { at: last!.submittedAt, id: last!.requestId } : null });
  };
  const client = new AttendanceLeaveReviewClient({ siteId, ownerId, timeoutMs, apiFetch: async (url, init) => {
    calls.push({ url, init }); assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.body, undefined);
    return transport ? transport(url, init) : reply(queryFrom(url));
  } });
  return { client, calls, seed, reply, rows, enabled: (value: boolean) => { enabled = value; }, transport: (value: typeof transport) => { transport = value; } };
}

test("construction and next are inert; explicit GET is owner-pinned, accepts future leave and never reads or writes browser storage", async t => {
  const saved = ["localStorage", "sessionStorage"].map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }));
  let storageAccesses = 0;
  for (const { name } of saved) Object.defineProperty(globalThis, name, { configurable: true, get: () => { storageAccesses++; throw Error("review must not access storage"); } });
  t.after(() => { for (const { name, descriptor } of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });
  const f = setup(); f.seed(501); let changes = 0; const off = f.client.subscribe(() => { changes++; });
  assert.equal(f.client.getSnapshot().phase, "idle"); await f.client.next(); assert.equal(f.calls.length, 0);
  await f.client.load(); assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.calls.length, 1);
  assert.deepEqual(queryFrom(f.calls[0].url), firstQuery()); assert.equal(new URL(f.calls[0].url, "https://fixture.invalid").pathname, "/api/merchant-enterprise/attendance/leave-review");
  assert.equal(f.client.getSnapshot().result?.ownerId, ownerId); assert.equal(f.client.getSnapshot().result?.items[0].endAt, item().endAt);
  assert.equal(storageAccesses, 0); assert.ok(changes > 0); off(); const n = changes; f.client.pause(); assert.equal(changes, n);
  assert.equal(f.client.getSnapshot().result, null); assert.equal(storageAccesses, 0);
});

test("an empty50 scanned page does not end discovery or trigger an automatic scan, and explicit next replaces the page", async () => {
  const f = setup(); for (let n = 501; n <= 580; n++) f.seed(n, n > 550);
  await f.client.load(); assert.equal(f.calls.length, 1); assert.deepEqual(f.client.getSnapshot().result?.items, []);
  assert.equal(f.client.getSnapshot().result?.scanned, 50); assert.deepEqual(f.client.getSnapshot().result?.nextCursor, { at: submittedAt, id: id(550) });
  await Promise.resolve(); assert.equal(f.calls.length, 1);
  await f.client.next(); assert.equal(f.calls.length, 2); assert.deepEqual(queryFrom(f.calls[1].url), { siteId, afterAt: submittedAt, afterId: id(550) });
  assert.equal(f.client.getSnapshot().result?.items.length, 30); assert.equal(f.client.getSnapshot().result?.items[0].requestId, id(551));
  assert.equal(f.client.getSnapshot().result?.nextCursor, null); await f.client.next(); assert.equal(f.calls.length, 2);
  await f.client.load(); assert.deepEqual(queryFrom(f.calls[2].url), firstQuery()); assert.deepEqual(f.client.getSnapshot().result?.items, []);
});

test("paused entitlement remains readable and returned moduleEnabled never adds write behavior", async () => {
  const f = setup(); f.seed(501); f.enabled(false); await f.client.load();
  assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().result?.moduleEnabled, false);
  assert.equal(f.client.getSnapshot().result?.items[0].requestId, id(501)); assert.equal(f.calls.length, 1);
});

test("owner substitution, tenant substitution and malformed protocol output clear prior results and cursors", async () => {
  for (const patch of [{ ownerId: id(98) }, { siteId: "99990002" }, { protocol: "owner-backlog-v1" },
    { scanned: 51 }, { moduleEnabled: "true" }, { privateReason: "hidden" },
    { items: [{ ...item(), status: "approved", revision: 2 }] }]) {
    const f = setup(); f.seed(501); await f.client.load(); assert.equal(f.client.getSnapshot().phase, "ready");
    f.transport(async () => json({ ...await f.reply().json(), ...patch })); await f.client.load();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
    const n = f.calls.length; await f.client.next(); assert.equal(f.calls.length, n);
  }
});

test("exact refusals, unknown/malformed errors and network failures expose no rows or private diagnostics, and recovery is explicit", async () => {
  for (const [status, body] of [[403, { ok: false, error: "attendance_access_denied" }], [409, { ok: false, error: "attendance_settings_required" }],
    [404, { ok: false, error: "attendance_not_available" }], [503, { ok: false, error: "attendance_leave_invalid" }],
    [503, { ok: false, error: "attendance_leave_review_invalid" }], [429, { ok: false, error: "attendance_rate_limited" }],
    [403, { ok: true, error: "attendance_access_denied" }], [403, { error: "attendance_access_denied" }],
    [403, { ok: false, error: "attendance_access_denied", extra: true }], [500, { ok: false, error: "attendance_access_denied" }],
    [503, { ok: false, error: "private_database_detail" }], [0, null]] as [number, unknown][]) {
    const f = setup(); f.seed(501); await f.client.load();
    f.transport(async () => { if (!status) throw Error("private_network_detail"); return json(body, status); });
    await f.client.load(); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
    assert.doesNotMatch(f.client.getSnapshot().message, /private_(?:database|network)_detail/);
    const n = f.calls.length; await f.client.next(); assert.equal(f.calls.length, n);
    f.transport(null); await f.client.load(); assert.equal(f.client.getSnapshot().phase, "ready"); assert.deepEqual(queryFrom(f.calls.at(-1)!.url), firstQuery());
  }
});

test("busy reads deduplicate, pause aborts, and a late success or denial cannot overwrite the newer explicit result", async () => {
  for (const denied of [false, true]) {
    const f = setup(); f.seed(501); let release!: (value: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const loading = f.client.load(); await f.client.load(); await f.client.next(); assert.equal(f.calls.length, 1);
    f.client.pause(); assert.equal(f.calls[0].init?.signal?.aborted, true); assert.equal(f.client.getSnapshot().result, null);
    f.rows.length = 0; f.seed(600); f.transport(null); await f.client.load(); const fresh = f.client.getSnapshot();
    release(denied ? json({ ok: false, error: "attendance_access_denied" }, 403) : f.reply()); await loading;
    assert.equal(f.client.getSnapshot(), fresh); assert.equal(f.client.getSnapshot().result?.items[0].requestId, id(600));
  }
});

test("hidden reads are inert and hidden-at-response success or denial clears data without automatic foreground recovery", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const hidden = setup(); await hidden.client.load(); await hidden.client.next(); assert.equal(hidden.calls.length, 0);
  for (const denied of [false, true]) {
    doc.hidden = false; const f = setup(); f.seed(501); let release!: (value: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; })); const loading = f.client.load(); doc.hidden = true;
    release(denied ? json({ ok: false, error: "attendance_access_denied" }, 403) : f.reply()); await loading;
    assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "idle");
    doc.hidden = false; await Promise.resolve(); assert.equal(f.calls.length, 1);
  }
});

test("HTML and oversized success bodies fail closed; no retry or partial list is exposed", async () => {
  for (const response of [() => new Response("login", { headers: { "content-type": "text/html" } }),
    () => json({ ok: true, moduleEnabled: true, payload: "x".repeat(131073) })]) {
    const f = setup(); f.transport(async () => response()); await f.client.load();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.calls.length, 1);
  }
});

test("strict4KiB error body overflow cancels and unlocks its stream", async () => {
  const f = setup(); let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: false, error: "attendance_access_denied", padding: "x".repeat(4096) })));
  }, cancel() { cancelled++; } });
  f.transport(async () => new Response(stream, { status: 403, headers: { "content-type": "application/json" } }));
  await f.client.load(); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(f.client.getSnapshot().result, null);
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 1);
});

test("deadline covers headers and slow success/error bodies, cancelling in-flight readers", async () => {
  const headers = setup(25); headers.transport(async () => new Promise<Response>(() => {})); await headers.client.load();
  assert.equal(headers.client.getSnapshot().phase, "blocked"); assert.equal(headers.calls[0].init?.signal?.aborted, true);
  for (const status of [200, 503]) {
    const f = setup(25); let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancelled++; } });
    f.transport(async () => new Response(stream, { status, headers: { "content-type": "application/json" } }));
    await f.client.load(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(f.calls[0].init?.signal?.aborted, true);
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("invalid identities fail before transport, and paused clients require a new explicit homepage load", async () => {
  let calls = 0;
  for (const patch of [{ siteId: "all" }, { ownerId: "" }]) assert.throws(() => new AttendanceLeaveReviewClient({ siteId, ownerId, ...patch,
    apiFetch: async () => { calls++; throw Error("must not fetch"); } }));
  assert.equal(calls, 0); const f = setup(); f.seed(501); await f.client.load(); f.client.pause(); await f.client.next();
  assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result, null);
  await f.client.load(); assert.equal(f.calls.length, 2); assert.deepEqual(queryFrom(f.calls[1].url), firstQuery());
});
