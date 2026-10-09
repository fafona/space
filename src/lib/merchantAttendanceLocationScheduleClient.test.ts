import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceLocationScheduleClient, locationSchedulePendingKey, parseLocationSchedulePending, type LocationScheduleStorage } from "./merchantAttendanceLocationScheduleClient";
import { attendanceLocationClockPendingKey } from "./merchantAttendanceLocationClockClient";
import { attendancePendingKey } from "./merchantAttendanceSelfClient";
import { selfSchedulePendingKey } from "./merchantAttendanceSelfScheduleClient";
import { parseLocationScheduleBody } from "./merchantAttendanceLocationSchedule";
import { locationScheduleCommand, locationScheduleEmployee as employeeId, locationScheduleHttp, locationScheduleId as id,
  locationScheduleSelection as selection, locationScheduleSite as siteId } from "../../scripts/fixtures/attendance-location-schedule-model";

const workerId = id(3), key = locationSchedulePendingKey(siteId, employeeId);
const response = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status, headers: { "content-type": "application/json" } });
function pending() {
  const { position: _p, positionFailure: _f, ...intent } = locationScheduleCommand(); void _p; void _f;
  return { version: 1 as const, siteId, employeeId, intent, selection: { ...selection } };
}
function harness(initial?: string) {
  const values = new Map<string, string>(initial ? [[key, initial]] : []), calls: { method: string; url: string; body?: unknown }[] = [];
  let record: ReturnType<typeof locationScheduleHttp> | null = null, visible = true, secure = true, gps = 0, canStart = true;
  let getHook: (() => Promise<Response> | Response) | null = null, postHook: ((raw: ReturnType<typeof locationScheduleHttp>) => Promise<Response> | Response) | null = null;
  let geoHook: (() => void) | null = null, storageHook: (() => void) | null = null;
  const storage: LocationScheduleStorage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); storageHook?.(); }, removeItem: name => { values.delete(name); } };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", parsed = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ method, url, body: parsed });
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    if (method === "GET") {
      if (getHook) return getHook();
      if (record && new URL(url, "https://example.test").searchParams.get("operationId") === record.clock.receipt!.operationId) {
        const replay = structuredClone(record); replay.clock.replayed = false; return response(replay);
      }
      const raw = locationScheduleHttp();
      if (record) { raw.clock.state = structuredClone(record.clock.state); raw.clock.finish = record.clock.finish; raw.choices.entries = []; }
      return response(raw);
    }
    assert.equal(url, "/api/merchant-enterprise/attendance/location-schedule");
    const body = parseLocationScheduleBody(parsed), saved = values.get(key); assert.ok(saved); assert.ok(!saved.includes("latitude")); assert.ok(!saved.includes("capturedAt"));
    const raw = locationScheduleHttp(true), command = body.command;
    raw.clock.receipt!.operationId = command.operationId; raw.clock.state.lastEvent!.operationId = command.operationId;
    const { expectedWorkerId: _w, position: _p, positionFailure: _f, ...intent } = command; void _w; void _p; void _f;
    raw.clock.receiptGate!.command = intent; raw.association!.operationId = command.operationId; raw.adoption!.operationId = command.operationId;
    raw.association!.selection = body.selection;
    if (!body.selection) { raw.association!.status = "unselected"; raw.association!.slot = null; raw.association!.currentCancelled = null;
      raw.adoption!.status = "unselected"; raw.adoption!.approval = null; }
    if (command.positionFailure) { Object.assign(raw.clock.locationResult!, { reason: command.positionFailure, needsReview: true, capturedAt: null, accuracyMeters: null, distanceMeters: null }); }
    if (postHook) return postHook(raw);
    record = structuredClone(raw); return response(raw);
  };
  const environment = { isSecureContext: () => secure, isVisible: () => visible, geolocation: () => ({ getCurrentPosition: (success: PositionCallback) => {
    gps++; if (geoHook) { geoHook(); return; }
    queueMicrotask(() => success({ timestamp: Date.parse(locationScheduleCommand().position!.capturedAt), coords: { latitude: 37.3, longitude: -5.9, accuracy: 10 } } as GeolocationPosition));
  } } as Geolocation) };
  const create = (enabled = true, timeoutMs = 1000) => new AttendanceLocationScheduleClient({ siteId, employeeId, workerId, canClock: true, enabled, apiFetch, storage: () => storage,
    environment, randomId: () => id(5), timeoutMs, locationTimeoutMs: 100, canStart: () => canStart });
  return { values, calls, storage, create, get gps() { return gps; }, set visible(v: boolean) { visible = v; }, set secure(v: boolean) { secure = v; }, set canStart(v: boolean) { canStart = v; },
    set getHook(v: typeof getHook) { getHook = v; }, set postHook(v: typeof postHook) { postHook = v; }, set geoHook(v: typeof geoHook) { geoHook = v; },
    set storageHook(v: typeof storageHook) { storageHook = v; }, commit: (raw: ReturnType<typeof locationScheduleHttp>) => { record = structuredClone(raw); } };
}
async function ready(h: ReturnType<typeof harness>) { const client = h.create(); await client.initialize(); await client.refresh(); assert.equal(client.getSnapshot().phase, "ready"); return client; }

