//Synthetic 198 protocol fixtures; this tests navigation fencing, not SQL grants.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceReminderNavigation, reminderOriginalSupported, reminderOriginalTarget } from "./merchantAttendanceRemindersNavigation";
import { attendanceReminderPendingKey } from "./merchantAttendanceRemindersClient";
import { correctionDecisionKey } from "./merchantAttendanceCorrectionDecisionClient";
import { reviewRoutingPendingKey } from "./merchantAttendanceReviewRoutingClient";
import { REVIEW_ROUTING_API, parseReviewRoutingHttpQuery } from "./merchantAttendanceReviewRouting";
import { routingDetail, routingOwner, routingSite, routingId, routingObservation, routingResult } from "../../scripts/fixtures/attendance-review-routing-model";
import type { AttendanceReminderTarget } from "./merchantAttendanceReminders";
import { REVIEW_ROUTING_FAMILIES } from "./merchantAttendanceReviewRouting";
import { cycleModel, cycleOwner, cycleSite } from "../../scripts/fixtures/attendance-cycle-intent-model";
import { parseCycleIntentHttpQuery, CYCLE_INTENT_API } from "./merchantAttendanceCycleIntent";
import { cycleIntentPendingKey } from "./merchantAttendanceCycleIntentClient";
import { periodClosurePendingKey } from "./merchantAttendancePeriodClosureClient";
const f = routingDetail(), target: AttendanceReminderTarget = { kind: "pending_review", family: "correction", requestId: f.request.requestId,
  responsibilityRevision: f.current!.revision, responsibilityOperationId: f.current!.operationId };
const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
function fixture(extra: { response?: () => Response | Promise<Response>; current?: () => boolean; timeoutMs?: number } = {}) {
  const values = new Map<string, string>(), calls: { url: string; init?: RequestInit }[] = [];
  const options = { siteId: routingSite, actorId: routingOwner, ownerId: routingOwner, storage: () => ({ getItem: (k: string) => values.get(k) ?? null }),
    isCurrentAuth: extra.current ?? (() => true), timeoutMs: extra.timeoutMs,
    apiFetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return extra.response ? extra.response() : reply({ ok: true, data: f.wire }); } };
  const client = new AttendanceReminderNavigation(options); return { client, options, values, calls };
}
test("201 navigation constructor 0HTTP, actual owner supports six review families and separately verified cycle targets", async () => {
  const x = fixture(); assert.equal(x.calls.length, 0); assert.equal(reminderOriginalSupported(target), true);
  const others: AttendanceReminderTarget[] = [{ kind: "open_session", workerId: routingId(2), startEventId: routingId(3) }, { kind: "period_due", workerId: routingId(2), intentId: routingId(3) },
  ];
  for (const value of others) { assert.equal(reminderOriginalSupported(value), value.kind === "period_due"); await assert.rejects(x.client.freshOriginal(value)); }
  assert.equal(x.calls.length, 0); assert.throws(() => new AttendanceReminderNavigation({ ...x.options, ownerId: routingId(99) }));
  const closed = new AttendanceReminderNavigation({ ...x.options, isCurrentAuth: undefined }); await assert.rejects(closed.freshOriginal(target)); assert.equal(x.calls.length, 0);
  assert.throws(() => reminderOriginalTarget({ ...target, authority: true } as AttendanceReminderTarget));
});

test("201 all six owner review families use their exact original 198 GET and full current identity", async () => {
  for (const family of REVIEW_ROUTING_FAMILIES) {
    const d = routingDetail(family), t: AttendanceReminderTarget = { kind: "pending_review", family, requestId: d.request.requestId,
      responsibilityRevision: d.current!.revision, responsibilityOperationId: d.current!.operationId };
    const x = fixture({ response: () => reply({ ok: true, data: d.wire }) });
    assert.equal(reminderOriginalSupported(t), true); assert.deepEqual(await x.client.freshOriginal(t), d.request);
    assert.equal(x.calls.length, 1); assert.equal(x.calls[0].init?.method, "GET");
    assert.deepEqual(parseReviewRoutingHttpQuery("https://local.invalid" + x.calls[0].url), d.query);
  }
});

