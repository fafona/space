import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceRetentionPeriodsV2Client, RETENTION_PERIODS_V2_API, RETENTION_PERIODS_V2_BYTE_LIMIT,
  type AttendanceRetentionPeriodsV2ClientOptions } from "./merchantAttendanceRetentionPeriodsV2Client";
import { parsePeriodClosureV2HttpQuery, type PeriodClosureV2Query as Query, type PeriodClosureV2ListItem,
  type PeriodClosureV2Response as Wire } from "./merchantAttendancePeriodClosureV2";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

// Strict synthetic metadata only; these tests do not represent SQL/Auth proof.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const site = "99990237", actor = id(1), worker = id(2), employee = id(3), employeeAuth = id(4);
const openedAt = "2026-10-01T12:00:00.000001Z", readAt = "2026-10-08T12:00:00.000001Z";
const row = (n = 1026): PeriodClosureV2ListItem => ({ periodId: id(n), workerId: worker, employeeId: employee,
  employeeAuthUserId: employeeAuth, workerName: "Synthetic 237", workerNo: "S237", fromDate: "2026-09-01", throughDate: "2026-09-20",
  timeZone: "UTC", startAt: "2026-09-01T00:00:00.000000Z", endAt: "2026-09-21T00:00:00.000000Z",
  revision: 101, currentVersion: 21, state: "open", sealed: false, confirmedVersion: null, unresolvedDispute: false, openedAt });
function wire(q: Query, currentVersion = 21): Wire {
  const common = { protocol: "period-closure-v2" as const, siteId: q.siteId, workerId: q.workerId, actorId: actor, access: "owner" as const, readAt };
  const scope = { siteId: q.siteId, access: q.access, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate, periodId: q.periodId };
  if (q.mode === "list") {
    const items = q.cursor ? [row(1001)] : Array.from({ length: 25 }, (_, i) => row(1026 - i));
    const nextCursor = q.cursor ? null : { ...scope, periodId: null, kind: "list" as const,
      atOpenedAt: openedAt, atPeriodId: items[0].periodId, beforeOpenedAt: openedAt, beforePeriodId: items.at(-1)!.periodId };
    return { ok: true, moduleEnabled: false, data: { ...common, kind: "list", items, nextCursor } };
  }
  assert.equal(q.mode, "versions"); assert(q.periodId);
  const { openedAt: _opened, ...head } = row(); void _opened;
  const p = { ...head, periodId: q.periodId, currentVersion, revision: 101 + currentVersion };
  const at = q.cursor?.kind === "versions" ? q.cursor.atVersion : currentVersion;
  const top = q.cursor?.kind === "versions" ? q.cursor.beforeVersion - 1 : currentVersion;
  const items = Array.from({ length: Math.min(20, top) }, (_, i) => ({ version: top - i, operationId: id(2000 + top - i), recordedAt: openedAt,
    artifactId: id(9000), sourceFingerprint: "a".repeat(64), artifactBytes: 4674, artifactSha256: "b".repeat(64) }));
  return { ok: true, moduleEnabled: false, data: { ...common, kind: "versions", period: p, items,
    nextCursor: top > 20 ? { ...scope, kind: "versions", periodId: q.periodId, atVersion: at, beforeVersion: items.at(-1)!.version } : null } };
}
const queryOf = (path: string) => parsePeriodClosureV2HttpQuery(`https://local.invalid${path}`);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function setup(fetch?: AttendanceApiFetch, patch: Partial<AttendanceRetentionPeriodsV2ClientOptions> = {}) {
  const calls: { path: string; init: RequestInit; query: Query }[] = [];
  const options: AttendanceRetentionPeriodsV2ClientOptions = { siteId: site, actorId: actor, workerId: worker,
    fromDate: "2026-09-10", throughDate: "2026-09-11", enabled: true, isCurrentAuth: () => true,
    apiFetch: async (path, init = {}) => { const query = queryOf(path); calls.push({ path, init, query }); return fetch ? fetch(path, init) : Response.json(wire(query)); }, ...patch };
  return { client: new AttendanceRetentionPeriodsV2Client(options), options, calls };
}
const open = async (x: ReturnType<typeof setup>) => { await x.client.list(); await x.client.openPeriod(row().periodId); };

