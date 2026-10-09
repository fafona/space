import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePeriodClosureV2Client, PERIOD_CLOSURE_V2_CLIENT_API, type PeriodClosureV2ClientOptions, type PeriodClosureV2Pending } from "./merchantAttendancePeriodClosureV2Client";
import { periodClosurePendingKey, type PeriodClosureStorage } from "./merchantAttendancePeriodClosureClient";
import { parsePeriodClosureV2HttpQuery, type PeriodClosureV2Query as Query, type PeriodClosureV2Command as Command, type PeriodClosureV2Response as ResponseWire,
  type PeriodClosureV2Result as Result, type PeriodClosureV2Cursor as Cursor } from "./merchantAttendancePeriodClosureV2";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { periodClosureUiId as id, periodClosureUiOwner as owner, periodClosureUiEmployee as employee, periodClosureUiAuth as auth,
  periodClosureUiPeriod as period, periodClosureUiOperation as operation, periodClosureUiQuery as oldQuery,
  periodClosureUiCommand as oldCommand, periodClosureUiArtifact as artifact, periodClosureUiSummary as summary,
  periodClosureUiEntry as oldEntry } from "../../scripts/fixtures/attendance-period-closure-ui-model";

const query = (mode: Query["mode"] = "detail", access: Query["access"] = "owner"): Query => ({ ...oldQuery(mode === "history" || mode === "versions" ? "detail" : mode, access), mode, cursor: null });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function request(url: string, init: RequestInit = {}) { const c = init.method === "POST" ? JSON.parse(String(init.body)) as { query: Query; command: Command } : null;
  return { q: c?.query ?? parsePeriodClosureV2HttpQuery("https://example.test" + url), command: c?.command ?? null }; }
function wire(q: Query, c: Command | null = null, recovered: Command | null = null): ResponseWire {
  const a = artifact(), p = { ...summary(), periodId: q.periodId ?? period, revision: 101, currentVersion: 21 };
  const common = { protocol: "period-closure-v2" as const, siteId: q.siteId, workerId: q.workerId, actorId: q.access === "owner" ? owner : auth, access: q.access, readAt: "2026-09-11T12:00:00.000001Z" };
  let data: Result;
  if (q.mode === "list") data = { ...common, kind: "list", items: [{ ...p, openedAt: "2026-09-11T10:00:00.000001Z" }], nextCursor: null };
  else if (q.mode === "preview") data = { ...common, kind: "preview", preview: { artifact: a, blockers: [], period: q.periodId ? p : null } };
  else if (q.mode === "history") {
    const top = q.cursor?.kind === "history" ? q.cursor.beforeRevision - 1 : p.revision;
    const items = Array.from({ length: Math.min(50, top) }, (_, i) => oldEntry({ ...oldCommand(), operationId: id(4000 + top - i), action: top - i === 1 ? "send" : "respond", expectedRevision: top - i - 1, expectedVersion: top - i === 1 ? 0 : 1 }));
    const nextCursor = top > 50 ? { kind: "history", siteId: q.siteId, access: q.access, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate, periodId: p.periodId,
      atRevision: q.cursor?.kind === "history" ? q.cursor.atRevision : p.revision, beforeRevision: items.at(-1)!.revision } as Cursor : null;
    data = { ...common, kind: "history", period: p, items, nextCursor };
  } else if (q.mode === "versions") {
    const top = q.cursor?.kind === "versions" ? q.cursor.beforeVersion - 1 : p.currentVersion;
    const items = Array.from({ length: Math.min(20, top) }, (_, i) => ({ version: top - i, operationId: id(5000 + top - i), recordedAt: "2026-09-11T10:00:00.000001Z", artifactId: id(999), sourceFingerprint: "a".repeat(64), artifactBytes: 1000, artifactSha256: "b".repeat(64) }));
    const nextCursor = top > 20 ? { kind: "versions", siteId: q.siteId, access: q.access, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate, periodId: p.periodId,
      atVersion: q.cursor?.kind === "versions" ? q.cursor.atVersion : p.currentVersion, beforeVersion: items.at(-1)!.version } as Cursor : null;
    data = { ...common, kind: "versions", period: p, items, nextCursor };
  } else {
    const saved = c ?? (q.mode === "recover" ? recovered ?? oldCommand() : null), op = saved ? oldEntry(saved) : null;
    if (c) { p.revision = op!.revision; p.currentVersion = op!.version; }
    else if (op) { p.revision = Math.max(p.revision, op.revision); p.currentVersion = Math.max(p.currentVersion, op.version); }
    data = { ...common, kind: "detail", period: p, artifact: a, artifactVersion: op?.version ?? q.version ?? p.currentVersion,
      sourceChanged: q.mode === "detail" && q.version === null && !c ? false : null, operation: op, replayed: q.mode === "recover" };
  }
  return { ok: true, moduleEnabled: true, data };
}
function setup(fetch?: AttendanceApiFetch, patch: Partial<PeriodClosureV2ClientOptions> = {}) {
  const values = new Map<string, string>([["unrelated", "keep"]]), writes: { method: string; key: string; value?: string }[] = [], calls: { url: string; init: RequestInit }[] = [];
  const storage: PeriodClosureStorage = { getItem: k => values.get(k) ?? null, setItem: (key, value) => { values.set(key, value); writes.push({ method: "set", key, value }); }, removeItem: key => { values.delete(key); writes.push({ method: "remove", key }); } };
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => { calls.push({ url: String(url), init }); if (fetch) return fetch(url, init); const r = request(String(url), init); return response(wire(r.q, r.command)); };
  const q = query(); let n = 0;
  const options: PeriodClosureV2ClientOptions = { siteId: q.siteId, access: "owner", actorId: owner, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate,
    enabled: true, apiFetch, storage: () => storage, randomId: () => n++ === 0 ? operation : period, ...patch };
  return { client: new AttendancePeriodClosureV2Client(options), options, storage, values, writes, calls };
}
const legacy = (access: "owner" | "self" = "owner"): PeriodClosureV2Pending => ({ format: 1, actorId: access === "owner" ? owner : employee, employeeId: employee, employeeAuthUserId: auth,
  query: oldQuery("detail", access), command: access === "owner" ? oldCommand() : { ...oldCommand(), action: "confirm", expectedRevision: 1, expectedVersion: 1 } });
