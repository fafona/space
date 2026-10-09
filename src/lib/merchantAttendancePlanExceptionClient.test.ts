import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePlanExceptionClient, planExceptionPendingKey, type PlanExceptionClientOptions, type PlanExceptionStorage } from "./merchantAttendancePlanExceptionClient";
import { parsePlanExceptionResponse, parsePlanExceptionHttpQuery } from "./merchantAttendancePlanExceptions";
import type { PlanExceptionQuery, PlanExceptionCommand } from "./merchantAttendancePlanExceptionContract";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { exceptionUiId as id, exceptionUiSite as site, exceptionUiOwner as owner, exceptionUiEmployee as employee, exceptionUiAuth as auth,
  exceptionUiWorker as worker, exceptionUiSlot as slot, exceptionUiQuery as query, exceptionUiHttp as http, exceptionUiDecisionCommand as command } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function setup(fetch?: AttendanceApiFetch, patch: Partial<PlanExceptionClientOptions> = {}) {
  const values = new Map<string, string>([["unrelated", "keep"]]), writes: string[] = [], calls: { url: string; init: RequestInit }[] = [];
  const storage: PlanExceptionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, raw) => { values.set(key, raw); writes.push(raw); }, removeItem: key => { values.delete(key); } };
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => { calls.push({ url: String(url), init }); if (fetch) return fetch(url, init);
    const body = init.method === "POST" ? JSON.parse(String(init.body)) as { query: PlanExceptionQuery; command: PlanExceptionCommand } : null;
    const q = body?.query ?? parsePlanExceptionHttpQuery(`https://example.test${url}`); return reply(http({ access: q.access, mode: q.mode, command: body?.command })); };
  const options: PlanExceptionClientOptions = { siteId: site, access: "owner", actorId: owner, enabled: true, apiFetch, storage: () => storage, operationId: () => id(900), ...patch };
  return { client: new AttendancePlanExceptionClient(options), options, storage, values, writes, calls };
}
const ready = async (c: AttendancePlanExceptionClient) => { await c.initialize(); await c.detail(worker, slot); };
const saved = () => ({ version: 1, actorId: owner, employeeId: employee, employeeAuthUserId: auth, query: query("owner", "decide"), command: command() });
const seed = (x: ReturnType<typeof setup>) => { const raw = JSON.stringify(saved()); x.values.set(x.client.storageKey, raw); return raw; };

