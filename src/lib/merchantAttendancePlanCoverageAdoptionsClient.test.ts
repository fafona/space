import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePlanCoverageAdoptionsClient } from "./merchantAttendancePlanAdoptionViewClient";
import type { SourcesResponse } from "./merchantAttendanceSources";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { planCoverageHttp, planCoverageActor as ownerId, planCoverageQuery as q, planCoverageId as id } from "../../scripts/fixtures/attendance-plan-coverage-model";
import { scheduleEvidenceWire, parseScheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";
import { shiftCheckApprovedEffect } from "../../scripts/fixtures/attendance-shift-check-model";

function source(): SourcesResponse {
  const s = { ...parseScheduleEvidenceWire(scheduleEvidenceWire()), moduleEnabled: true }, slot = planCoverageHttp(0).data.slot;
  const { hasPublicationEvidence: _evidence, ...anchor } = slot; void _evidence;
  const { reason, cancelReason } = s.schedule.items[0];
  s.schedule.items = [{ ...anchor, workerId: q.workerId, workerName: s.worker.workerName, reason, cancelReason }]; return s;
}
// Every successful response is an actual NEW wrapper wire. Null adoption is
// explicitly historical absence, not a fake old response or fallback transport.
const json = (body: unknown = planCoverageHttp(), status = 200) => {
  let wire = body;
  if (body && typeof body === "object" && "ok" in body && body.ok === true && "data" in body) {
    const original = body as ReturnType<typeof planCoverageHttp>;
    wire = { ...original, data: { protocol: "plan-coverage-adoptions-v1", coverage: original.data, adoptions: original.data.sessions.map(s => ({ startEventId: s.rule.event.startEventId, adoption: null })) } };
  }
  return new Response(JSON.stringify(wire), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
const make = (apiFetch: AttendanceApiFetch = async () => json(), input = source(), timeoutMs = 12000) => new AttendancePlanCoverageAdoptionsClient({ source: input, ownerId, apiFetch, timeoutMs });
const run = (c: AttendancePlanCoverageAdoptionsClient) => c.read(q.slotId);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
function assertFrozen(value: unknown) { if (value && typeof value === "object") { assert(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); } }

test("construction is local-only, takes detached frozen plan anchors and preserves source/options", async () => {
  let calls = 0; const original = source(), before = structuredClone(original), options = { source: original, ownerId, apiFetch: async () => { calls++; return json(); } };
  const c = new AttendancePlanCoverageAdoptionsClient(options); assert.equal(calls, 0); assert.equal(c.getSnapshot().phase, "idle"); assert.equal(c.anchors.length, 1);
  assert.deepEqual(original, before); assertFrozen(c.anchors); assertFrozen(c.getSnapshot());
  original.schedule.items[0].locationName = "Changed"; original.worker.workerId = id(99); options.ownerId = id(98); options.apiFetch = async () => { throw Error("replaced"); };
  await run(c); assert.equal(calls, 1); assert.equal(c.anchors[0].locationName, before.schedule.items[0].locationName); assert.equal(c.getSnapshot().phase, "ready");
});
test("one explicit exact GET is no-store, has no body, and paused/inactive matching identity remains readable", async () => {
  const body = planCoverageHttp(0, false); body.data.worker.active = false; body.data.worker.employeeActive = false; let calls = 0;
  const c = make(async (url, init) => { calls++; assert.equal(url, `/api/merchant-enterprise/attendance/plan-coverage-adoptions?${new URLSearchParams(q)}`);
    assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined); return json(body); });
  await run(c); assert.equal(calls, 1); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().result?.moduleEnabled, false);
  assert.equal(c.getSnapshot().result?.sessions.length, 0); assertFrozen(c.getSnapshot()); assert(!JSON.stringify(c.getSnapshot()).includes("sourceText"));
});
test("a legitimate100-codepoint emoji location name survives the real Sources parser and plan anchor read", async () => {
  const name = "😀".repeat(100), wire = scheduleEvidenceWire();
  wire.schedule.items[0].id = q.slotId; wire.schedule.items[0].locationName = name;
  const input = { ...parseScheduleEvidenceWire(wire), moduleEnabled: true }, body = planCoverageHttp(0); body.data.slot.locationName = name;
  let calls = 0; const c = make(async () => { calls++; return json(body); }, input);
  assert.equal(name.length, 200); assert.equal([...name].length, 100); assert.equal(c.anchors[0].locationName, name);
  await run(c); assert.equal(calls, 1); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().result?.slot.locationName, name);
});
test("unknown/limited/empty/null-identity anchors cannot issue requests; malformed scope and duplicates fail closed", async () => {
  let calls = 0; const fetch = async () => { calls++; return json(); }; const c = make(fetch); await c.read(id(99)); assert.equal(c.getSnapshot().phase, "blocked");
  for (const limited of [false, true]) { const s = source(); s.schedule = { limited, items: [] }; const current = make(fetch, s); await run(current); assert.equal(current.limited, limited); }
  const s = source(); assert("employeeId" in s.attendance.base); s.worker.employeeId = null; s.attendance.base.employeeId = null; await run(make(fetch, s));
  const wrong = source(); wrong.actorId = id(99); assert.throws(() => make(fetch, wrong));
  const duplicate = source(); duplicate.schedule.items.push({ ...duplicate.schedule.items[0] }); assert.throws(() => make(fetch, duplicate));
  const scoped = source(); scoped.attendance.access = "self"; assert.throws(() => make(fetch, scoped));
  const partial = source(); partial.schedule.limited = true; assert.throws(() => make(fetch, partial));
  assert.equal(calls, 0);
});
test("later approved correction and later cancellation are accepted without matching stale parent attendance", async () => {
  const body = planCoverageHttp(1); body.data.sessions[0].effect = shiftCheckApprovedEffect();
  body.data.slot.cancelled = true; body.data.sessions[0].relation!.currentCancelled = true;
  const c = make(async () => json(body)); await run(c); assert.equal(c.getSnapshot().phase, "ready");
  assert.equal(c.getSnapshot().result?.hasApprovedChanges, true); assert.equal(c.getSnapshot().result?.slot.cancelled, true);
  assert.equal(c.getSnapshot().result?.sessions[0].effect?.operationId, id(71));
  const cancelled = source(); cancelled.schedule.items[0].cancelled = true; const reverted = make(undefined, cancelled); await run(reverted);
  assert.equal(reverted.getSnapshot().phase, "blocked"); assert.equal(reverted.getSnapshot().result, null);
});
test("immutable plan replacement and current employee mismatch are rejected and never matched by name", async () => {
  for (const key of ["locationName", "timeZone", "workDate", "startAt", "endAt"] as const) {
    const body = planCoverageHttp(0), value = ({ locationName: "Substituted", timeZone: "Europe/Madrid", workDate: "2026-09-03", startAt: "2026-09-02T08:01:00.000Z", endAt: "2026-09-02T16:01:00.000Z" })[key];
    body.data.slot[key] = value; const c = make(async () => json(body)); await run(c); assert.equal(c.getSnapshot().phase, "blocked");
  }
  for (const mutate of [(body: ReturnType<typeof planCoverageHttp>) => { body.data.slot.revision++; },
    (body: ReturnType<typeof planCoverageHttp>) => { body.data.slot.locationId = id(99); },
    (body: ReturnType<typeof planCoverageHttp>) => { body.data.worker.employeeId = id(99); }]) {
    const body = planCoverageHttp(0); mutate(body); const c = make(async () => json(body)); await run(c); assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().phase, "blocked");
  }
});
test("synchronous loading or ready subscriber pause cannot send or publish after its invalidation", async () => {
  let calls = 0; const first = make(async () => { calls++; return json(); }); first.subscribe(() => { if (first.getSnapshot().phase === "loading") first.pause(); });
  await run(first); assert.equal(calls, 0); assert.equal(first.getSnapshot().phase, "idle");
  const second = make(); second.subscribe(() => { throw Error("observer"); }); second.subscribe(() => { if (second.getSnapshot().phase === "ready") second.pause(); });
  await run(second); assert.equal(second.getSnapshot().result, null); assert.equal(second.getSnapshot().phase, "idle");
});
test("pause and a newer explicit read discard old success/error headers without automatic retry", async () => {
  for (const response of [json(), json({ ok: false, error: "attendance_access_denied" }, 403)]) {
    const gate = deferred<Response>(), c = make(async () => gate.promise), pending = run(c); c.pause(); gate.resolve(response); await pending;
    assert.equal(c.getSnapshot().phase, "idle"); assert.equal(c.getSnapshot().result, null);
  }
  const gate = deferred<Response>(); let calls = 0; const c = make(async () => ++calls === 1 ? gate.promise : json(planCoverageHttp(0)));
  const old = run(c); await run(c); gate.resolve(json()); await old; assert.equal(calls, 2); assert.equal(c.getSnapshot().result?.sessions.length, 0);
});
test("late body and hidden state cannot restore detail, and headers/body share one bounded timeout", async () => {
  const entered = deferred<void>(); let control!: ReadableStreamDefaultController<Uint8Array>;
  const c = make(async () => new Response(new ReadableStream<Uint8Array>({ start(value) { control = value; entered.resolve(); } }), { headers: { "Content-Type": "application/json" } }));
  const pending = run(c); await entered.promise; c.invalidate(); try { control.enqueue(new TextEncoder().encode(JSON.stringify(planCoverageHttp()))); control.close(); } catch { /* cancelled */ }
  await pending; assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().phase, "idle");
  for (const response of [() => new Promise<Response>(() => {}), () => Promise.resolve(new Response(new ReadableStream(), { headers: { "Content-Type": "application/json" } }))]) {
    let calls = 0; const timeout = make(async () => { calls++; return response(); }, source(), 15); await run(timeout);
    assert.equal(calls, 1); assert.equal(timeout.getSnapshot().phase, "blocked");
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: true } });
  try { let calls = 0; const hidden = make(async () => { calls++; return json(); }); await run(hidden); assert.equal(calls, 0); assert.equal(hidden.getSnapshot().result, null); }
  finally { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); }
});
test("strict transport rejects malformed UTF8/JSON, duplicate keys, incorrect status/content type and redirects", async () => {
  const text = JSON.stringify(planCoverageHttp());
  const responses = [() => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    () => new Response(text.replace('"ok":true', '"ok":false,"ok":true'), { headers: { "Content-Type": "application/json" } }),
    () => new Response("{", { headers: { "Content-Type": "application/json" } }), () => json(planCoverageHttp(), 201),
    () => new Response(text, { headers: { "Content-Type": "text/plain" } }), () => json({ ...planCoverageHttp(), extra: true }),
    () => { const response = json(); Object.defineProperty(response, "redirected", { value: true }); return response; }];
  for (const response of responses) { const c = make(async () => response()); await run(c); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().result, null); }
});
test("stream byte bounds enforce1MiB/4KiB and errors need the exact mapped status/envelope", async () => {
  for (const [length, status] of [[1048577, 200], [4097, 403]]) {
    const c = make(async () => new Response(" ".repeat(length), { status, headers: { "Content-Type": "application/json", "Content-Length": "2" } }));
    await run(c); assert.equal(c.getSnapshot().phase, "blocked");
  }
  const known = make(async () => json({ ok: false, error: "attendance_plan_coverage_too_large" }, 422)); await run(known); assert.match(known.getSnapshot().message, /未计算部分覆盖/);
  for (const [body, status] of [[{ ok: false, error: "attendance_plan_coverage_too_large" }, 503], [{ ok: false, error: "__proto__" }, 503], [{ ok: false, error: "attendance_access_denied", secret: "private" }, 403]] as const) {
    const c = make(async () => json(body, status)); await run(c); assert.match(c.getSnapshot().message, /无法可靠/); assert(!c.getSnapshot().message.includes("private"));
  }
});


