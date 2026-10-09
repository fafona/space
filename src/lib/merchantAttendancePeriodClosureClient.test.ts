import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePeriodClosureClient, periodClosurePendingKey, type PeriodClosureClientOptions, type PeriodClosureStorage } from "./merchantAttendancePeriodClosureClient";
import { parsePeriodClosureHttpQuery, parsePeriodClosureResponse, PERIOD_CLOSURE_ERRORS, type PeriodClosureCommand, type PeriodClosureQuery } from "./merchantAttendancePeriodClosure";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { periodClosureUiId as id, periodClosureUiOwner as owner, periodClosureUiEmployee as employee, periodClosureUiAuth as auth,
  periodClosureUiPeriod as period, periodClosureUiOperation as operation, periodClosureUiFingerprint as fingerprint,
  periodClosureUiQuery as query, periodClosureUiCommand as command, periodClosureUiHttp as http } from "../../scripts/fixtures/attendance-period-closure-ui-model";

const reply = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function request(url: string, init: RequestInit = {}) { const body = init.method === "POST" ? JSON.parse(String(init.body)) as { query: PeriodClosureQuery; command: PeriodClosureCommand } : null;
  return { q: body?.query ?? parsePeriodClosureHttpQuery(`https://example.test${url}`), command: body?.command ?? null }; }
function setup(fetch?: AttendanceApiFetch, patch: Partial<PeriodClosureClientOptions> = {}) {
  const values = new Map<string, string>([["unrelated", "keep"]]), writes: string[] = [], calls: { url: string; init: RequestInit }[] = []; let ids = 0;
  const storage: PeriodClosureStorage = { getItem: key => values.get(key) ?? null, setItem: (key, raw) => { values.set(key, raw); writes.push(raw); }, removeItem: key => { values.delete(key); } };
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => { calls.push({ url: String(url), init }); if (fetch) return fetch(url, init);
    const { q, command } = request(String(url), init); return reply(http(q, command)); };
  const q = query(), options: PeriodClosureClientOptions = { siteId: q.siteId, access: "owner", actorId: owner, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate,
    enabled: true, apiFetch, storage: () => storage, randomId: () => ids++ === 0 ? operation : period, ...patch };
  return { client: new AttendancePeriodClosureClient(options), options, storage, values, writes, calls };
}
const ready = async (c: AttendancePeriodClosureClient) => { await c.initialize(); await c.preview(); };
const saved = () => ({ format: 1, actorId: owner, employeeId: employee, employeeAuthUserId: auth, query: query("detail"), command: command() });
const seed = (x: ReturnType<typeof setup>) => { const raw = JSON.stringify(saved()); x.values.set(x.client.storageKey, raw); return raw; };