test("shared wire covers owner new case, history and self without pretending employee UUID is Auth", () => {
  for (const access of ["owner", "self"] as const) for (const mode of ["list", "detail", "recover"] as const) {
    const r = parsePlanExceptionResponse(http({ access, mode }), query(access, mode), access === "owner" ? { ownerId: owner } : { employeeId: employee });
    assert.equal(r.actorId, access === "owner" ? owner : auth); assert.equal(r.employeeId, access === "owner" ? null : employee);
  }
});
test("initialization is bounded local-only and pending scope has site/access/actor", async () => {
  const x = setup(); await x.client.initialize(); assert.equal(x.calls.length, 0); assert.equal(x.writes.length, 0);
  assert.equal(x.client.storageKey, `faolla:attendance:plan-exceptions:v1:${site}:owner:${owner}`);
  assert(Object.isFrozen(x.client.getSnapshot())); assert.equal(x.values.get("unrelated"), "keep");
  for (const patch of [{ enabled: "1" }, { timeoutMs: 0 }, { timeoutMs: 12001 }, { access: "admin" }, { actorId: "bad" }, { storage: null }])
    assert.throws(() => new AttendancePlanExceptionClient({ ...x.options, ...patch } as PlanExceptionClientOptions));
});
test("uninitialized, invalid IDs and disabled new reads never send HTTP", async () => {
  const x = setup(); await x.client.detail(worker, slot); await x.client.initialize(); await x.client.detail("bad", slot); assert.equal(x.calls.length, 0);
  const y = setup(undefined, { enabled: false }); await ready(y.client); await y.client.list(); await y.client.decide("confirmed", "reason"); assert.equal(y.calls.length, 0);
});
test("one explicit decision saves and rereads exact small command before POST, validates receipt then CAS clears", async () => {
  const x = setup(async (_url, init) => { if (init?.method === "POST") {
    assert.deepEqual(JSON.parse(x.values.get(x.client.storageKey)!), saved()); const b = JSON.parse(String(init.body)); assert.deepEqual(b.command, command()); return reply(http({ mode: "decide", command: b.command })); }
    return reply(http()); });
  await ready(x.client); await x.client.decide("confirmed", command().note);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]); assert.equal(x.client.getSnapshot().pending, null);
  assert.equal(x.values.get(x.client.storageKey), undefined); assert.equal(x.client.getSnapshot().result!.receipt!.operationId, id(900));
  assert(x.writes.every(v => !v.includes("sourceText") && !v.includes("sessions") && !v.includes("candidate")));
  assert(Object.isFrozen(x.client.getSnapshot().result!.detail!.history));
});
test("blocked source permits follow_up but cannot confirm/excuse", async () => {
  const x = setup(async (_, init) => { const c = init?.method === "POST" ? JSON.parse(String(init.body)).command : null; return reply(http({ eligible: false, mode: c ? "decide" : "detail", command: c })); });
  await ready(x.client); await x.client.decide("confirmed", "reason"); assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0);
  await x.client.detail(worker, slot); await x.client.decide("excused", "reason"); assert.equal(x.calls.length, 2);
  await x.client.detail(worker, slot); await x.client.decide("follow_up", "reason"); assert.equal(x.calls.at(-1)!.init.method, "POST"); assert.equal(x.client.getSnapshot().pending, null);
});
test("eligible but no triggered field cannot conclude, and paused writes are refused", async () => {
  const body = http(); const s = body.data.detail!.current!; assert.notEqual(s.protocol, "plan-exception-source-v3");
  if (s.protocol === "plan-exception-source-v3") assert.fail("legacy fixture expected");
  s.source.sessions[0].original = s.source.sessions[0].selected = { startAt: "2026-10-08T08:00:00.000000Z", endAt: "2026-10-08T16:00:00.000000Z" };
  const { calculateExceptionCandidate } = await import("./merchantAttendancePlanExceptionSource"); s.candidate = calculateExceptionCandidate(s.source, true);
  const x = setup(async () => reply(body)); await ready(x.client); await x.client.decide("confirmed", "reason"); assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0);
  const y = setup(async () => reply(http({ moduleEnabled: false }))); await ready(y.client); await y.client.decide("follow_up", "reason"); assert.equal(y.calls.length, 1);
});
test("self note and acknowledgement pin the decision, and acknowledgement is not a new case revision", async () => {
  const x = setup(undefined, { access: "self", actorId: employee, operationId: () => id(901) }); await ready(x.client);
  assert.equal(x.client.getSnapshot().result!.detail!.currentValidation, "not_checked"); await x.client.note("Synthetic employee explanation");
  assert.equal(x.client.getSnapshot().pending, null); const noteBody = JSON.parse(String(x.calls.at(-1)!.init.body));
  assert.deepEqual(noteBody.command, { operationId: id(901), expectedRevision: 1, decisionOperationId: id(900), note: "Synthetic employee explanation" });
  const y = setup(undefined, { access: "self", actorId: employee, operationId: () => id(902) }); await ready(y.client); await y.client.ack();
  assert.equal(y.client.getSnapshot().result!.detail!.revision, 1); assert.equal(y.client.getSnapshot().result!.readReceipt!.operationId, id(902));
  const count = y.calls.length; await y.client.ack(); assert.equal(y.calls.length, count);
});
test("owner cannot note/ack and self cannot decide", async () => {
  const x = setup(); await ready(x.client); await x.client.note("no"); await x.client.ack(); assert.equal(x.calls.length, 1);
  const y = setup(undefined, { access: "self", actorId: employee }); await ready(y.client); await y.client.decide("follow_up", "no"); assert.equal(y.calls.length, 1);
});
test("unknown POST keeps exact original intent, reload discovers without network and flag-off recovery only GETs", async () => {
  const x = setup(async (_, init) => { if (init?.method === "POST") throw Error("lost"); return reply(http()); }); await ready(x.client); await x.client.decide("confirmed", command().note);
  const raw = x.values.get(x.client.storageKey); assert(raw); assert.equal(x.client.getSnapshot().phase, "unconfirmed");
  const calls: string[] = []; const reloaded = new AttendancePlanExceptionClient({ ...x.options, enabled: false, apiFetch: async (_, init) => { calls.push(init?.method ?? ""); return reply(http({ mode: "recover", saved: true, command: command() })); } });
  await reloaded.initialize(); assert.equal(calls.length, 0); await reloaded.retry(); assert.equal(calls.length, 0); await reloaded.recover();
  assert.deepEqual(calls, ["GET"]); assert.equal(reloaded.getSnapshot().pending, null); assert.equal(x.values.get(x.client.storageKey), undefined);
});
test("GET-null keeps original and does not start another operation or cross-target recovery", async () => {
  const x = setup(async () => reply(http({ mode: "recover" }))), raw = seed(x); await x.client.initialize(); await x.client.recover();
  await x.client.list(); await x.client.decide("confirmed", "other"); await x.client.recover({ workerId: worker, slotId: slot, operationId: id(901) });
  assert.equal(x.calls.length, 1); assert.equal(x.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending);
});
test("explicit retry GETs original first and only then POSTs the byte-equivalent original body", async () => {
  const x = setup(async (_, init) => reply(init?.method === "POST" ? http({ mode: "decide", command: command() }) : http({ mode: "recover" }))); seed(x);
  await x.client.initialize(); await x.client.retry(); assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(String(x.calls[1].init.body)), { query: query("owner", "decide"), command: command() }); assert.equal(x.client.getSnapshot().pending, null);
});
test("found original receipt during retry settles without another POST", async () => {
  const x = setup(async () => reply(http({ mode: "recover", saved: true, command: command() }))); seed(x); await x.client.initialize(); await x.client.retry();
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert.equal(x.client.getSnapshot().pending, null);
});
test("explicit endAttempt GET-null and current dual identity are required before clearing", async () => {
  const x = setup(async () => reply(http({ mode: "recover" }))); seed(x); await x.client.initialize(); await x.client.endAttempt();
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.client.getSnapshot().result, null);
  await x.client.detail(worker, slot); assert.equal(x.calls.length, 2);
  for (const mutate of [(h: ReturnType<typeof http>) => { h.data.detail = null; }, (h: ReturnType<typeof http>) => { h.data.detail!.worker.employeeId = id(77); }]) {
    const h = http({ mode: "recover" }); mutate(h); const y = setup(async () => reply(h)), raw = seed(y); await y.client.initialize(); await y.client.endAttempt();
    assert.equal(y.values.get(y.client.storageKey), raw); assert(y.client.getSnapshot().pending);
  }
});
test("paused, auth, identity and operation errors keep pending and prevent retry POST or endAttempt clear", async () => {
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_plan_exception_review_identity_changed", 409], ["attendance_operation_conflict", 409]] as const) {
    const x = setup(async () => reply({ ok: false, error: code }, status)), raw = seed(x); await x.client.initialize(); await x.client.retry(); await x.client.endAttempt();
    assert(x.calls.every(c => c.init.method === "GET")); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().result, null);
  }
  const p = setup(async () => reply(http({ mode: "recover", moduleEnabled: false }))), raw = seed(p); await p.client.initialize(); await p.client.retry();
  assert.equal(p.calls.length, 1); assert.equal(p.values.get(p.client.storageKey), raw);
});
test("strict rejection and malformed success never erase a new pending; no broad 4xx settlement", async () => {
  for (const [body, status] of [[{ ok: false, error: "attendance_version_conflict" }, 409], [{ ok: false, error: "attendance_plan_exception_review_source_changed" }, 409],
    [{ ok: false, error: "attendance_access_denied", extra: true }, 403], [{ ok: false, error: "attendance_version_conflict" }, 503], [{ ok: false, error: "unexpected" }, 409], [{ ok: true }, 200]] as const) {
    const x = setup(async (_, init) => init?.method === "POST" ? reply(body, status) : reply(http())); await ready(x.client); await x.client.decide("confirmed", command().note);
    assert(x.client.getSnapshot().pending); assert(x.values.get(x.client.storageKey)); assert.equal(x.client.getSnapshot().result, null);
  }
});
test("exact409 sealed rejection explains the boundary but retains the original and never automatically retries or retires", async () => {
  const x = setup(async (url, init) => init?.method === "POST" ? reply({ ok: false, error: "attendance_period_sealed" }, 409)
    : reply(http({ mode: String(url).includes("mode=recover") ? "recover" : "detail" })));
  await ready(x.client); await x.client.decide("confirmed", command().note);
  const raw = x.values.get(x.client.storageKey); assert(raw);
  assert.equal(x.client.getSnapshot().phase, "unconfirmed"); assert.equal(x.client.getSnapshot().result, null);
  assert.match(x.client.getSnapshot().message, /相关周期已封存/); assert.match(x.client.getSnapshot().message, /先重开相关周期/);
  assert.deepEqual(JSON.parse(raw), saved()); assert.equal(x.writes.length, 1);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]); assert.equal(x.values.get("unrelated"), "keep");
  await tick(); assert.equal(x.calls.length, 2); assert.equal(x.values.get(x.client.storageKey), raw);
  await x.client.recover(); assert.equal(x.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending);
  assert.equal(x.client.getSnapshot().result!.receipt, null); assert.equal(x.client.getSnapshot().result!.detail!.current, null);
  await x.client.endAttempt(); assert.equal(x.values.get(x.client.storageKey), undefined); assert.equal(x.client.getSnapshot().pending, null);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST", "GET", "GET"]);
});