test("ordered adoption entries preserve different references without changing original coverage and clear together", async () => {
  const { planCoverageAdoptionsHttp } = await import("../../scripts/fixtures/attendance-plan-adoption-view-model");
  const body = planCoverageAdoptionsHttp(); body.data.adoptions[1].adoption = null;
  const c = make(async () => Response.json(body)); await run(c); assert.equal(c.getSnapshot().phase, "ready");
  assert.equal(c.getSnapshot().fixedReference?.length, 2); assert.equal(c.getSnapshot().fixedReference?.[0].adoption?.status, "adopted");
  assert.equal(c.getSnapshot().fixedReference?.[1].adoption, null); assertFrozen(c.getSnapshot());
  c.invalidate(); assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().fixedReference, null);
});
test("old coverage wire and wrong entry set never trigger old endpoint fallback", async () => {
  for (const body of [planCoverageHttp(), { ok: true, moduleEnabled: true, data: { protocol: "plan-coverage-adoptions-v1", coverage: planCoverageHttp().data, adoptions: [] } }]) {
    const urls: string[] = []; const c = make(async url => { urls.push(url); return Response.json(body); }); await run(c);
    assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().fixedReference, null); assert.equal(urls.length, 1); assert.match(urls[0], /plan-coverage-adoptions\\?/);
  }
});
