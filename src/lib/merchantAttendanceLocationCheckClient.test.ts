import assert from "node:assert/strict";
import test from "node:test";
import { acquireAttendancePosition, AttendanceLocationCheckClient } from "./merchantAttendanceLocationCheckClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { siteId: "99990001", expectedWorkerId: id(2), expectedLocationId: id(3) };
const policy = { settingsVersion: 1, workerVersion: 2, locationVersion: 3, siteId: target.siteId, employeeId: id(1), workerId: id(2), locationId: id(3), checkedAt: "2026-09-30T10:00:00.000Z", maxAgeMs: 60000, diagnosticOnly: true, punchRecorded: false };
const position = { timestamp: Date.parse(policy.checkedAt), coords: { latitude: 37.3, longitude: -5.9, accuracy: 10, altitude: 500, heading: 123 } } as GeolocationPosition;
function fakeDevice() {
  let success: PositionCallback = () => {}, failure: PositionErrorCallback = () => {};
  const calls: PositionOptions[] = [];
  return { geo: { getCurrentPosition: (s: PositionCallback, f?: PositionErrorCallback | null, o?: PositionOptions) => { calls.push(o!); success = s; failure = f!; } }, calls,
    success: (p = position) => success(p), error: (code = 1) => failure({ code, message: "private native error" } as GeolocationPositionError) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(extra: { fetch?: AttendanceApiFetch; timeoutMs?: number; locationTimeoutMs?: number } = {}) {
  const device = fakeDevice(), calls: { url: string; init?: RequestInit }[] = [];
  let secure = true, visible = true, supported = true;
  const client = new AttendanceLocationCheckClient({ ...target, employeeId: id(1), timeoutMs: extra.timeoutMs ?? 1000, locationTimeoutMs: extra.locationTimeoutMs ?? 1000,
    environment: { isSecureContext: () => secure, isVisible: () => visible, geolocation: () => supported ? device.geo : null },
    apiFetch: async (url, init) => { calls.push({ url, init }); return extra.fetch ? extra.fetch(url, init) : Response.json({ ok: true, moduleEnabled: true, ...policy,
      ...(init?.method === "POST" ? { reason: "inside", needsReview: false, distanceMeters: 0 } : {}) }); } });
  return { client, device, calls, secure: (v: boolean) => { secure = v; }, visible: (v: boolean) => { visible = v; }, supported: (v: boolean) => { supported = v; } };
}
test("one-shot uses fresh high-accuracy request, strips altitude/speed and accepts no tracking API", async () => {
  const d = fakeDevice(), p = acquireAttendancePosition(d.geo, new AbortController().signal);
  assert.deepEqual(d.calls, [{ maximumAge: 0, enableHighAccuracy: true, timeout: 10000 }]); d.success();
  assert.deepEqual(await p, { latitude: 37.3, longitude: -5.9, accuracyMeters: 10, capturedAt: policy.checkedAt });
});
for (const [code, message] of [[1, "denied"], [2, "unavailable"], [3, "timeout"], [99, "unavailable"]] as const) test(`native error ${code} is sanitized`, async () => {
  const d = fakeDevice(), promise = acquireAttendancePosition(d.geo, new AbortController().signal); d.error(code); await assert.rejects(promise, new RegExp(`location_${message}`));
});
test("own deadline includes unresponded permission prompt; retry cannot create overlapping native request", async () => {
  const d = fakeDevice(); await assert.rejects(acquireAttendancePosition(d.geo, new AbortController().signal, 5), /location_timeout/);
  await assert.rejects(acquireAttendancePosition(d.geo, new AbortController().signal), /location_device_pending/);
  assert.equal(d.calls.length, 1); d.success();
  const fresh = acquireAttendancePosition(d.geo, new AbortController().signal); d.success(); await fresh; assert.equal(d.calls.length, 2);
});
test("abort ignores late coordinates and prevents overlaps across remounts", async () => {
  const d = fakeDevice(), c = new AbortController(), promise = acquireAttendancePosition(d.geo, c.signal); c.abort(); await assert.rejects(promise, /aborted/);
  await assert.rejects(acquireAttendancePosition(d.geo, new AbortController().signal), /location_device_pending/);
  d.success(); const fresh = acquireAttendancePosition(d.geo, new AbortController().signal); d.error(); await assert.rejects(fresh, /location_denied/);
});
test("pre-aborted and invalid deadlines make no device request; malformed result never passes", async () => {
  const d = fakeDevice(), c = new AbortController(); c.abort(); await assert.rejects(acquireAttendancePosition(d.geo, c.signal), /aborted/);
  for (const timeout of [0, -1, NaN, 15001]) await assert.rejects(acquireAttendancePosition(d.geo, new AbortController().signal, timeout), /invalid_timeout/);
  assert.equal(d.calls.length, 0);
  const promise = acquireAttendancePosition(d.geo, new AbortController().signal); d.success({ ...position, timestamp: NaN }); await assert.rejects(promise, /invalid_position/);
  await assert.rejects(acquireAttendancePosition({ getCurrentPosition() { throw Error("native secret"); } }, new AbortController().signal), /location_unavailable/);
});
test("controller is idle until click, checks server before GPS and submits only one bounded-body diagnostic", async () => {
  const s = setup(); assert.equal(s.calls.length, 0); assert.equal(s.device.calls.length, 0);
  const run = s.client.run(); await tick(); assert.equal(s.calls.length, 1); assert.equal(s.device.calls.length, 1);
  await s.client.run(); assert.equal(s.device.calls.length, 1); s.device.success(); await run;
  assert.equal(s.calls.length, 2); const post = s.calls[1]; assert.equal(post.url, "/api/merchant-enterprise/attendance/location-check"); assert.equal(post.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(post.init?.body)), { ...target, settingsVersion: 1, workerVersion: 2, locationVersion: 3,
    position: { latitude: 37.3, longitude: -5.9, accuracyMeters: 10, capturedAt: policy.checkedAt } });
  assert.equal(s.client.getSnapshot().phase, "ready"); assert.equal(s.client.getSnapshot().result?.punchRecorded, false);
  assert.doesNotMatch(JSON.stringify(s.client.getSnapshot()), /latitude|longitude|altitude/);
  assert.match(s.client.getSnapshot().message, /未提交打卡/);
  s.client.invalidate(); assert.equal(s.client.getSnapshot().result, null); assert.equal(s.calls.length, 2);
});
test("insecure/hidden pages do not call server/device; unsupported device does not POST", async () => {
  for (const mode of ["secure", "visible"] as const) { const s = setup(); s[mode](false); await s.client.run(); assert.equal(s.calls.length, 0); assert.equal(s.device.calls.length, 0); assert.equal(s.client.getSnapshot().phase, "blocked"); }
  const s = setup(); s.supported(false); await s.client.run(); assert.equal(s.calls.length, 1); assert.equal(s.client.getSnapshot().phase, "blocked");
});
for (const change of [{ employeeId: id(99) }, { workerId: id(99) }, { siteId: "99990002" }, { locationId: id(99) }, { punchRecorded: true }, { moduleEnabled: false }])
  test(`bad preparation never requests GPS: ${JSON.stringify(change)}`, async () => {
    const s = setup({ fetch: async () => Response.json({ ok: true, moduleEnabled: true, ...policy, ...change }) }); await s.client.run();
    assert.equal(s.device.calls.length, 0); assert.equal(s.calls.length, 1); assert.equal(s.client.getSnapshot().phase, "blocked");
  });
test("disabled/denied preparation, HTML and oversized responses do not collect coordinates", async () => {
  for (const response of [Response.json({ ok: false, error: "attendance_not_available" }, { status: 404 }),
    Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }), new Response("login"),
    Response.json({ ok: true, moduleEnabled: true, ...policy, extra: "x".repeat(9000) })]) {
    const s = setup({ fetch: async () => response }); await s.client.run(); assert.equal(s.device.calls.length, 0); assert.equal(s.client.getSnapshot().result, null);
  }
});
test("hidden/cancelled during native prompt clears state, late callback never sends POST", async () => {
  const s = setup(), run = s.client.run(); await tick(); s.visible(false); s.client.invalidate(); s.device.success(); await run;
  assert.equal(s.calls.length, 1); assert.equal(s.client.getSnapshot().result, null); assert.equal(s.client.getSnapshot().phase, "idle");
});
test("permission denial and position deadline send no coordinates or empty evidence to server", async () => {
  const s = setup(), run = s.client.run(); await tick(); s.device.error(); await run; assert.equal(s.calls.length, 1); assert.equal(s.client.getSnapshot().phase, "blocked");
  const timed = setup({ locationTimeoutMs: 5 }); await timed.client.run(); assert.equal(timed.calls.length, 1); timed.device.success();
});
test("lost diagnostic POST is not retried and never leaves a stale positive result", async () => {
  const s = setup({ fetch: async (_, init) => { if (init?.method === "POST") throw Error("lost"); return Response.json({ ok: true, moduleEnabled: true, ...policy }); } });
  const run = s.client.run(); await tick(); s.device.success(); await run;
  assert.equal(s.calls.length, 2); assert.equal(s.client.getSnapshot().result, null); assert.equal(s.client.getSnapshot().phase, "blocked");
});
test("late response after cancel and changed rule/employee after location cannot appear successful", async () => {
  let release: ((r: Response) => void) | undefined;
  const s = setup({ fetch: async (_, init) => init?.method === "POST" ? new Promise(resolve => { release = resolve; }) : Response.json({ ok: true, moduleEnabled: true, ...policy }) });
  const run = s.client.run(); await tick(); s.device.success(); await tick(); s.client.invalidate();
  release!(Response.json({ ok: true, moduleEnabled: true, ...policy, reason: "inside", needsReview: false, distanceMeters: 0 })); await run;
  assert.equal(s.client.getSnapshot().result, null); assert.equal(s.client.getSnapshot().phase, "idle");
  for (const bad of [{ employeeId: id(9) }, { settingsVersion: 9 }, { workerVersion: 9 }, { locationVersion: 9 }]) {
    const changed = setup({ fetch: async (_, init) => Response.json({ ok: true, moduleEnabled: true, ...policy,
      ...(init?.method === "POST" ? { ...bad, reason: "inside", needsReview: false, distanceMeters: 0 } : {}) }) });
    const pending = changed.client.run(); await tick(); changed.device.success(); await pending; assert.equal(changed.client.getSnapshot().result, null);
  }
});
test("HTTP deadline covers hanging headers and body without location/retry", async () => {
  for (const fetch of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } })]) {
    const s = setup({ fetch, timeoutMs: 5 }); await s.client.run(); assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(s.device.calls.length, 0); assert.equal(s.calls.length, 1);
  }
});