const seed = (x: ReturnType<typeof setup>, pending = legacy()) => { const raw = JSON.stringify(pending, null, 2); x.values.set(x.client.storageKey, raw); return raw; };
const ready = async (c: AttendancePeriodClosureV2Client, periodId: string | null = null) => { await c.initialize(); await c.preview(periodId); };

test("one exact v1/v2 slot, local-only initialize and frozen state", async () => {
  const x = setup(); await x.client.initialize(); assert.equal(x.client.storageKey, periodClosurePendingKey(x.options.siteId, "owner", owner));
  assert.equal(x.calls.length, 0); assert.equal(x.writes.length, 0); assert.equal(x.values.get("unrelated"), "keep"); assert(Object.isFrozen(x.client.getSnapshot()));
});
test("old format1 bytes are neither migrated nor rewritten; featureoff recovery sends only one v2 GET", async () => {
  const x = setup(undefined, { enabled: false }); const raw = seed(x); await x.client.initialize(); await x.client.submit("send", "never");
  assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.writes.length, 0); assert.equal(x.calls.length, 0);
  await x.client.recover(); assert.equal(x.calls.length, 1); assert.equal(x.calls[0].init.method, "GET"); assert(x.calls[0].url.startsWith(PERIOD_CLOSURE_V2_CLIENT_API + "?"));
  assert.equal(request(x.calls[0].url).q.operationId, operation); assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.values.has(x.client.storageKey), false);
  assert.equal(x.writes.filter(w => w.method === "set").length, 0); assert.equal(x.client.getSnapshot().navigation, null);
});
test("old self slot is employee-scoped but receipt author must be the saved Auth", async () => {
  const p = legacy("self"), x = setup(async (url, init) => { const r = request(String(url), init); return response(wire(r.q, r.command, p.command)); }, { access: "self", actorId: employee, enabled: false });
  seed(x, p); await x.client.initialize(); await x.client.recover(); assert.equal(x.client.getSnapshot().pending, null);
  const r = x.client.getSnapshot().result; assert.equal(r?.actorId, auth); assert(x.client.storageKey.endsWith(":self:" + employee));
});
test("not-found, unauthorized, protocol upgrade and wrong status are all unknown GET outcomes", async () => {
  for (const [error, status] of [["attendance_operation_not_found", 404], ["attendance_access_denied", 403], ["attendance_period_protocol_required", 409], ["attendance_period_storage_limit", 422], ["attendance_period_storage_limit", 409]] as const) {
    const x = setup(async () => response({ ok: false, error }, status), { enabled: false }), raw = seed(x); await x.client.initialize(); await x.client.recover(); await x.client.endAttempt();
    assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().definitiveRejection, null); assert.equal(x.client.getSnapshot().result, null);
  }
});
test("mismatched complete command, operation or saved dual identity never clears pending", async () => {
  for (const mutate of [(r: ResponseWire) => { if (r.data.kind === "detail" && r.data.operation) { r.data.operation.command.reason = "changed"; r.data.operation.reason = "changed"; } },
    (r: ResponseWire) => { if (r.data.kind === "detail" && r.data.operation) { r.data.operation.operationId = id(999); r.data.operation.command.operationId = id(999); } },
    (r: ResponseWire) => { if (r.data.kind === "detail") { r.data.period.employeeAuthUserId = id(888); r.data.artifact!.worker.employeeAuthUserId = id(888); } }]) {
    const x = setup(async (url, init) => { const rq = request(String(url), init), value = wire(rq.q); mutate(value); return response(value); }), raw = seed(x);
    await x.client.initialize(); await x.client.recover(); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().phase, "unconfirmed");
  }
});
test("wrong actor/extra key/malformed existing slot blocks rather than overwrites or scans", async () => {
  for (const raw of ["{bad", JSON.stringify({ ...legacy(), actorId: id(77) }), JSON.stringify({ ...legacy(), report: {} })]) {
    const x = setup(); x.values.set(x.client.storageKey, raw); await ready(x.client); await x.client.submit("send", "no");
    assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.writes.length, 0); assert.equal(x.calls.length, 0);
  }
});
test("fresh continuation gets same-read high CAS and stores format2 before one POST", async () => {
  const x = setup(async (url, init) => { const r = request(String(url), init); if (r.command) { const p = JSON.parse(x.values.get(x.client.storageKey)!); assert.equal(p.format, 2); assert.deepEqual(p.command, r.command); } return response(wire(r.q, r.command)); });
  await ready(x.client, period); await x.client.submit("send", "New source version");
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]); const c = request(x.calls[1].url, x.calls[1].init).command!;
  assert.equal(c.expectedRevision, 101); assert.equal(c.expectedVersion, 21); assert.equal(x.client.getSnapshot().pending, null);
  assert(x.writes.filter(w => w.method === "set").every(w => w.value!.length <= 8192 && !w.value!.includes('"artifact"') && !w.value!.includes('"source"')));
  await x.client.submit("reopen", "Receipt cannot write"); assert.equal(x.calls.length, 2);
});
test("lost new POST retains exact intent and reload featureoff never automatically resends", async () => {
  let command: Command | null = null;
  const x = setup(async (url, init) => { const r = request(String(url), init); if (r.command) { command = r.command; throw Error("lost"); } return response(wire(r.q)); });
  await ready(x.client, period); await x.client.submit("send", "Lost continuation"); const raw = x.values.get(x.client.storageKey); assert(raw); assert(command);
  const calls: RequestInit[] = [], c = new AttendancePeriodClosureV2Client({ ...x.options, enabled: false, apiFetch: async (url, init = {}) => { calls.push(init); const rq = request(String(url), init); return response(wire(rq.q, null, command)); } });
  await c.initialize(); assert.equal(calls.length, 0); await c.recover(); assert.deepEqual(calls.map(x => x.method), ["GET"]); assert.equal(c.getSnapshot().pending, null);
});
test("only current exact POST rejection permits explicit retirement, not an upgrade error", async () => {
  for (const error of ["attendance_period_storage_limit", "attendance_period_protocol_required"]) {
    const x = setup(async (url, init) => { const r = request(String(url), init); return r.command ? response({ ok: false, error }, error === "attendance_period_storage_limit" ? 422 : 409) : response(wire(r.q)); });
    await ready(x.client); await x.client.submit("send", "Budget test"); const raw = x.values.get(x.client.storageKey); assert(raw);
    assert.equal(x.client.getSnapshot().definitiveRejection, error === "attendance_period_storage_limit" ? error : null); await x.client.endAttempt();
    assert.equal(x.values.get(x.client.storageKey), error === "attendance_period_storage_limit" ? undefined : raw);
  }
});
test("list explicitly selects saved intersecting dates; arbitrary or stale item cannot navigate", async () => {
  const x = setup(undefined, { fromDate: "2026-08-31", throughDate: "2026-09-02" }); await x.client.initialize(); await x.client.list();
  const r = x.client.getSnapshot().result; assert.equal(r?.kind, "list"); if (r?.kind !== "list") return;
  await x.client.selectPeriod({ ...r.items[0], periodId: id(99) }); assert.equal(x.calls.length, 1);
  await x.client.selectPeriod(r.items[0]); assert.equal(x.calls.length, 2); const rq = request(x.calls[1].url).q;
  assert.equal(rq.fromDate, "2026-09-01"); assert.equal(rq.throughDate, "2026-09-03"); assert.deepEqual(x.client.getSnapshot().navigation, { workerId: rq.workerId, fromDate: rq.fromDate, throughDate: rq.throughDate, periodId: period });
  await x.client.preview(period); await x.client.submit("send", "Keep selected frame"); await x.client.detail(period);
  assert.equal(request(x.calls.at(-1)!.url).q.fromDate, "2026-09-01"); assert.equal(request(x.calls.at(-1)!.url).q.throughDate, "2026-09-03");
});
test("history/version pages fetch once, never accumulate or authorize mutations", async () => {
  const x = setup(); await x.client.initialize(); await x.client.detail(period); await x.client.history(period);
  const first = x.client.getSnapshot().result; assert.equal(first?.kind, "history"); if (first?.kind !== "history") return;
  assert.equal(first.items.length, 50); assert.equal(x.calls.length, 2); await x.client.submit("respond", "Page no write"); assert.equal(x.calls.length, 2);
  await x.client.history(period, first.nextCursor); const second = x.client.getSnapshot().result;
  assert.equal(second?.kind, "history"); if (second?.kind !== "history") return; assert.equal(second.items.length, 50); assert.equal(second.items[0].revision, 51);
  await x.client.versions(period); const vs = x.client.getSnapshot().result; assert.equal(vs?.kind, "versions"); if (vs?.kind !== "versions") return;
  await x.client.versions(period, vs.nextCursor); const tail = x.client.getSnapshot().result; assert.equal(tail?.kind, "versions"); if (tail?.kind === "versions") assert.equal(tail.items.length, 1);
  assert(x.calls.every(c => c.init.method === "GET")); assert.equal(x.writes.length, 0);
});
test("legacy recovery for another window never supplies write/export navigation", async () => {
  const x = setup(undefined, { fromDate: "2026-09-10", throughDate: "2026-09-12" }); seed(x); await x.client.initialize(); await x.client.recover();
  assert.equal(request(x.calls[0].url).q.fromDate, "2026-09-01"); assert.equal(x.client.getSnapshot().navigation, null);
  let delivered = 0; await x.client.submit("reopen", "not authorized by receipt"); await x.client.exportVersion(period, 1, "a".repeat(64), () => { delivered++; });
  assert.equal(x.calls.length, 1); assert.equal(delivered, 0);
});
test("fixed detail and export cannot authorize new writes; fresh detail is required", async () => {
  const x = setup(); await x.client.initialize(); await x.client.detail(period, 21); await x.client.submit("reopen", "No fixed write"); assert.equal(x.calls.length, 1);
  let delivered = 0; await x.client.exportVersion(period, 21, "a".repeat(64), (_a, _s, current) => { assert(current()); delivered++; }); assert.equal(delivered, 1);
  await x.client.submit("reopen", "No export write"); assert.equal(x.calls.length, 2); await x.client.detail(period); await x.client.submit("reopen", "Explicit fresh"); assert.equal(x.calls.at(-1)!.init.method, "POST");
});
test("unavailable current source cannot grant self confirm and owner seal", async () => {
  for (const access of ["owner", "self"] as const) {
    const x = setup(async (url, init) => { const rq = request(String(url), init), r = wire(rq.q); if (r.data.kind === "detail") r.data.sourceChanged = null; return response(r); }, { access, actorId: access === "owner" ? owner : employee });
    await x.client.initialize(); await x.client.detail(period); await x.client.submit(access === "owner" ? "seal" : "confirm", "Not freshly checked"); assert.equal(x.calls.length, 1);
  }
});
test("pause during GET and stale receipt cannot publish or clear the original slot", async () => {
  const hold = deferred<Response>(), x = setup(async () => hold.promise), raw = seed(x); await x.client.initialize(); const pending = x.client.recover();
  x.client.pause(); hold.resolve(response(wire({ ...query("recover"), operationId: operation }, null, oldCommand()))); await pending;
  assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().navigation, null);
});
test("late POST rejection after pause cannot expose retirement controls or delete its intent", async () => {
  const hold = deferred<Response>();
  const x = setup(async (url, init) => { const rq = request(String(url), init); return rq.command ? hold.promise : response(wire(rq.q)); });
  await ready(x.client); const pending = x.client.submit("send", "Pause after persistence");
  const raw = x.values.get(x.client.storageKey); assert(raw); x.client.pause();
  hold.resolve(response({ ok: false, error: "attendance_period_storage_limit" }, 422)); await pending;
  await x.client.endAttempt(); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().definitiveRejection, null); assert.equal(x.client.getSnapshot().result, null);
});
test("storage CAS replacement while receipt is in flight cannot be removed", async () => {
  const hold = deferred<Response>(), x = setup(async () => hold.promise); seed(x); await x.client.initialize(); const pending = x.client.recover();
  const replacement = JSON.stringify({ ...legacy(), command: { ...oldCommand(), operationId: id(987) } }); x.values.set(x.client.storageKey, replacement);
  hold.resolve(response(wire(query("recover"), null, oldCommand()))); await pending;
  assert.equal(x.values.get(x.client.storageKey), replacement); assert.equal(x.writes.filter(w => w.method === "remove").length, 0);
});
test("synchronous observers can pause before GET or before local persistence without a late write", async () => {
  const x = setup(); await x.client.initialize(); const stop = x.client.subscribe(() => { if (x.client.getSnapshot().phase === "loading") x.client.pause(); });
  await x.client.detail(period); stop(); assert.equal(x.calls.length, 0);
  await x.client.preview(); const stopSave = x.client.subscribe(() => { if (x.client.getSnapshot().phase === "saving") x.client.pause(); });
  await x.client.submit("send", "Observer pause"); stopSave(); assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0);
});
test("hide blocks initialization/GET and keeps pending bytes untouched", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"); Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: true } });
  try { const x = setup(), raw = seed(x); await x.client.initialize(); await x.client.recover(); assert.equal(x.calls.length, 0); assert.equal(x.values.get(x.client.storageKey), raw); }
  finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});