test("constructor is local-only, exact frozen state and default-off makes every action inert", async () => {
  const x = setup(undefined, { enabled: false });
  assert.deepEqual(Object.keys(x.client.getSnapshot()).sort(), ["phase", "query", "result", "selectedPeriod", "message"].sort());
  assert(Object.isFrozen(x.client.getSnapshot())); assert.equal(x.calls.length, 0);
  await x.client.list(); await x.client.nextPeriods(); await x.client.openPeriod(row().periodId); await x.client.nextVersions();
  assert.equal(x.client.selectVersion(1), null); assert.equal(x.calls.length, 0); assert.equal(x.client.getSnapshot().result, null);
  for (const patch of [{ siteId: "../bad" }, { actorId: "bad" }, { workerId: "bad" }, { fromDate: "2026-01-01" }, { timeoutMs: 0 }, { timeoutMs: 12001 }])
    assert.throws(() => setup(undefined, patch));
});
test("25+1 pages are explicit GETs, replace rather than accumulate, and never fall back", async () => {
  const x = setup(); await x.client.list(); let s = x.client.getSnapshot();
  assert.equal(s.phase, "ready"); assert.equal(s.result?.kind, "list"); if (s.result?.kind !== "list") throw Error("list");
  assert.equal(s.result.items.length, 25); assert.equal(s.result.items[0].revision, 101); assert.equal(s.result.items[0].currentVersion, 21);
  assert(Object.isFrozen(s.result.items[0])); assert.equal(x.calls.length, 1);
  const cursor = s.result.nextCursor; await x.client.nextPeriods(); s = x.client.getSnapshot();
  assert.equal(s.result?.kind, "list"); if (s.result?.kind !== "list") throw Error("list");
  assert.equal(s.result.items.length, 1); assert.equal(s.result.items[0].periodId, id(1001)); assert.equal(s.result.nextCursor, null);
  assert.deepEqual(x.calls[1].query.cursor, cursor); await x.client.nextPeriods(); assert.equal(x.calls.length, 2);
  for (const call of x.calls) { assert(call.path.startsWith(RETENTION_PERIODS_V2_API + "?")); assert.equal(call.init.method, "GET");
    assert.equal(call.init.body, undefined); assert.equal(call.init.cache, "no-store"); assert.equal(call.init.redirect, "error"); assert.equal(call.query.access, "owner"); }
});
test("only a current list row opens versions using its saved frame, not intersecting search dates", async () => {
  const x = setup(); await x.client.openPeriod(row().periodId); assert.equal(x.calls.length, 0);
  await x.client.list(); await x.client.openPeriod(id(888)); assert.equal(x.calls.length, 1);
  await x.client.openPeriod(row().periodId); const q = x.calls[1].query;
  assert.equal(q.mode, "versions"); assert.equal(q.fromDate, row().fromDate); assert.equal(q.throughDate, row().throughDate);
  assert.equal(q.workerId, worker); assert.equal(q.periodId, row().periodId); assert.equal(q.version, null); assert.equal(q.operationId, null);
  assert.deepEqual(x.client.getSnapshot().selectedPeriod, row()); await x.client.openPeriod(row().periodId); assert.equal(x.calls.length, 2);
});
test("20+1 versions allow reused artifact, select only current page and emit exact frozen metadata without HTTP", async () => {
  const x = setup(); await open(x); const first = x.client.selectVersion(21), reused = x.client.selectVersion(20);
  assert(first); assert(reused); assert.equal(first.artifactId, reused.artifactId); assert.notEqual(first.version, reused.version);
  assert(Object.isFrozen(first)); assert.deepEqual(first, { siteId: site, actorId: actor, workerId: worker, employeeId: employee,
    employeeAuthUserId: employeeAuth, periodId: row().periodId, fromDate: row().fromDate, throughDate: row().throughDate,
    version: 21, artifactId: id(9000), sourceFingerprint: "a".repeat(64), artifactSha256: "b".repeat(64) });
  assert.equal(x.client.selectVersion(1), null); assert.equal(x.calls.length, 2);
  await x.client.nextVersions(); const s = x.client.getSnapshot(); assert.equal(s.result?.kind, "versions");
  if (s.result?.kind !== "versions") throw Error("versions");
  assert.equal(s.result.items.length, 1); assert.equal(s.result.items[0].version, 1); assert.equal(x.client.selectVersion(21), null);
  assert.equal(x.client.selectVersion(1)?.artifactId, id(9000)); await x.client.nextVersions(); assert.equal(x.calls.length, 3);
});
test("saved scope stays exact while legitimate revision/currentVersion growth is accepted", async () => {
  const x = setup(async path => Response.json(wire(queryOf(path), 22))); await open(x);
  assert.equal(x.client.getSnapshot().phase, "ready"); assert.equal(x.client.getSnapshot().selectedPeriod?.currentVersion, 21);
  assert.equal(x.client.selectVersion(22)?.version, 22); await x.client.nextVersions(); assert.equal(x.client.selectVersion(1)?.version, 1);
  for (const [key, value] of [["employeeId", id(700)], ["employeeAuthUserId", id(701)], ["workerId", id(702)], ["timeZone", "Europe/Madrid"],
    ["startAt", "2026-09-01T01:00:00.000000Z"], ["endAt", "2026-09-21T01:00:00.000000Z"], ["fromDate", "2026-09-02"], ["throughDate", "2026-09-19"]]) {
    const bad = setup(async path => { const data = wire(queryOf(path)); if (data.data.kind === "versions") Object.assign(data.data.period, { [key]: value }); return Response.json(data); });
    await open(bad); assert.equal(bad.client.getSnapshot().phase, "blocked", key); assert.equal(bad.client.getSnapshot().result, null); assert.equal(bad.client.selectVersion(21), null);
  }
});
test("bad owner/site/worker/kind/cursor and duplicate or partial pages fail closed", async () => {
  const mutations: ((value: Wire) => void)[] = [
    value => { value.data.actorId = id(999); }, value => { value.data.siteId = "99990238"; }, value => { value.data.workerId = id(999); },
    value => { Object.assign(value.data, { access: "self" }); }, value => { Object.assign(value.data, { extra: true }); },
    value => { if (value.data.kind === "list") value.data.items[1] = value.data.items[0]; },
    value => { if (value.data.kind === "list" && value.data.nextCursor) value.data.nextCursor.workerId = id(999); },
    value => { if (value.data.kind === "list") value.data.items.pop(); },
  ];
  for (const mutate of mutations) { const x = setup(async path => { const value = wire(queryOf(path)); mutate(value); return Response.json(value); });
    await x.client.list(); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().result, null); await x.client.nextPeriods(); assert.equal(x.calls.length, 1); }
  for (const kind of ["missing", "cursor", "duplicate"] as const) {
    const x = setup(async path => { const value = wire(queryOf(path)); if (value.data.kind === "versions") {
      if (kind === "missing") value.data.items.pop();
      if (kind === "cursor" && value.data.nextCursor?.kind === "versions") value.data.nextCursor.beforeVersion++;
      if (kind === "duplicate") value.data.items[1].operationId = value.data.items[0].operationId;
    } return Response.json(value); }); await open(x); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.selectVersion(21), null);
  }
});
test("wrong status/MIME/redirect/UTF8/duplicate JSON and 128KiB overflow clear results", async () => {
  const cases: (() => Response)[] = [() => Response.json({}, { status: 201 }), () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }),
    () => new Response("<html>"), () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    () => new Response('{"ok":true,"ok":false}', { headers: { "content-type": "application/json" } }),
    () => Response.json({ padding: "x".repeat(RETENTION_PERIODS_V2_BYTE_LIMIT) }),
    () => { const r = Response.json({}); Object.defineProperty(r, "redirected", { value: true }); return r; },
    () => Response.json({}, { headers: { "content-length": String(RETENTION_PERIODS_V2_BYTE_LIMIT + 1) } }),
    () => Response.json({}, { headers: { "content-length": "wrong" } }),
  ];
  for (const make of cases) { const x = setup(async () => make()); await x.client.list(); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.calls.length, 1); }
});
test("concurrent reads are rejected; pause cancels a delayed header and prevents publishing", async () => {
  const late = deferred<Response>(); let canceled = false;
  const x = setup(async () => late.promise), work = x.client.list();
  assert.equal(x.calls.length, 1); await x.client.list(); await x.client.nextPeriods(); await x.client.openPeriod(row().periodId); assert.equal(x.calls.length, 1);
  x.client.pause(); assert.equal(x.calls[0].init.signal?.aborted, true); await work;
  late.resolve(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "content-type": "application/json" } }));
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(canceled, true); assert.equal(x.client.getSnapshot().phase, "idle"); assert.equal(x.client.getSnapshot().result, null);
});
test("shared deadline covers ignored-signal headers and stalled bodies with no retry", async () => {
  let canceled = false;
  for (const kind of ["headers", "body"] as const) {
    const x = setup(async () => kind === "headers" ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ cancel() { canceled = true; } }),
      { headers: { "content-type": "application/json" } }), { timeoutMs: 15 });
    await x.client.list(); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.calls.length, 1); assert.equal(x.calls[0].init.signal?.aborted, true);
  }
  assert.equal(canceled, true);
});
test("auth changes during headers or a streamed body cannot publish or return a selection", async () => {
  for (const kind of ["headers", "body"] as const) {
    let current = true, stream!: ReadableStreamDefaultController<Uint8Array>; const late = deferred<Response>();
    const x = setup(async () => kind === "headers" ? late.promise : new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } }),
      { headers: { "content-type": "application/json" } }), { isCurrentAuth: () => current });
    const work = x.client.list(); await new Promise<void>(resolve => setImmediate(resolve)); current = false;
    const value = wire(x.calls[0].query); if (kind === "headers") late.resolve(Response.json(value)); else { stream.enqueue(new TextEncoder().encode(JSON.stringify(value))); stream.close(); }
    await work; assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().phase, "idle"); assert.equal(x.client.selectVersion(21), null);
  }
  let current = true; const x = setup(undefined, { isCurrentAuth: () => current }); await open(x); current = false;
  assert.equal(x.client.selectVersion(21), null); assert.equal(x.client.getSnapshot().selectedPeriod, null); assert.equal(x.calls.length, 2);
});
test("pause permits explicit fresh reads, disposed stays inert, and old generations do not replace a fresh page", async () => {
  const late = deferred<Response>(); let first = true;
  const x = setup(async path => { if (first) { first = false; return late.promise; } return Response.json(wire(queryOf(path))); });
  const old = x.client.list(); x.client.pause(); await old; await x.client.list(); const current = x.client.getSnapshot();
  late.resolve(Response.json(wire(x.calls[0].query))); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(x.client.getSnapshot(), current);
  x.client.dispose(); await x.client.list(); await x.client.nextPeriods(); assert.equal(x.calls.length, 2); assert.equal(x.client.getSnapshot().result, null);
});
test("hidden documents refuse reads and revoke an already selected version without storage access", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "document"); let isHidden = false;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  try { const x = setup(); await open(x); assert(x.client.selectVersion(21)); isHidden = true;
    assert.equal(x.client.selectVersion(21), null); assert.equal(x.client.getSnapshot().result, null); await x.client.list(); assert.equal(x.calls.length, 2);
    isHidden = false; await x.client.list(); assert.equal(x.calls.length, 3); assert.equal(x.client.getSnapshot().phase, "ready");
  } finally { if (old) Object.defineProperty(globalThis, "document", old); else Reflect.deleteProperty(globalThis, "document"); }
});