test("sealed text is shown only for a strict matching status and error envelope, never an imitated transport error", async () => {
  const cases: (() => Promise<Response>)[] = [
    async () => reply({ ok: false, error: "attendance_period_sealed" }, 503),
    async () => reply({ ok: false, error: "attendance_period_sealed", extra: true }, 409),
    async () => reply({ ok: false, error: ["attendance_period_sealed"] }, 409),
    async () => reply({ ok: false, error: "attendance_period_sealed_unknown" }, 409),
    async () => reply({ ok: false, error: "attendance_period_sealed" }, 200),
    async () => new Response('{"ok":false,"error":"attendance_period_sealed","error":"attendance_period_sealed"}', { status: 409, headers: { "content-type": "application/json" } }),
    async () => { throw Object.assign(Error("attendance_period_sealed"), { name: "Rejected" }); },
  ];
  for (const response of cases) {
    const x = setup(async (_, init) => init?.method === "POST" ? response() : reply(http()));
    await ready(x.client); await x.client.decide("confirmed", command().note);
    assert(x.client.getSnapshot().pending); assert.equal(x.client.getSnapshot().phase, "unconfirmed");
    assert.match(x.client.getSnapshot().message, /本次结果无法可靠确认/); assert.doesNotMatch(x.client.getSnapshot().message, /相关周期已封存/);
    assert.deepEqual(JSON.parse(x.values.get(x.client.storageKey)!), saved()); assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]);
  }
});