test("initialization is local-only even enabled; disabled fresh refresh has zero HTTP/GPS", async () => {
  const h = harness(), client = h.create(); await client.initialize(); assert.equal(client.getSnapshot().phase, "idle"); assert.equal(h.calls.length, 0); assert.equal(h.gps, 0);
  const off = h.create(false); await off.initialize(); await off.refresh(); assert.equal(h.calls.length, 0);
});
test("explicit selected clock-in persists intent before POST then settles verified association/adoption", async () => {
  const h = harness(), client = await ready(h); await client.submit(selection); assert.equal(client.getSnapshot().confirmed?.adoption?.status, "adopted");
  assert.deepEqual(h.calls.map(c => c.method), ["GET", "GET", "POST"]); assert.equal(h.gps, 1); assert.equal(h.values.has(key), false); assert.equal(client.blocksOtherActions(), false);
  assert.ok(Object.isFrozen(client.getSnapshot().result?.clock.state));
});
test("explicit none is not implicit and yields unselected separate from missing approval", async () => {
  const h = harness(), client = await ready(h); assert.equal(h.calls.length, 1); await client.submit(null); assert.equal(client.getSnapshot().result?.association?.status, "unselected");
  assert.equal(client.getSnapshot().result?.adoption?.status, "unselected");
});
test("explicit no-position uses no GPS and records reviewed reason, not implicit fallback", async () => {
  const h = harness(), client = await ready(h); await client.submit(selection, "not_provided"); assert.equal(h.gps, 0);
  assert.equal(client.getSnapshot().confirmed?.clock.locationResult?.needsReview, true);
});
test("lost successful response reload is local then GET recovers without second POST/GPS", async () => {
  const h = harness(), client = await ready(h); h.postHook = raw => { h.commit(raw); throw Error("lost"); }; await client.submit(selection);
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(h.values.get(key)); const count = h.calls.length;
  const reload = h.create(false); await reload.initialize(); assert.equal(h.calls.length, count); await reload.retry(); assert.equal(h.calls.length, count);
  await reload.refresh(); assert.equal(reload.getSnapshot().confirmed?.association?.status, "linked"); assert.equal(h.calls.filter(c => c.method === "POST").length, 1); assert.equal(h.gps, 1);
});
test("undelivered POST explicit retry GETs first with exact original selection and new position only", async () => {
  const h = harness(), client = await ready(h); h.postHook = () => { throw Error("undelivered"); }; await client.submit(selection);
  const original = h.values.get(key); await client.refresh(); assert.equal(h.values.get(key), original); assert.equal(h.calls.filter(c => c.method === "POST").length, 1);
  h.postHook = null; await client.retry(); assert.equal(h.gps, 2); assert.equal(h.calls.at(-2)?.method, "GET");
  const bodies = h.calls.filter(c => c.method === "POST").map(c => parseLocationScheduleBody(c.body));
  assert.deepEqual(bodies[0].selection, bodies[1].selection); assert.equal(bodies[0].command.operationId, bodies[1].command.operationId); assert.equal(h.values.has(key), false);
});
test("pending storage is scoped, strict, duplicate-safe and coordinate-free", () => {
  const raw = JSON.stringify(pending()); assert.ok(Object.isFrozen(parseLocationSchedulePending(raw, siteId, employeeId).intent));
  assert.throws(() => parseLocationSchedulePending(raw, siteId, id(99))); assert.throws(() => parseLocationSchedulePending(raw.replace('"version":1', '"version":1,"version":1'), siteId, employeeId));
  for (const patch of [{ extra: true }, { version: 2 }, { intent: { ...pending().intent, action: "clock_out" } }, { intent: { ...pending().intent, position: {} } }])
    assert.throws(() => parseLocationSchedulePending(JSON.stringify({ ...pending(), ...patch }), siteId, employeeId));
});
test("malformed pending blocks rather than overwrites", async () => {
  const h = harness("{}"); const client = h.create(); await client.initialize(); await client.refresh(); assert.equal(client.getSnapshot().phase, "storage_error"); assert.equal(h.calls.length, 0); assert.equal(h.values.get(key), "{}");
});
test("all original pending namespaces prevent a new POST before GPS", async () => {
  for (const other of [attendancePendingKey(siteId, employeeId), selfSchedulePendingKey(siteId, employeeId), attendanceLocationClockPendingKey(siteId, employeeId), `faolla:attendance:self-schedule-adoption:v1:${siteId}:${employeeId}`, `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`]) {
    const h = harness(), client = await ready(h); h.values.set(other, "opaque original pending"); await client.submit(selection); assert.equal(h.gps, 0); assert.equal(h.calls.length, 1); assert.equal(h.values.get(other), "opaque original pending");
  }
});
test("legacy state becomes busy during GPS and prevents subsequent POST", async () => {
  const h = harness(), client = await ready(h); h.geoHook = () => { h.canStart = false; client.pause(); }; await client.submit(selection);
  assert.equal(h.calls.filter(c => c.method === "POST").length, 0); assert.equal(h.values.size, 0);
});
test("loading subscriber pause stops HTTP; locating subscriber pause stops GPS", async () => {
  for (const phase of ["loading", "locating"] as const) {
    const h = harness(), client = await ready(h); const before = h.calls.length;
    client.subscribe(() => { if (client.getSnapshot().phase === phase) client.pause(); }); await client.submit(selection);
    assert.equal(h.gps, 0); assert.equal(h.calls.length, before + (phase === "locating" ? 1 : 0)); assert.equal(h.values.size, 0);
  }
});
test("submitting subscriber pause preserves original pending and never sends POST", async () => {
  const h = harness(), client = await ready(h); client.subscribe(() => { if (client.getSnapshot().phase === "submitting") client.pause(); }); await client.submit(selection);
  assert.equal(h.calls.filter(c => c.method === "POST").length, 0); assert.ok(h.values.get(key)); assert.equal(client.getSnapshot().phase, "unconfirmed");
});
test("storage hooks hiding or replacing pending cannot continue POST or overwrite", async () => {
  for (const action of ["hide", "replace"] as const) {
    const h = harness(), client = await ready(h); h.storageHook = () => { if (action === "hide") { h.visible = false; client.pause(); } else h.values.set(key, "foreign"); };
    await client.submit(selection); assert.equal(h.calls.filter(c => c.method === "POST").length, 0); assert.ok(h.values.get(key));
    if (action === "replace") assert.equal(h.values.get(key), "foreign");
  }
});
test("settlement removal failure keeps pending blocked with no visible receipt", async () => {
  const h = harness(), client = await ready(h); h.storage.removeItem = () => {}; await client.submit(selection);
  assert.equal(client.getSnapshot().phase, "storage_error"); assert.ok(client.getSnapshot().pending); assert.equal(client.getSnapshot().confirmed, null);
});
test("GET auth denial clears display but preserves original pending", async () => {
  const h = harness(JSON.stringify(pending())), client = h.create(); await client.initialize(); h.getHook = () => response({ ok: false, error: "attendance_access_denied" }, 403);
  await client.refresh(); assert.equal(client.getSnapshot().result, null); assert.ok(client.getSnapshot().pending); assert.ok(h.values.get(key));
});
test("malformed or mismatched business error is unknown; strict fresh rejection alone may settle", async () => {
  for (const [body, status, retained] of [[{ ok: false, error: "attendance_notice_required" }, 409, false], [{ ok: false, error: "attendance_notice_required", extra: true }, 409, true], [{ ok: false, error: "attendance_notice_required" }, 403, true]] as const) {
    const h = harness(), client = await ready(h); h.postHook = () => response(body, status); await client.submit(selection); assert.equal(!!client.getSnapshot().pending, retained);
  }
});
test("retry rejection never clears an already uncertain original ID", async () => {
  const h = harness(JSON.stringify(pending())), client = h.create(); await client.initialize(); h.postHook = () => response({ ok: false, error: "attendance_notice_required" }, 409);
  await client.retry(); assert.ok(client.getSnapshot().pending); assert.ok(h.values.get(key));
});
test("recovered receipt must match every original intent field, not just operation", async () => {
  const h = harness(JSON.stringify(pending())), client = h.create(); await client.initialize(); const raw = locationScheduleHttp(true);
  raw.clock.receiptGate!.command.settingsVersion++; h.getHook = () => response(raw); await client.refresh(); assert.ok(client.getSnapshot().pending); assert.equal(client.getSnapshot().result, null);
});
test("selected slot or policy changing at mandatory preflight prevents GPS and POST", async () => {
  for (const changed of ["slot", "policy"] as const) { const h = harness(), client = await ready(h), raw = locationScheduleHttp();
    if (changed === "slot") raw.choices.entries = []; else raw.clock.policy!.settingsVersion++;
    h.getHook = () => response(raw); await client.submit(selection); assert.equal(h.gps, 0); assert.equal(h.values.size, 0);
  }
});
test("body timeout, invalid UTF8 and 64KiB overflow clear no pending", async () => {
  for (const kind of ["timeout", "utf8", "oversize"] as const) {
    const h = harness(JSON.stringify(pending())), client = h.create(true, 20); await client.initialize();
    h.getHook = () => new Response(new ReadableStream<Uint8Array>({ start(c) {
      if (kind === "timeout") return; c.enqueue(kind === "utf8" ? Uint8Array.of(0xff) : new Uint8Array(65537).fill(32)); c.close();
    } }), { headers: { "content-type": "application/json" } });
    await client.refresh(); assert.ok(client.getSnapshot().pending); assert.equal(client.getSnapshot().result, null);
  }
});
test("late GET after pause cannot resurrect data or consume pending", async () => {
  const h = harness(JSON.stringify(pending())), client = h.create(); await client.initialize(); let release: (response: Response) => void = () => {};
  h.getHook = () => new Promise(resolve => { release = resolve; }); const work = client.refresh(); await Promise.resolve(); client.pause(); release(response(locationScheduleHttp(true))); await work;
  assert.equal(client.getSnapshot().result, null); assert.ok(client.getSnapshot().pending); assert.ok(h.values.get(key));
});
