import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceScheduleOverviewClient } from "./merchantAttendanceScheduleOverviewClient";
import type { ScheduleOverviewItem, ScheduleOverviewResult } from "./merchantAttendanceScheduleOverview";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { siteId: "99990001", ownerId: id(99) };
const selection = () => ({ workerIds: [id(201), id(202)], fromDate: "2026-10-01", throughDate: "2026-10-31" });
function wire(count = 1, first = 501, revision = 5): ScheduleOverviewResult & { ok: true; moduleEnabled: boolean } {
  const items: ScheduleOverviewItem[] = Array.from({ length: count }, (_, i) => ({ id: id(first + i), workerId: id(201),
    workerName: "Synthetic worker", locationId: id(301), locationName: "Synthetic location", timeZone: "Europe/Madrid",
    workDate: "2026-10-03", startAt: "2026-10-03T07:00:00.000Z", endAt: "2026-10-03T15:00:00.000Z",
    revision: 2, cancelled: false, cancelRevision: null }));
  return { ok: true, moduleEnabled: false, protocol: "schedule-overview-v1", readOnly: true, ...identity, ...selection(), revision,
    items, scanned: count, nextCursor: count === 50 ? { workDate: items[49].workDate, startAt: items[49].startAt, slotId: items[49].id } : null };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function setup(reply: AttendanceApiFetch = async () => json(wire()), timeoutMs?: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new AttendanceScheduleOverviewClient({ ...identity, timeoutMs,
    apiFetch: async (url, init) => { calls.push({ url, init }); return reply(url, init); } });
  return { client, calls };
}
const params = (url: string) => Object.fromEntries(new URL(url, "https://fixture.invalid").searchParams);

test("construction/subscription/next are inert; one explicit overview GET neither writes nor depends on pending-operation storage", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw Error("read-only overview must not access pending storage"); } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "sessionStorage", previous); else Reflect.deleteProperty(globalThis, "sessionStorage"); });
  const f = setup(), states: string[] = [], unsubscribe = f.client.subscribe(() => states.push(f.client.getSnapshot().phase));
  await f.client.next(); assert.equal(f.calls.length, 0);
  await f.client.begin(selection());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init?.method, "GET"); assert.equal(f.calls[0].init?.body, undefined);
  assert.equal(f.calls[0].init?.cache, "no-store");
  assert.equal(new URL(f.calls[0].url, "https://fixture.invalid").pathname, "/api/merchant-enterprise/attendance/schedule-overview");
  assert.deepEqual(params(f.calls[0].url), { siteId: identity.siteId, workerIds: selection().workerIds.join(","),
    fromDate: selection().fromDate, throughDate: selection().throughDate });
  assert.equal(f.client.getSnapshot().result?.moduleEnabled, false); assert.equal(f.client.getSnapshot().result?.readOnly, true);
  assert.ok(states.includes("loading")); unsubscribe(); const n = states.length; f.client.pause(); assert.equal(states.length, n);
});

test("next pins the exact revision and complete three-part cursor, replaces the page and never auto-fetches the rest", async () => {
  let index = 0; const f = setup(async () => json(index++ === 0 ? wire(50) : wire(3, 551)));
  await f.client.begin(selection()); assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().page, 1);
  await f.client.next(); assert.equal(f.calls.length, 2);
  assert.deepEqual(params(f.calls[1].url), { siteId: identity.siteId, workerIds: selection().workerIds.join(","),
    fromDate: selection().fromDate, throughDate: selection().throughDate, revision: "5", cursorDate: "2026-10-03",
    cursorStart: "2026-10-03T07:00:00.000Z", cursorId: id(550) });
  assert.equal(f.client.getSnapshot().page, 2); assert.equal(f.client.getSnapshot().result?.items.length, 3);
  assert.equal(f.client.getSnapshot().result?.items[0].id, id(551)); await f.client.next(); assert.equal(f.calls.length, 2);
  await f.client.begin(selection()); assert.equal(params(f.calls[2].url).revision, undefined);
  assert.equal(params(f.calls[2].url).cursorId, undefined); assert.equal(f.client.getSnapshot().page, 1);
});

test("empty intermediate scanned pages retain an explicit continuation without declaring anyone absent", async () => {
  let index = 0; const f = setup(async () => json(index++ === 0 ? { ...wire(50), items: [] } : wire(0)));
  await f.client.begin(selection()); assert.equal(f.calls.length, 1);
  assert.equal(f.client.getSnapshot().result?.items.length, 0); assert.ok(f.client.getSnapshot().result?.nextCursor);
  await f.client.next(); assert.equal(f.client.getSnapshot().result?.nextCursor, null);
  assert.equal(f.client.getSnapshot().result?.scanned, 0); assert.equal(f.calls.length, 2);
  assert.match(f.client.getSnapshot().message, /不代表缺勤/);
});