test("sealed response arriving after pause, scope invalidation or hidden state cannot expose a late rejection", async () => {
  for (const action of ["pause", "invalidate", "hide"] as const) {
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document"), response = deferred<Response>();
    let hidden = false;
    if (action === "hide") Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return hidden; } } });
    try {
      const x = setup(async (_, init) => init?.method === "POST" ? response.promise : reply(http())); await ready(x.client);
      const saving = x.client.decide("confirmed", command().note); await tick();
      assert.equal(x.calls.length, 2); const raw = x.values.get(x.client.storageKey); assert(raw);
      if (action === "hide") hidden = true; else if (action === "pause") x.client.pause(); else x.client.invalidate("Synthetic scope changed");
      response.resolve(reply({ ok: false, error: "attendance_period_sealed" }, 409)); await saving;
      assert.equal(x.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending); assert.equal(x.client.getSnapshot().result, null);
      assert.doesNotMatch(x.client.getSnapshot().message, /相关周期已封存/); assert.equal(x.calls.length, 2);
    } finally {
      if (action === "hide") { if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else Reflect.deleteProperty(globalThis, "document"); }
    }
  }
});

test("deadline before sealed headers or complete sealed body keeps generic uncertainty and the exact intent", async () => {
  for (const phase of ["headers", "body"] as const) {
    const response = deferred<Response>();
    const x = setup(async (_, init) => init?.method !== "POST" ? reply(http()) : phase === "headers" ? response.promise
      : new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":false,"error":"attendance_period_sealed"}'));
        // No EOF: a valid prefix is not a fully received error envelope.
      } }), { status: 409, headers: { "content-type": "application/json" } }), { timeoutMs: 30 });
    await ready(x.client); await x.client.decide("confirmed", command().note);
    const raw = x.values.get(x.client.storageKey); assert(raw); const state = x.client.getSnapshot();
    assert.equal(state.phase, "unconfirmed"); assert.match(state.message, /本次结果无法可靠确认/); assert.doesNotMatch(state.message, /相关周期已封存/);
    if (phase === "headers") { response.resolve(reply({ ok: false, error: "attendance_period_sealed" }, 409)); await tick(); }
    assert.equal(x.client.getSnapshot(), state); assert.equal(x.values.get(x.client.storageKey), raw); assert.equal(x.calls.length, 2);
  }
});