test("timeout and malformed/oversized/duplicate JSON remain unknown with no late result", async () => {
  const timeout = setup(async () => new Promise<Response>(() => {}), { timeoutMs: 5 }), raw = seed(timeout); await timeout.client.initialize(); await timeout.client.recover(); assert.equal(timeout.values.get(timeout.client.storageKey), raw);
  const invalid = [() => new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    () => new Response("x".repeat(4194305), { headers: { "content-type": "application/json" } }),
    () => new Response(null, { status: 204, headers: { "content-type": "application/json" } })];
  for (const make of invalid) { const x = setup(async () => make()), original = seed(x); await x.client.initialize(); await x.client.recover(); assert.equal(x.values.get(x.client.storageKey), original); assert.equal(x.client.getSnapshot().result, null); }
});
test("featureoff still permits an independently authorized owner reopen but no new send", async () => {
  const x = setup(async (url, init) => { const rq = request(String(url), init), r = wire(rq.q, rq.command); r.moduleEnabled = false; return response(r); }, { enabled: false });
  await x.client.initialize(); await x.client.preview(); assert.equal(x.calls.length, 0); await x.client.detail(period); await x.client.submit("seal", "No new seal"); assert.equal(x.calls.length, 1);
  await x.client.submit("reopen", "Explicit reasoned reopen"); assert.equal(x.calls.at(-1)!.init.method, "POST");
});