test("shared fixture validates saved raw/corrected/missing values for owner and employee identity, not employee-as-Auth", () => {
  for (const access of ["owner", "self"] as const) for (const mode of ["list", "preview", "detail", "recover", "export"] as const) {
    const q = query(mode, access), r = parsePeriodClosureResponse(http(q), q, access === "owner" ? { ownerId: owner } : { employeeId: employee });
    assert.equal(r.data.actorId, access === "owner" ? owner : auth);
    if (r.data.kind === "detail") { assert.equal(r.data.artifact!.report.missing.length, 1); assert(r.data.artifact!.report.base.rows[0].correction); }
  }
});
test("initialize is local-only, exact scoped key, no source/report persisted and frozen state", async () => {
  const x = setup(); await x.client.initialize(); assert.equal(x.calls.length, 0); assert.equal(x.writes.length, 0); assert(Object.isFrozen(x.client.getSnapshot()));
  assert.equal(x.client.storageKey, `faolla:attendance:period-closures:v1:${query().siteId}:owner:${owner}`); assert.equal(x.values.get("unrelated"), "keep");
  assert.notEqual(x.client.storageKey, periodClosurePendingKey(query().siteId, "self", owner));
  for (const patch of [{ enabled: "1" }, { timeoutMs: 0 }, { timeoutMs: 12001 }, { actorId: "bad" }, { access: "manager" }, { throughDate: "2026-10-03" }])
    assert.throws(() => new AttendancePeriodClosureClient({ ...x.options, ...patch } as PeriodClosureClientOptions));
});
test("uninitialized/invalid/flag-off preview does not fetch; flag-off existing detail still independently authorizes", async () => {
  const x = setup(); await x.client.preview(); await x.client.initialize(); await x.client.detail("bad"); assert.equal(x.calls.length, 0);
  const y = setup(undefined, { enabled: false }); await ready(y.client); assert.equal(y.calls.length, 0); await y.client.detail(period); assert.equal(y.calls.length, 1);
  await y.client.submit("seal", "no"); assert.equal(y.calls.length, 1);
});
test("new send persists exact small intent before a single POST and settles only the complete original receipt", async () => {
  const x = setup(async (url, init) => { const r = request(String(url), init); if (r.command) assert.deepEqual(JSON.parse(x.values.get(x.client.storageKey)!), saved()); return reply(http(r.q, r.command)); });
  await ready(x.client); await x.client.submit("send", command().reason);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]); assert.deepEqual(request(x.calls[1].url, x.calls[1].init).command, command());
  assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.values.get(x.client.storageKey), undefined); assert.equal(x.client.getSnapshot().phase, "ready");
  assert(Object.isFrozen(x.client.getSnapshot().result)); assert(x.writes.every(v => v.length < 8192 && !v.includes('"report"') && !v.includes('"source"')));
});
test("existing preview CAS comes from same-read head, not revision zero", async () => {
  const x = setup(); await x.client.initialize(); await x.client.preview(period); await x.client.submit("send", "Updated source");
  const c = request(x.calls.at(-1)!.url, x.calls.at(-1)!.init).command!; assert.equal(c.periodId, period); assert.equal(c.expectedRevision, 1); assert.equal(c.expectedVersion, 1);
  assert.equal(x.client.getSnapshot().pending, null);
});
test("unfinished period preview, paused module and wrong role cannot POST", async () => {
  for (const mutate of [(r: ReturnType<typeof http>) => { if (r.data.kind === "preview") r.data.preview.blockers.push("period_in_progress"); }, (r: ReturnType<typeof http>) => { r.moduleEnabled = false; }]) {
    const x = setup(async () => { const h = http(); mutate(h); return reply(h); }); await ready(x.client); await x.client.submit("send", "no"); assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0);
  }
  const ownerClient = setup(); await ready(ownerClient.client); await ownerClient.client.submit("confirm", "no"); assert.equal(ownerClient.calls.length, 1);
  const self = setup(undefined, { access: "self", actorId: employee }); await self.client.initialize(); await self.client.detail(period); await self.client.submit("seal", "no"); assert.equal(self.calls.length, 1);
});
test("complete preview with unresolved sessions, applications and review may be sent, but unfinished period still forbids send", async () => {
  for (const blockers of [["open_session"], ["pending_correction", "pending_missing", "pending_leave", "unresolved_review"], ["open_session", "period_in_progress"]]) {
    const x = setup(async (url, init) => { const r = request(String(url), init), h = http(r.q, r.command); if (h.data.kind === "preview") h.data.preview.blockers = blockers; return reply(h); });
    await ready(x.client); await x.client.submit("send", command().reason);
    if (blockers.includes("period_in_progress")) { assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0); }
    else { assert.equal(x.calls.length, 2); assert.equal(x.calls[1].init.method, "POST"); assert.equal(x.client.getSnapshot().pending, null); }
  }
});
test("self confirm pins current saved fingerprint; historical version cannot mutate", async () => {
  const x = setup(undefined, { access: "self", actorId: employee }); await x.client.initialize(); await x.client.detail(period); await x.client.submit("confirm", "Reviewed version");
  const c = request(x.calls.at(-1)!.url, x.calls.at(-1)!.init).command!; assert.equal(c.expectedFingerprint, fingerprint); assert.equal(c.expectedVersion, 1); assert.equal(x.client.getSnapshot().pending, null);
  const y = setup(async (url, init) => { const { q } = request(String(url), init), h = http(q); if (h.data.kind === "detail") { h.data.period.currentVersion = 2; h.data.artifactVersion = 1; } return reply(h); });
  await y.client.initialize(); await y.client.detail(period, 1); await y.client.submit("reopen", "no"); assert.equal(y.calls.length, 1);
});
test("owner may reasoned-reopen sealed version with both creation flags off; other new actions stay closed", async () => {
  const x = setup(async (url, init) => { const r = request(String(url), init), h = http(r.q, r.command); h.moduleEnabled = false;
    if (h.data.kind === "detail") { h.data.period.state = r.command ? "open" : "sealed"; h.data.period.sealed = !r.command; h.data.period.confirmedVersion = 1; } return reply(h); }, { enabled: false });
  await x.client.initialize(); await x.client.detail(period); await x.client.submit("seal", "no"); assert.equal(x.calls.length, 1);
  await x.client.submit("reopen", "Reasoned owner reopening while module paused"); assert.equal(x.calls.length, 2); assert.equal(request(x.calls[1].url, x.calls[1].init).command!.action, "reopen"); assert.equal(x.client.getSnapshot().pending, null);
});
test("lost POST keeps original; reload and flag-off recovery perform only explicit same-operation GET", async () => {
  const x = setup(async (url, init) => { if (init?.method === "POST") throw Error("lost"); return reply(http(request(String(url), init).q)); });
  await ready(x.client); await x.client.submit("send", command().reason); const raw = x.values.get(x.client.storageKey); assert(raw); assert.equal(x.client.getSnapshot().phase, "unconfirmed");
  const calls: RequestInit[] = [], reloaded = new AttendancePeriodClosureClient({ ...x.options, enabled: false, apiFetch: async (url, init = {}) => { calls.push(init); return reply(http(request(String(url), init).q)); } });
  await reloaded.initialize(); assert.equal(calls.length, 0); await reloaded.submit("send", "never"); await reloaded.recover(); assert.deepEqual(calls.map(c => c.method), ["GET"]);
  assert.equal(reloaded.getSnapshot().pending, null); assert.equal(x.values.get(x.client.storageKey), undefined);
});
test("GET not-found is never absence proof and cannot retire unknown pending or start a new operation", async () => {
  const x = setup(async () => reply({ ok: false, error: "attendance_operation_not_found" }, 404)), raw = seed(x); await x.client.initialize();
  await x.client.recover(); await x.client.endAttempt(); await x.client.preview(); await x.client.submit("send", "new");
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().definitiveRejection, null);
});
test("only explicit user retirement after exact current POST business rejection CAS clears; never auto-clears", async () => {
  for (const code of ["attendance_version_conflict", "attendance_period_source_changed", "attendance_period_blocked", "attendance_period_sealed", "attendance_period_not_confirmed", "attendance_period_overlap", "attendance_period_limit"]) {
    const x = setup(async (url, init) => init?.method === "POST" ? reply({ ok: false, error: code }, PERIOD_CLOSURE_ERRORS[code]) : reply(http(request(String(url), init).q)));
    await ready(x.client); await x.client.submit("send", command().reason); assert(x.values.get(x.client.storageKey)); assert.equal(x.client.getSnapshot().definitiveRejection, code);
    const count = x.calls.length; await x.client.endAttempt(); assert.equal(x.calls.length, count); assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.client.getSnapshot().result, null);
    await x.client.submit("send", "no implicit re-preview"); assert.equal(x.calls.length, count);
  }
});
test("auth/unknown/malformed/wrong-status rejections and reload do not authorize local retirement", async () => {
  for (const [code, status, extra] of [["attendance_access_denied", 403, false], ["attendance_unavailable", 503, false], ["attendance_operation_conflict", 409, false],
    ["attendance_operation_not_found", 404, false], ["attendance_version_conflict", 400, false], ["attendance_version_conflict", 409, true]] as const) {
    const x = setup(async (url, init) => init?.method === "POST" ? reply({ ok: false, error: code, ...(extra ? { debug: "not exact" } : {}) }, status) : reply(http(request(String(url), init).q)));
    await ready(x.client); await x.client.submit("send", command().reason); const raw = x.values.get(x.client.storageKey); await x.client.endAttempt(); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().definitiveRejection, null);
  }
  const x = setup(async (url, init) => init?.method === "POST" ? reply({ ok: false, error: "attendance_version_conflict" }, 409) : reply(http(request(String(url), init).q)));
  await ready(x.client); await x.client.submit("send", command().reason); await x.client.initialize(); assert.equal(x.client.getSnapshot().definitiveRejection, null); await x.client.endAttempt(); assert(x.values.get(x.client.storageKey));
});
test("pending dual identity, operation and full command are required before recovery settlement", async () => {
  for (const mutate of [(h: ReturnType<typeof http>) => { if (h.data.kind === "detail") h.data.period.employeeAuthUserId = id(99); },
    (h: ReturnType<typeof http>) => { if (h.data.kind === "detail") h.data.operation!.command.reason = "different"; },
    (h: ReturnType<typeof http>) => { if (h.data.kind === "detail") h.data.operation!.operationId = id(901); }]) {
    const x = setup(async () => { const h = http(query("recover")); mutate(h); return reply(h); }), raw = seed(x); await x.client.initialize(); await x.client.recover();
    assert.equal(x.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending); assert.equal(x.client.getSnapshot().result, null);
  }
});
test("bounded exact local envelope refuses extra keys, malformed bytes and wrong actor without deleting", async () => {
  for (const raw of ["{", JSON.stringify({ ...saved(), actorId: id(77) }), JSON.stringify({ ...saved(), report: {} }), "x".repeat(8193)]) {
    const x = setup(); x.values.set(x.client.storageKey, raw); await x.client.initialize(); await x.client.preview(); assert.equal(x.calls.length, 0); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().phase, "blocked");
  }
});
test("same actor may recover original worker/date query, but current context cannot overwrite it", async () => {
  const x = setup(undefined, { workerId: id(44), fromDate: "2026-09-04", throughDate: "2026-09-05" }); seed(x); await x.client.initialize(); await x.client.list(); assert.equal(x.calls.length, 0);
  await x.client.recover(); const q = request(x.calls[0].url, x.calls[0].init).q; assert.equal(q.workerId, query().workerId); assert.equal(q.fromDate, query().fromDate); assert.equal(x.client.getSnapshot().pending, null);
  await x.client.submit("respond", "Cannot use another navigation scope"); assert.equal(x.calls.length, 1);
});
test("synchronous publish pause before or after persistence prevents late POST", async () => {
  for (const hasPending of [false, true]) {
    const x = setup(); await ready(x.client); let once = false; x.client.subscribe(() => { const s = x.client.getSnapshot(); if (!once && s.phase === "saving" && !!s.pending === hasPending) { once = true; x.client.pause(); } });
    await x.client.submit("send", command().reason); assert(once); assert.equal(x.calls.length, 1); assert.equal(!!x.client.getSnapshot().pending, hasPending); assert.equal(x.client.getSnapshot().result, null);
  }
});
test("storage and operation-ID synchronous reentry cannot continue writing", async () => {
  const x = setup(); await ready(x.client); const base = x.storage.setItem; x.storage.setItem = (key, raw) => { base(key, raw); x.client.pause(); }; await x.client.submit("send", command().reason); assert.equal(x.calls.length, 1); assert(x.values.get(x.client.storageKey));
  const y = setup(undefined, { randomId: () => { y.client.pause(); return operation; } }); await ready(y.client); await y.client.submit("send", command().reason); assert.equal(y.calls.length, 1); assert.equal(y.writes.length, 0);
});
test("storage replacement is never erased on successful old receipt or explicit retirement", async () => {
  const x = setup(async (url, init) => { const r = request(String(url), init); if (r.command) x.values.set(x.client.storageKey, "replacement"); return reply(http(r.q, r.command)); });
  await ready(x.client); await x.client.submit("send", command().reason); assert.equal(x.values.get(x.client.storageKey), "replacement"); assert.equal(x.client.getSnapshot().result, null);
  const y = setup(async (url, init) => init?.method === "POST" ? reply({ ok: false, error: "attendance_version_conflict" }, 409) : reply(http(request(String(url), init).q)));
  await ready(y.client); await y.client.submit("send", command().reason); y.values.set(y.client.storageKey, "replacement"); await y.client.endAttempt(); assert.equal(y.values.get(y.client.storageKey), "replacement");
});
test("late successful POST or late definitive rejection after pause cannot settle or authorize retirement", async () => {
  for (const rejected of [false, true]) {
    const late = deferred<Response>(); const x = setup(async (url, init) => init?.method === "POST" ? late.promise : reply(http(request(String(url), init).q))); await ready(x.client);
    const run = x.client.submit("send", command().reason); await tick(); x.client.pause(); const raw = x.values.get(x.client.storageKey);
    late.resolve(rejected ? reply({ ok: false, error: "attendance_version_conflict" }, 409) : reply(http(query("detail"), command()))); await run;
    assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().definitiveRejection, null);
  }
});
test("total deadline covers hung body and cancels without waiting; fatal UTF8 and duplicate envelopes are rejected", async () => {
  let cancelled = false;
  const x = setup(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }), { timeoutMs: 20 });
  await ready(x.client); assert.equal(x.client.getSnapshot().phase, "blocked"); assert(cancelled);
  for (const body of [new Uint8Array([0xff]), new TextEncoder().encode('{"ok":true,"ok":true}')]) {
    const y = setup(async () => new Response(body, { headers: { "content-type": "application/json" } })); await ready(y.client); assert.equal(y.client.getSnapshot().result, null); assert.equal(y.client.getSnapshot().phase, "blocked");
  }
});
test("export is one fixed-version reauthorization GET, with saved values and no dynamic export endpoint", async () => {
  const x = setup(); await x.client.initialize(); let delivered = 0; await x.client.exportVersion(period, 1, fingerprint, (artifact, signal, current) => {
    assert.equal(artifact.sourceFingerprint, fingerprint); assert.equal(artifact.report.missing.length, 1); assert(!signal.aborted); assert(current()); delivered++;
  }); assert.equal(delivered, 1); assert.equal(x.calls.length, 1); assert.equal(request(x.calls[0].url, x.calls[0].init).q.mode, "export"); assert.equal(x.calls[0].init.method, "GET");
});
test("export wrong version, fingerprint, authorization error and lifetime loss deliver nothing", async () => {
  for (const mutate of [(h: ReturnType<typeof http>) => { if (h.data.kind === "detail") h.data.artifactVersion = null; }, (h: ReturnType<typeof http>) => { if (h.data.kind === "detail") h.data.artifact!.sourceFingerprint = "b".repeat(64); }]) {
    const x = setup(async () => { const h = http(query("export")); mutate(h); return reply(h); }); await x.client.initialize(); let called = false; await x.client.exportVersion(period, 1, fingerprint, () => { called = true; }); assert(!called);
  }
  const late = deferred<Response>(), x = setup(async () => late.promise); await x.client.initialize(); let called = false;
  const run = x.client.exportVersion(period, 1, fingerprint, () => { called = true; }); await tick(); x.client.pause(); late.resolve(reply(http(query("export")))); await run; assert(!called);
});