test("receipt body mismatch, not only operation UUID, prevents settlement", async () => {
  const wrong = command(); wrong.note = "Another intent"; const x = setup(async () => reply(http({ mode: "recover", saved: true, command: wrong }))), raw = seed(x);
  await x.client.initialize(); await x.client.recover(); assert.equal(x.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending);
});
test("invalid notes do not persist or POST", async () => {
  for (const note of ["", " leading", "trailing ", "line\nbreak", "x".repeat(501), "\ud800"]) {
    const x = setup(); await ready(x.client); await x.client.decide("follow_up", note); assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0);
  }
});
test("malformed local storage is fail-closed; another owner key stays untouched", async () => {
  const x = setup(); x.values.set(x.client.storageKey, "{bad"); await x.client.initialize(); await x.client.list(); assert.equal(x.calls.length, 0); assert.equal(x.values.get(x.client.storageKey), "{bad");
  const y = setup(); y.values.set(planExceptionPendingKey(site, "owner", id(99)), JSON.stringify(saved())); await y.client.initialize(); assert.equal(y.client.getSnapshot().pending, null);
  assert.equal(y.values.size, 2); assert.equal(y.calls.length, 0);
});
test("storage replacement and remove failure preserve unknown intent without overwriting", async () => {
  const x = setup(); await ready(x.client); x.values.set(x.client.storageKey, "replacement"); await x.client.decide("confirmed", command().note);
  assert.equal(x.calls.length, 1); assert.equal(x.values.get(x.client.storageKey), "replacement");
  const y = setup(async () => reply(http({ mode: "recover", saved: true, command: command() }))); const raw = seed(y); y.storage.removeItem = () => { throw Error("denied"); };
  await y.client.initialize(); await y.client.recover(); assert.equal(y.values.get(y.client.storageKey), raw); assert(y.client.getSnapshot().pending);
});
test("subscription pause during saving stops POST before persistence or submission", async () => {
  const x = setup(); await ready(x.client); let paused = false;
  x.client.subscribe(() => { if (!paused && x.client.getSnapshot().phase === "saving") { paused = true; x.client.pause(); } });
  await x.client.decide("confirmed", command().note); assert.equal(x.calls.length, 1); assert.equal(x.writes.length, 0); assert.equal(x.client.getSnapshot().result, null);
});
test("synchronous storage and operationId reentry cannot send a late POST", async () => {
  const x = setup(); await ready(x.client); const original = x.storage.setItem;
  x.storage.setItem = (key, raw) => { original(key, raw); x.client.pause(); }; await x.client.decide("confirmed", command().note);
  assert.equal(x.calls.length, 1); assert(x.values.get(x.client.storageKey));
  const y = setup(undefined, { operationId: () => { y.client.pause(); return id(900); } });
  await ready(y.client); await y.client.decide("confirmed", command().note); assert.equal(y.calls.length, 1); assert.equal(y.writes.length, 0);
});
test("loading subscription reentry prevents GET; pause discards late headers/body and retains pending", async () => {
  const x = setup(); await x.client.initialize(); let paused = false; x.client.subscribe(() => { if (!paused && x.client.getSnapshot().phase === "loading") { paused = true; x.client.pause(); } });
  await x.client.list(); assert.equal(x.calls.length, 0);
  const wait = deferred<Response>(), y = setup(async () => wait.promise); seed(y); await y.client.initialize(); const read = y.client.recover(); await tick(); y.client.pause();
  wait.resolve(reply(http({ mode: "recover", saved: true, command: command() }))); await read; assert.equal(y.client.getSnapshot().result, null); assert(y.client.getSnapshot().pending);
});
test("body deadline covers a hanging stream, fatal UTF8 and response size are bounded", async () => {
  const x = setup(async () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }), { timeoutMs: 15 });
  await ready(x.client); assert.equal(x.client.getSnapshot().phase, "blocked");
  for (const bytes of [new Uint8Array([255]), new TextEncoder().encode("x".repeat(1048577))]) {
    const y = setup(async () => new Response(bytes, { headers: { "content-type": "application/json" } })); await ready(y.client); assert.equal(y.client.getSnapshot().result, null);
  }
});
test("list pagination is explicit and next page removes old detail/current data", async () => {
  const first = http({ mode: "list", saved: true }); const item = first.data.items[0]; first.data.items = Array.from({ length: 25 }, (_, i) => ({ ...item, caseId: id(999 - i), slotId: id(2000 + i), latestDecision: { ...item.latestDecision, operationId: id(999 - i) } }));
  first.data.nextCursor = { at: item.openedAt, id: id(975) };
  const x = setup(async url => reply(new URL(String(url), "https://example.test").searchParams.has("beforeId") ? http({ mode: "list" }) : first));
  await x.client.initialize(); assert.equal(x.calls.length, 0); await x.client.list(); assert.equal(x.client.getSnapshot().result!.items.length, 25);
  await x.client.next(); assert.equal(x.calls.length, 2); assert.equal(x.client.getSnapshot().result!.items.length, 0); assert.match(x.calls[1].url, /beforeId=/);
});