test("201 owner period target gets actual strict 200 detail, never preview or send; both original slots block", async () => {
  const m = await cycleModel(), values = new Map<string, string>(), calls: string[] = [];
  const options = { siteId: cycleSite, actorId: cycleOwner, ownerId: cycleOwner, isCurrentAuth: () => true,
    storage: () => ({ getItem: (key: string) => values.get(key) ?? null }),
    apiFetch: async (url: string, init?: RequestInit) => { calls.push(url); assert.equal(init?.method, "GET"); return reply({ ok: true, data: m.result({ kind: "detail", intent: m.intent, head: m.receipt }) }); } };
  const nav = new AttendanceReminderNavigation(options), t: AttendanceReminderTarget = { kind: "period_due", workerId: m.scope.workerId, intentId: m.query.intentId };
  assert.equal(calls.length, 0); const got = await nav.freshPeriod(t); assert.equal(got.data.kind, "detail");
  assert(calls[0].startsWith(CYCLE_INTENT_API + "?")); assert.deepEqual(parseCycleIntentHttpQuery("https://local.invalid" + calls[0]), m.query);
  assert.equal(values.size, 0);
  for (const key of [cycleIntentPendingKey(cycleSite, cycleOwner), periodClosurePendingKey(cycleSite, "owner", cycleOwner)]) {
    values.set(key, "unknown original"); await assert.rejects(nav.freshPeriod(t)); assert.equal(calls.length, 1); assert.equal(values.get(key), "unknown original"); values.delete(key);
  }
  await assert.rejects(nav.freshPeriod({ ...t, intentId: routingId(99) })); assert.equal(calls.length, 2);
  await assert.rejects(nav.freshPeriod({ ...t, grantId: routingId(99) } as AttendanceReminderTarget)); assert.equal(calls.length, 2);
});
test("201 original navigation makes one fresh GET, verifies saved head and returns full original identity only", async () => {
  const x = fixture(), ref = await x.client.freshOriginal(target); assert.deepEqual(ref, f.request); assert.ok(Object.isFrozen(ref)); assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].init?.method, "GET"); assert.ok(x.calls[0].url.startsWith(REVIEW_ROUTING_API + "?"));
  assert.deepEqual(parseReviewRoutingHttpQuery("https://local.invalid" + x.calls[0].url), f.query); assert.equal(x.values.size, 0);
});
test("201 raw reminder/original correction/routing pending of any format blocks fresh navigation with 0HTTP", async () => {
  for (const key of [attendanceReminderPendingKey(routingSite, routingOwner), correctionDecisionKey(routingSite, routingOwner), reviewRoutingPendingKey(routingSite, routingOwner)]) {
    const x = fixture(); x.values.set(key, "{"); await assert.rejects(x.client.freshOriginal(target)); assert.equal(x.calls.length, 0); assert.equal(x.values.get(key), "{");
  }
});
test("201 head movement, terminal request status and lost binding reject even valid recomputed 198 fingerprints", async () => {
  for (const kind of ["revision", "operation", "status", "binding"] as const) {
    if (kind === "revision" || kind === "operation") {
      const x = fixture(); await assert.rejects(x.client.freshOriginal({ ...target, kind: "pending_review", ...(kind === "revision" ? { responsibilityRevision: 2 } : { responsibilityOperationId: routingId(88) }) })); continue;
    }
    const d = routingDetail(); if (d.wire.data.kind !== "detail") throw Error();
    const observation = routingObservation(d.request, d.current, routingOwner, kind === "status" ? { status: "approved", routeState: "closed" } : { bindingCurrent: false });
    const wire = routingResult({ ...d.wire.data, observation });
    const x = fixture({ response: () => reply({ ok: true, data: wire }) }); await assert.rejects(x.client.freshOriginal(target)); assert.equal(x.calls.length, 1);
  }
});
test("201 Auth/pause and raw-slot races fence a late navigation GET without writing anything", async () => {
  for (const kind of ["pause", "auth", "slot"] as const) {
    let resolve!: (r: Response) => void, current = true; const late = new Promise<Response>(yes => { resolve = yes; });
    const x = fixture({ response: () => late, current: () => current }); const work = x.client.freshOriginal(target); await new Promise(yes => setTimeout(yes, 0));
    if (kind === "pause") x.client.pause(); else if (kind === "auth") current = false; else x.values.set(correctionDecisionKey(routingSite, routingOwner), "unknown");
    resolve(reply({ ok: true, data: f.wire })); await assert.rejects(work); assert.equal(x.calls.length, 1); assert.notEqual(x.client.getSnapshot().phase, "ready");
  }
});
test("201 fresh navigation stream deadline is bounded and cancels without auto-followup", async () => {
  let cancelled = false; const x = fixture({ timeoutMs: 8, response: () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(x.client.freshOriginal(target)); assert.equal(cancelled, true); assert.equal(x.calls.length, 1); assert.equal(x.client.hasLeaveRisk(), false);
});