test("new worker/date selection starts a fresh unpinned view; invalid identities and oversized selections never fetch", async () => {
  const altered = { workerIds: [id(202)], fromDate: "2026-10-02", throughDate: "2026-10-03" };
  let index = 0; const f = setup(async () => json(index++ === 0 ? wire() : { ...wire(0, 600, 8), ...altered }));
  await f.client.begin(selection()); await f.client.begin(altered);
  assert.equal(params(f.calls[1].url).workerIds, id(202)); assert.equal(params(f.calls[1].url).fromDate, altered.fromDate);
  assert.equal(params(f.calls[1].url).revision, undefined); assert.equal(f.client.getSnapshot().result?.revision, 8);
  for (const patch of [{ siteId: "all" }, { ownerId: "bad" }]) assert.throws(() => new AttendanceScheduleOverviewClient({ ...identity, ...patch, apiFetch: async () => json(wire()) }));
  for (const patch of [{ workerIds: [] }, { workerIds: [id(202), id(201)] }, { workerIds: Array.from({ length: 21 }, (_, i) => id(i + 1)) },
    { throughDate: "2026-11-01" }, { fromDate: "bad" }]) {
    const invalid = setup(); await invalid.client.begin({ ...selection(), ...patch });
    assert.equal(invalid.calls.length, 0); assert.equal(invalid.client.getSnapshot().result, null);
  }
});

test("owner substitution, changed revision and malformed lists clear previous rows and all continuation state", async () => {
  const mutations = [
    { ...wire(3, 551), ownerId: id(98) }, { ...wire(3, 551), siteId: "99990002" }, { ...wire(3, 551), revision: 6 },
    { ...wire(3, 551), workerIds: [id(201)] }, { ...wire(3, 551), readOnly: false },
    { ...wire(3, 551), reason: "private" }, { ...wire(3, 551), moduleEnabled: "false" },
    { ...wire(3, 551), items: [...wire(3, 551).items].reverse() },
    { ...wire(3, 551), items: [wire().items[0]] }, { ...wire(3, 551), scanned: 51 },
  ];
  for (const value of mutations) {
    let first = true; const f = setup(async () => { if (first) { first = false; return json(wire(50)); } return json(value); });
    await f.client.begin(selection()); await f.client.next();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().query, null);
    await f.client.next(); assert.equal(f.calls.length, 2);
  }
});

test("permission, network, HTML, body-size and deadline failures hide data without retries, writes or error leakage", async () => {
  for (const [status, error] of [[401, "unauthorized"], [403, "attendance_access_denied"], [409, "attendance_settings_required"],
    [429, "attendance_rate_limited"], [503, "attendance_unavailable"], [0, "private network credentials"]] as const) {
    let first = true; const f = setup(async () => { if (first) { first = false; return json(wire(50)); }
      if (!status) throw Error(error); return json({ ok: false, error }, status); });
    await f.client.begin(selection()); await f.client.next();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().query, null);
    assert.doesNotMatch(f.client.getSnapshot().message, /private network credentials/); await f.client.next(); assert.equal(f.calls.length, 2);
  }
  for (const response of [() => new Response("login", { headers: { "content-type": "text/html" } }),
    () => json({ ...wire(), privateData: "x".repeat(262145) })]) {
    const f = setup(async () => response()); await f.client.begin(selection()); assert.equal(f.client.getSnapshot().phase, "blocked");
  }
  const slow = setup(async () => new Promise<Response>(() => {}), 25); await slow.client.begin(selection());
  assert.equal(slow.client.getSnapshot().phase, "blocked"); assert.equal(slow.calls[0].init?.signal?.aborted, true);
});

test("busy reads deduplicate; pause aborts and late success or denial cannot overwrite a newer explicit view", async () => {
  for (const late of [() => json(wire()), () => json({ ok: false, error: "attendance_access_denied" }, 403)]) {
    const old = deferred<Response>(); let index = 0;
    const f = setup(async () => index++ === 0 ? old.promise : json(wire(1, 700, 8)));
    const reading = f.client.begin(selection()); await f.client.begin(selection()); await f.client.next(); assert.equal(f.calls.length, 1);
    f.client.pause(); assert.equal(f.calls[0].init?.signal?.aborted, true); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().query, null);
    await f.client.begin(selection()); old.resolve(late()); await reading;
    assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().result?.items[0].id, id(700));
    assert.equal(f.client.getSnapshot().result?.revision, 8); assert.equal(f.calls.length, 2);
  }
});

test("hidden views neither issue GETs nor accept late data; becoming visible never starts a read", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const held = deferred<Response>(), f = setup(async () => held.promise);
  await f.client.begin(selection()); await f.client.next(); assert.equal(f.calls.length, 0);
  doc.hidden = false; await Promise.resolve(); assert.equal(f.calls.length, 0);
  const reading = f.client.begin(selection()); doc.hidden = true; held.resolve(json(wire())); await reading;
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().query, null);
  doc.hidden = false; await Promise.resolve(); assert.equal(f.calls.length, 1); await f.client.next(); assert.equal(f.calls.length, 1);
});
