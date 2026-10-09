import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { readRetentionWorkers, readRetentionPeriods } from "./merchantAttendanceRetentionDirectory";
const site = "99990228", actor = "00000000-0000-4000-8000-000227000001", worker = "00000000-0000-4000-8000-000227000002";
const signal = () => new AbortController().signal;
const body = () => ({ ok: true, siteId: site, version: 1, settings: { timeZone: "UTC", enabled: false, webClockEnabled: false, webBreakPaid: false },
  view: "workers", items: [{ id: worker, employeeId: actor, workerNo: "R1", displayName: "Synthetic directory", locationId: "00000000-0000-4000-8000-000227000003", active: false, startsOn: "2026-01-01" }], nextCursor: null, receipt: null, moduleEnabled: false });
test("worker picker performs exactly one explicit GET and keeps inactive historical selection", async () => {
  const calls: string[] = []; const api: AttendanceApiFetch = async (url, init) => { calls.push(String(url)); assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined); return Response.json(body()); };
  const r = await readRetentionWorkers(api, site, signal(), "Synthetic"); assert.equal(calls.length, 1); assert.match(calls[0], /search=Synthetic/); assert.equal(r.items[0].active, false); assert.equal(r.nextCursor, null);
});
test("invalid scope and directory shape cannot authorize or expose a result", async () => {
  let called = 0; const api: AttendanceApiFetch = async () => { called++; return Response.json(body()); };
  await assert.rejects(readRetentionWorkers(api, "../wrong", signal())); assert.equal(called, 0);
  for (const patch of [{ siteId: "99990229" }, { receipt: { operationId: actor, version: 1, kind: "worker", targetId: worker } }, { extra: true }, { view: "employees" }])
    await assert.rejects(readRetentionWorkers(async () => Response.json({ ...body(), ...patch }), site, signal()));
});
test("non-200, HTML, over-budget and malformed UTF8 directory responses fail closed", async () => {
  for (const response of [Response.json(body(), { status: 201 }), new Response("<html>"), Response.json({ pad: "x".repeat(131073) }), new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })])
    await assert.rejects(readRetentionWorkers(async () => response, site, signal()));
});
test("abort before or during ignored-signal fetch returns without stale data", async () => {
  const already = new AbortController(); already.abort(); let calls = 0;
  await assert.rejects(readRetentionWorkers(async () => { calls++; return Response.json(body()); }, site, already.signal)); assert.equal(calls, 0);
  const controller = new AbortController(); const waiting = readRetentionWorkers(async () => new Promise<Response>(() => {}), site, controller.signal);
  controller.abort(); await assert.rejects(waiting, /directory_aborted/);
});
test("period directory validates exact dates and actual owner envelope", async () => {
  let called = 0; const api: AttendanceApiFetch = async (url, init) => { called++; assert.equal(init?.method, "GET"); assert.match(String(url), /mode=list/);
    return Response.json({ ok: true, moduleEnabled: false, data: { protocol: "period-closure-v1", siteId: site, workerId: worker, actorId: actor, access: "owner", readAt: "2026-10-07T12:00:00.000000Z", kind: "list", items: [] } }); };
  assert.deepEqual(await readRetentionPeriods(api, site, actor, worker, "2026-10-01", "2026-10-07", signal()), []);
  await assert.rejects(readRetentionPeriods(api, site, actor, worker, "2026-01-01", "2026-10-07", signal())); assert.equal(called, 1);
  await assert.rejects(readRetentionPeriods(api, site, "00000000-0000-4000-8000-000227000009", worker, "2026-10-01", "2026-10-07", signal()));
});
