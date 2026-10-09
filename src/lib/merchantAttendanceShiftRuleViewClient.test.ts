import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceShiftRuleViewClient } from "./merchantAttendanceShiftRuleViewClient";
import type { SourcesResponse } from "./merchantAttendanceSources";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { shiftRuleViewActor as ownerId, shiftRuleViewId as id, shiftRuleViewQuery as q, shiftRuleViewHttp } from "../../scripts/fixtures/attendance-shift-rule-view-model";
import { scheduleEvidenceWire, parseScheduleEvidenceWire, scheduleEvidenceCorrection, scheduleEvidenceMissing } from "../../scripts/fixtures/attendance-schedule-evidence-model";

function source(corrected = false): SourcesResponse {
  const w = scheduleEvidenceWire(), row = w.attendance.base.items[0]; row.startEventId = q.startEventId; row.events[0].id = q.startEventId;
  if (corrected) row.effect = scheduleEvidenceCorrection(row, { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T17:00:00.000000Z", breaks: [] });
  w.attendance.missing.push(scheduleEvidenceMissing()); return { ...parseScheduleEvidenceWire(w), moduleEnabled: true };
}
const json = (body: unknown = shiftRuleViewHttp(), status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const client = (apiFetch: AttendanceApiFetch = async () => json(), input = source(), timeoutMs = 12000) => new AttendanceShiftRuleViewClient({ source: input, ownerId, apiFetch, timeoutMs });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const run = (c: AttendanceShiftRuleViewClient) => c.read(q.startEventId);
function assertFrozen(v: unknown) { if (v && typeof v === "object") { assert(Object.isFrozen(v)); Object.values(v).forEach(assertFrozen); } }

test("construction is local-only, anchors exclude missing declarations and are detached/frozen", () => {
  let calls = 0; const original = source(), before = structuredClone(original), c = client(async () => { calls++; return json(); }, original);
  assert.equal(calls, 0); assert.equal(c.getSnapshot().phase, "idle"); assert.equal(c.anchors.length, 1); assert.equal(c.anchors[0].startEventId, q.startEventId);
  assertFrozen(c.anchors); assertFrozen(c.getSnapshot()); assert.deepEqual(original, before);
  original.attendance.base.rows[0].original.startAt = "changed"; assert.equal(c.anchors[0].original.startAt, "2026-09-02T08:00:00.000000Z");
});
test("explicit read sends one exact GET with no-store and original query; all three states and paused inactive reads work", async () => {
  for (const status of ["missing", "unverified", "verified"] as const) {
    const body = shiftRuleViewHttp(status, true, false); body.data.worker.active = false; body.data.worker.employeeActive = false;
    let calls = 0; const c = client(async (url, init) => { calls++; assert.equal(url, `/api/merchant-enterprise/attendance/shift-rule-binding-view?${new URLSearchParams(q)}`);
      assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined); return json(body); });
    await run(c); assert.equal(calls, 1); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().result?.status, status);
    assert.equal(c.getSnapshot().result?.moduleEnabled, false); assertFrozen(c.getSnapshot()); assert(!JSON.stringify(c.getSnapshot()).includes("sourceText"));
  }
});
test("unknown IDs, missing-request IDs, empty rows and unbound identity cannot cause a request", async () => {
  let calls = 0; const fetch: AttendanceApiFetch = async () => { calls++; return json(); };
  const c = client(fetch); await c.read(id(20002)); assert.equal(c.getSnapshot().phase, "blocked");
  const empty = source(); empty.attendance.base.rows = []; await run(client(fetch, empty));
  const unbound = source(); assert("employeeId" in unbound.attendance.base); unbound.worker.employeeId = null; unbound.attendance.base.employeeId = null; await run(client(fetch, unbound));
  assert.equal(calls, 0);
});
test("wrong owner/source scope, duplicate anchors and invalid options fail closed at construction", () => {
  const a = source(); a.actorId = id(999); assert.throws(() => client(undefined, a));
  const b = source(); b.attendance.base.rows.push(structuredClone(b.attendance.base.rows[0])); assert.throws(() => client(undefined, b));
  for (const timeout of [0, 12001, NaN, 1.5]) assert.throws(() => client(undefined, source(), timeout));
});
test("owner metadata and owner-shaped base are both required, even if the other anchor IDs match", () => {
  let calls = 0; const fetch: AttendanceApiFetch = async () => { calls++; return json(); };
  const scoped = source(); scoped.attendance.access = "self"; assert.throws(() => client(fetch, scoped));
  const missingIdentity = source(); Reflect.deleteProperty(missingIdentity.attendance.base, "employeeId"); assert.throws(() => client(fetch, missingIdentity));
  assert.equal(calls, 0);
});
test("approved correction still reads and compares original start, not the current selected start", async () => {
  const s = source(true), c = client(undefined, s); assert.notEqual(s.attendance.base.rows[0].original.startAt, s.attendance.base.rows[0].selected.startAt);
  await run(c); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.anchors[0].corrected, true);
  const shifted = shiftRuleViewHttp(); shifted.data.event.occurredAt = s.attendance.base.rows[0].selected.startAt;
  const wrong = client(async () => json(shifted), s); await run(wrong); assert.equal(wrong.getSnapshot().phase, "blocked"); assert.equal(wrong.getSnapshot().result, null);
});
test("returned original time zone or employee mismatch clears detail instead of matching by name", async () => {
  for (const change of [(v: ReturnType<typeof shiftRuleViewHttp>) => { v.data.event.timeZone = "Europe/Madrid"; },
    (v: ReturnType<typeof shiftRuleViewHttp>) => { v.data.worker.employeeId = id(72); v.data.event.employeeId = id(72); v.data.binding = null; v.data.evidence = null; v.data.status = "missing"; v.data.reason = "binding_missing"; }]) {
    const body = shiftRuleViewHttp(); change(body); const c = client(async () => json(body)); await run(c); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().result, null);
  }
});
test("options and source mutations after construction cannot replace the immutable request scope or transport", async () => {
  let calls = 0; const options = { source: source(), ownerId, apiFetch: async () => { calls++; return json(); } };
  const c = new AttendanceShiftRuleViewClient(options); options.ownerId = id(98); options.source.worker.workerId = id(99); options.apiFetch = async () => { throw Error("substitution"); };
  await run(c); assert.equal(calls, 1); assert.equal(c.getSnapshot().phase, "ready");
});
test("loading subscriber pause prevents even the first GET", async () => {
  let calls = 0; const c = client(async () => { calls++; return json(); }); c.subscribe(() => { if (c.getSnapshot().phase === "loading") c.pause(); });
  await run(c); assert.equal(calls, 0); assert.equal(c.getSnapshot().phase, "idle");
});
test("ready subscriber pause is atomic and observer exceptions do not bypass leases", async () => {
  const c = client(), seen: string[] = []; c.subscribe(() => { throw Error("observer"); }); c.subscribe(() => { if (c.getSnapshot().phase === "ready") c.pause(); });
  c.subscribe(() => { seen.push(c.getSnapshot().phase); }); await run(c); assert.equal(c.getSnapshot().result, null); assert(!seen.includes("ready"));
});
test("pause/invalidate clear immediately and late headers cannot resurrect old detail", async () => {
  for (const pause of [true, false]) {
    const gate = deferred<Response>(), c = client(async () => gate.promise), pending = run(c); assert.equal(c.getSnapshot().phase, "loading");
    if (pause) c.pause(); else c.invalidate(); assert.equal(c.getSnapshot().result, null); gate.resolve(json()); await pending; assert.equal(c.getSnapshot().phase, "idle");
  }
});
test("a newer explicit read wins over old headers without an automatic extra request", async () => {
  const gate = deferred<Response>(); let calls = 0; const c = client(async () => ++calls === 1 ? gate.promise : json(shiftRuleViewHttp("missing")));
  const old = run(c); await run(c); gate.resolve(json()); await old; assert.equal(calls, 2); assert.equal(c.getSnapshot().result?.status, "missing");
});
test("aborting the transport can synchronously start a newer read without stale invalidation replacing it", async () => {
  let calls = 0, newer: Promise<void> | undefined; const gate = deferred<Response>();
  const c = client(async (_url, init) => { calls++; if (calls === 1) { init?.signal?.addEventListener("abort", () => { newer = run(c); }, { once: true }); return gate.promise; } return json(); });
  const first = run(c); c.pause(); await newer; gate.resolve(json()); await first; assert.equal(calls, 2); assert.equal(c.getSnapshot().phase, "ready");
});
test("a held response body is canceled and cannot restore data after page lifecycle pause", async () => {
  let control!: ReadableStreamDefaultController<Uint8Array>; const entered = deferred<void>();
  const c = client(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { control = controller; entered.resolve(); } }), { headers: { "Content-Type": "application/json" } }));
  const pending = run(c); await entered.promise; c.pause(); try { control.enqueue(new TextEncoder().encode(JSON.stringify(shiftRuleViewHttp()))); control.close(); } catch { /* canceled stream */ }
  await pending; assert.equal(c.getSnapshot().phase, "idle"); assert.equal(c.getSnapshot().result, null);
});
test("one bounded deadline covers both never-arriving headers and body, with no retry", async () => {
  for (const apiFetch of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream(), { headers: { "Content-Type": "application/json" } })]) {
    let calls = 0; const c = client(async () => { calls++; return apiFetch(); }, source(), 20); await run(c);
    assert.equal(calls, 1); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().result, null);
  }
});
test("hidden before read or while headers arrive clears the result and performs no automatic resume", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true }; Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    let calls = 0; const gate = deferred<Response>(), c = client(async () => { calls++; return gate.promise; }); await run(c); assert.equal(calls, 0);
    doc.hidden = false; const pending = run(c); doc.hidden = true; gate.resolve(json()); await pending; assert.equal(calls, 1); assert.equal(c.getSnapshot().result, null);
    doc.hidden = false; assert.equal(calls, 1);
  } finally { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); }
});
test("UTF8, duplicate JSON keys, unknown envelope and successful status/content-type/redirect anomalies all fail closed", async () => {
  const wire = JSON.stringify(shiftRuleViewHttp());
  const responses = [() => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    () => new Response(wire.replace('"ok":true', '"ok":false,"ok":true'), { headers: { "Content-Type": "application/json" } }),
    () => json({ ...shiftRuleViewHttp(), extra: true }), () => json(shiftRuleViewHttp(), 201), () => new Response(wire, { headers: { "Content-Type": "text/plain" } }),
    () => { const response = json(); Object.defineProperty(response, "redirected", { value: true }); return response; }];
  for (const response of responses) { const c = client(async () => response()); await run(c); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().result, null); }
});
test("success32KiB and error4KiB byte limits apply to streams, not trusted content-length", async () => {
  for (const [length, status] of [[32769, 200], [4097, 403]]) {
    const c = client(async () => new Response(" ".repeat(length), { status, headers: { "Content-Type": "application/json", "Content-Length": "2" } }));
    await run(c); assert.equal(c.getSnapshot().phase, "blocked");
  }
});
test("only an exact known error envelope with its mapped HTTP status receives the specific message", async () => {
  const correct = client(async () => json({ ok: false, error: "attendance_shift_rule_binding_identity_changed" }, 409)); await run(correct); assert.match(correct.getSnapshot().message, /身份已变化/);
  for (const [body, status] of [[{ ok: false, error: "attendance_shift_rule_binding_identity_changed" }, 403], [{ ok: false, error: "unknown" }, 503], [{ ok: false, error: "attendance_access_denied", message: "secret" }, 403]] as const) {
    const c = client(async () => json(body, status)); await run(c); assert.match(c.getSnapshot().message, /无法可靠/); assert(!c.getSnapshot().message.includes("secret"));
  }
});
