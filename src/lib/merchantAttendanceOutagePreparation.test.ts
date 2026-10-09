import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceOutageClient } from "./merchantAttendanceOutageClient";
import { parseOutageSubjectResponse, type OutageSubjectQuery, type OutageSubjectResult } from "./merchantAttendanceOutageSubject";
import { outageCommandFingerprint } from "./merchantAttendanceOutage.server";
import type { OutageCommand, OutageQuery } from "./merchantAttendanceOutageContract";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), employee = id(2), workerId = id(3), incidentId = id(4), declarationId = id(5), operationId = id(6);
const at = "2026-10-07T12:00:00.000000Z", interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 };
const draft = { action: "declare", incidentId, declarationId, workerId, employeeId: id(7), employeeAuthUserId: employee,
  expectedWorkerVersion: 5, expectedEmployeeVersion: 8, expectedGeneration: 2, interval, statement: "本人明确故障声明", originalOperationId: null, originalChannel: null, paperReference: null };
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
function fixture(access: "owner" | "self" = "self", enabled = true) {
  const actor = access === "self" ? employee : owner, values = new Map<string, string>(), calls: { url: string; init?: RequestInit }[] = [];
  const q: OutageSubjectQuery = { siteId, access, workerId: access === "owner" ? workerId : null, incidentId };
  const write: OutageQuery = { siteId, access, mode: "declaration", declarationId };
  const result: OutageSubjectResult = { protocol: "attendance-outage-subject-v1", siteId, access, actorId: actor, readAt: at, canWrite: true,
    subject: { workerId, employeeId: id(7), employeeAuthUserId: employee, workerVersion: 5, employeeVersion: 8, generation: 2, displayName: "准备核验员工", active: true, paused: false },
    incident: { id: incidentId, type: "network", channel: "web", locationId: null, interval } };
  let intercept: (() => Promise<Response>) | null = null;
  const apiFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init }); if (intercept) return intercept();
    if (url.includes("outage-subject?")) { const body = { ok: true, canWrite: true, data: result }; parseOutageSubjectResponse(body, q, actor); return json(body); }
    const command = JSON.parse(String(init?.body)).command as OutageCommand;
    return json({ ok: true, canWrite: true, data: { protocol: "attendance-outage-v1", siteId, access, actorId: actor, readAt: at, mode: "declaration", canWrite: false,
      items: [], detail: null, nextId: null, receipt: { operationId, action: "declare", incidentId, recordId: declarationId, actorId: actor, recordedAt: at,
        commandFingerprint: outageCommandFingerprint(write, command) } } });
  };
  const client = new AttendanceOutageClient({ kind: "outages", siteId, access, actorId: actor, enabled, operationId: () => operationId, apiFetch,
    storage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }) });
  return { client, q, write, result, values, calls, intercept: (f: (() => Promise<Response>) | null) => { intercept = f; } };
}
for (const access of ["owner", "self"] as const) test(`${access} declaration uses explicit current preparation and clears it after exact receipt`, async () => {
  const f = fixture(access); await f.client.initialize(); assert.equal(f.calls.length, 0); await f.client.prepare(f.q);
  assert.equal(f.client.getSnapshot().prepared?.subject.workerVersion, 5); assert.equal(f.client.getSnapshot().query, null);
  assert.equal(f.client.getSnapshot().result, null); assert(Object.isFrozen(f.client.getSnapshot().prepared?.subject));
  await f.client.submit(f.write, draft); assert.equal(f.client.getSnapshot().prepared, null); assert.equal(f.client.getSnapshot().pending, null);
  assert.equal(f.client.getSnapshot().result?.receipt?.operationId, operationId); assert.equal(f.values.size, 0);
  assert.deepEqual(f.calls.map(x => x.init?.method), ["GET", "POST"]);
  await f.client.submit(f.write, draft); assert.equal(f.calls.length, 2);
});
for (const [field, wrong] of Object.entries({ workerId: id(80), employeeId: id(81), employeeAuthUserId: id(82), expectedWorkerVersion: 4,
  expectedEmployeeVersion: 7, expectedGeneration: 1, incidentId: id(83) })) test(`current preparation rejects substituted ${field} without any POST or stored intent`, async () => {
  const f = fixture(); await f.client.initialize(); await f.client.prepare(f.q); await f.client.submit(f.write, { ...draft, [field]: wrong });
  assert.equal(f.calls.length, 1); assert.equal(f.values.size, 0); assert.equal(f.client.getSnapshot().prepared, null);
});
test("pause, reinitialize and a later failed read all invalidate a prepared subject", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.prepare(f.q); f.client.pause(); await f.client.submit(f.write, draft);
  assert.equal(f.calls.length, 1); await f.client.prepare(f.q); await f.client.initialize(); assert.equal(f.client.getSnapshot().prepared, null);
  await f.client.prepare(f.q); f.intercept(async () => { throw Error("network"); }); await f.client.prepare(f.q);
  assert.equal(f.client.getSnapshot().prepared, null); await f.client.submit(f.write, draft); assert.equal(f.calls.length, 4); assert.equal(f.values.size, 0);
});
test("preparation remains read-only when the UI or authoritative write gate is closed", async () => {
  for (const gate of ["ui", "server"] as const) { const f = fixture("self", gate !== "ui"); if (gate === "server") f.result.canWrite = false;
    await f.client.initialize(); await f.client.prepare(f.q); await f.client.submit(f.write, draft); assert.equal(f.calls.length, 1); assert.equal(f.values.size, 0); }
});
test("preparation rejects cross-scope queries and cannot override an unresolved operation", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.prepare({ ...f.q, siteId: "99990002" }); assert.equal(f.calls.length, 0);
  await f.client.prepare(f.q); f.intercept(async () => { throw Error("lost-after-submit"); }); await f.client.submit(f.write, draft);
  const raw = f.values.get(f.client.storageKey); assert(raw); await f.client.prepare(f.q);
  assert.equal(f.calls.length, 2); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().prepared, null);
});
test("late preparation cannot restore a paused scope or overwrite changed recovery storage", async () => {
  for (const action of ["pause", "replace"] as const) { const f = fixture(); await f.client.initialize();
    let done!: (r: Response) => void; f.intercept(() => new Promise(resolve => { done = resolve; })); const pending = f.client.prepare(f.q);
    await new Promise(resolve => setImmediate(resolve));
    if (action === "pause") f.client.pause(); else f.values.set(f.client.storageKey, "preserve-newer");
    done(json({ ok: true, canWrite: true, data: f.result })); await pending;
    assert.equal(f.client.getSnapshot().prepared, null); if (action === "replace") assert.equal(f.values.get(f.client.storageKey), "preserve-newer");
    await f.client.submit(f.write, draft); assert.equal(f.calls.length, 1);
  }
});
