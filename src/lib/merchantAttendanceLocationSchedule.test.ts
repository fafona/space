import assert from "node:assert/strict";
import test from "node:test";
import { locationScheduleActor, locationScheduleCommand, locationScheduleEmployee, locationScheduleHttp, locationScheduleId as id,
  locationScheduleInput, locationScheduleQuery, locationScheduleRaw, locationScheduleSelection, locationScheduleSite, locationScheduleSlot,
  locationScheduleWire } from "../../scripts/fixtures/attendance-location-schedule-model";
import { LOCATION_SCHEDULE_BYTE_LIMIT, locationScheduleQueryString, parseLocationScheduleBody, parseLocationScheduleHttpResult,
  parseLocationScheduleJson, parseLocationScheduleQuery, parseLocationScheduleResult, parseLocationScheduleServerResult,
  type LocationScheduleResult } from "./merchantAttendanceLocationSchedule";

const body = () => ({ siteId: locationScheduleSite, command: locationScheduleCommand(), selection: { ...locationScheduleSelection } });
const recovery = () => ({ ...locationScheduleInput(), operationId: locationScheduleCommand().operationId });

test("location selection preserves exact old command, none is explicit and only new starts are accepted", () => {
  assert.deepEqual(parseLocationScheduleBody(body()), body());
  assert.equal(parseLocationScheduleBody({ ...body(), selection: null }).selection, null);
  for (const change of [{ siteId: locationScheduleSite + "\n" }, { actorId: id(9) }, { moduleEnabled: true }, { adoption: {} }])
    assert.throws(() => parseLocationScheduleBody({ ...body(), ...change }), /attendance_invalid_request/);
  for (const change of [{ action: "clock_out" }, { safeFinish: true }, { operationId: id(5) + "\n" }, { settingsVersion: 0 },
    { expectedSequence: -0 }, { position: null, positionFailure: null }, { positionFailure: "inside" }, { source: "web" }])
    assert.throws(() => parseLocationScheduleBody({ ...body(), command: { ...locationScheduleCommand(), ...change } }));
  assert.throws(() => parseLocationScheduleBody({ siteId: locationScheduleSite, command: locationScheduleCommand() }));
});

test("position failures remain explicit record-and-review inputs rather than invented successful measurements", () => {
  for (const positionFailure of ["denied", "timeout", "unavailable", "unsupported", "not_provided"] as const) {
    const parsed = parseLocationScheduleBody({ ...body(), command: { ...locationScheduleCommand(), position: null, positionFailure } });
    assert.equal(parsed.command.position, null); assert.equal(parsed.command.positionFailure, positionFailure);
  }
});

test("GET exact scoped query rejects selection, arbitrary identities, null text and repeated parameters", () => {
  const text = locationScheduleQueryString(locationScheduleQuery);
  assert.deepEqual(parseLocationScheduleQuery(`https://local.invalid/?${text}`), locationScheduleQuery);
  assert.deepEqual(parseLocationScheduleQuery(`https://local.invalid/?${text}&operationId=${id(5)}`), { ...locationScheduleQuery, operationId: id(5) });
  for (const suffix of ["&selection=null", "&employeeId=" + id(2), "&operationId=null", "&siteId=" + locationScheduleSite, "&__proto__=x"])
    assert.throws(() => parseLocationScheduleQuery(`https://local.invalid/?${text}${suffix}`));
  assert.throws(() => parseLocationScheduleQuery(`https://local.invalid/?siteId=${locationScheduleSite}`));
});

test("public and private response boundaries are separate and no private fence survives projection", () => {
  for (const post of [false, true]) {
    assert.deepEqual(parseLocationScheduleResult(locationScheduleWire(post), locationScheduleInput(post)), locationScheduleWire(post));
    const projected = parseLocationScheduleServerResult(locationScheduleRaw(post), locationScheduleInput(post));
    assert.deepEqual(projected, locationScheduleWire(post));
    assert.doesNotMatch(JSON.stringify(projected), /internalFence|internalPolicyFingerprint|latitude|longitude/);
    assert.throws(() => parseLocationScheduleResult(locationScheduleRaw(post), locationScheduleInput(post)));
    assert.throws(() => parseLocationScheduleHttpResult({ ...locationScheduleHttp(post), clock: locationScheduleRaw(post).clock }, locationScheduleInput(post)));
  }
  const partial = { ...locationScheduleWire().clock, internalFence: null };
  assert.throws(() => parseLocationScheduleServerResult({ ...locationScheduleWire(), clock: partial }, locationScheduleInput()));
  for (const value of [{ ...locationScheduleRaw().clock.internalFence, latitude: 100 }, { ...locationScheduleRaw().clock.internalFence, secret: 1 }])
    assert.throws(() => parseLocationScheduleServerResult({ ...locationScheduleRaw(), clock: { ...locationScheduleRaw().clock, internalFence: value } }, locationScheduleInput()));
});

test("response copies and freezes every public nested snapshot without freezing its input", () => {
  const raw = locationScheduleHttp(true), result = parseLocationScheduleHttpResult(raw, locationScheduleInput(true));
  raw.association!.slot!.locationName = "later"; raw.adoption!.approval!.revision = 9;
  assert.equal(result.association!.slot!.locationName, "合成定位地点"); assert.equal(result.adoption!.approval!.revision, 6);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.adoption!.approval), true);
  assert.equal(Object.isFrozen(result.clock.state.lastEvent), true); assert.equal(Object.isFrozen(raw), false);
});

test("source tree rejects getters, prototypes, hidden/symbol properties, sparse arrays and dangerous keys", () => {
  let invoked = false;
  const getter = Object.defineProperty(body(), "selection", { enumerable: true, get() { invoked = true; return null; } });
  assert.throws(() => parseLocationScheduleBody(getter)); assert.equal(invoked, false);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const malformed of [Object.assign(Object.create({ x: 1 }), locationScheduleWire()),
    { ...locationScheduleWire(), [Symbol("private")]: true }, { ...locationScheduleWire(), choices: cyclic },
    Object.defineProperty(locationScheduleWire(), "hidden", { value: true }),
    { ...locationScheduleWire(), choices: { ...locationScheduleWire().choices, entries: new Array(1) } },
    JSON.parse('{"__proto__":{},"constructor":1}'), { ...locationScheduleWire(), unknown: undefined }])
    assert.throws(() => parseLocationScheduleResult(malformed, locationScheduleInput()));
});

test("strict JSON rejects duplicate escaped names, malformed Unicode and more than 64 KiB", () => {
  const json = JSON.stringify(locationScheduleHttp());
  assert.deepEqual(parseLocationScheduleJson(json), locationScheduleHttp());
  for (const bad of ['{"ok":true,"ok":false}', '{"ok":true,"\\u006fk":false}', '{"x":"\\ud800"}', '{"constructor":0}',
    JSON.stringify({ x: "x".repeat(LOCATION_SCHEDULE_BYTE_LIMIT) })]) assert.throws(() => parseLocationScheduleJson(bad));
});

test("all old public clock subobjects are exact and retain original receipt/notice checks", () => {
  const mutations: Array<(v: LocationScheduleResult) => void> = [
    v => { Object.assign(v.clock.policy!, { ignored: true }); }, v => { Object.assign(v.clock.state, { ignored: true }); },
    v => { Object.assign(v.clock.receipt!, { actorEmployeeId: locationScheduleEmployee }); },
    v => { Object.assign(v.clock.locationResult!, { latitude: 1 }); }, v => { Object.assign(v.clock.receiptGate!.command, { selection: null }); },
    v => { v.clock.locationResult!.eventId = id(77); }, v => { v.clock.receiptGate!.command.noticeRevision = 99; },
    v => { v.clock.policy = null; }, v => { v.clock.locationResult!.needsReview = true; },
    v => { v.clock.locationResult!.capturedAt = "2026-02-30T07:50:00.000Z"; },
  ];
  for (const mutate of mutations) { const v = locationScheduleWire(true); mutate(v); assert.throws(() => parseLocationScheduleResult(v, locationScheduleInput(true))); }
});

test("every successful POST including replay carries both records; historical no-sidecar GET remains readable", () => {
  for (const change of [{ association: null }, { adoption: null }, { association: null, adoption: null }])
    assert.throws(() => parseLocationScheduleResult({ ...locationScheduleWire(true), ...change }, locationScheduleInput(true)));
  const legacy = locationScheduleWire(true); legacy.association = null; legacy.adoption = null;
  assert.equal(parseLocationScheduleResult(legacy, recovery()).adoption, null);
  legacy.clock.replayed = true;
  assert.throws(() => parseLocationScheduleResult(legacy, locationScheduleInput(true)));
  const replay = locationScheduleWire(true); replay.clock.replayed = true;
  assert.equal(parseLocationScheduleResult(replay, locationScheduleInput(true)).clock.replayed, true);
});

test("ordinary GET omits selection while pending GET must match original selection including explicit none", () => {
  assert.equal(parseLocationScheduleResult(locationScheduleWire(true), recovery()).association?.status, "linked");
  assert.equal(parseLocationScheduleResult(locationScheduleWire(true), { ...recovery(), selection: { ...locationScheduleSelection } }).association?.status, "linked");
  for (const selection of [null, { slotId: id(90), revision: 3 }, { ...locationScheduleSelection, revision: 4 }])
    assert.throws(() => parseLocationScheduleResult(locationScheduleWire(true), { ...recovery(), selection }));
});

test("adoption anchors to original event, operation, channel and current dual identity", () => {
  for (const change of [{ startEventId: id(9) }, { operationId: id(9) }, { channel: "self" }, { employeeId: id(9) },
    { employeeAuthUserId: id(9) }, { policy: "current-rules" }, { recordedAt: "2026-02-30T08:00:00.123456Z" }, { recordedAt: "2026-10-08T07:50:00.123457Z" }])
    assert.throws(() => parseLocationScheduleResult({ ...locationScheduleWire(true), adoption: { ...locationScheduleWire(true).adoption!, ...change } }, locationScheduleInput(true)));
  assert.throws(() => parseLocationScheduleResult(locationScheduleWire(true), { ...locationScheduleInput(true), employeeId: id(77) }));
  assert.throws(() => parseLocationScheduleResult(locationScheduleWire(true), { ...locationScheduleInput(true), expectedWorkerId: id(77) }));
  // Browser can bind its employee scope without pretending to know a hidden Auth identity.
  const { authUserId: _auth, ...browserInput } = locationScheduleInput(true); void _auth;
  assert.equal(parseLocationScheduleResult(locationScheduleWire(true), browserInput).adoption?.employeeAuthUserId, locationScheduleActor);
});

test("adopted reference is exact; dedup source ID and approval revision are not schedule head or clock operation", () => {
  const raw = locationScheduleWire(true);
  assert.notEqual(raw.adoption!.approval!.sourceId, raw.adoption!.approval!.operationId);
  assert.ok(raw.adoption!.approval!.revision > raw.association!.observedRevision);
  assert.doesNotThrow(() => parseLocationScheduleResult(raw, locationScheduleInput(true)));
  for (const change of [{ sourceSha256: "g".repeat(64) }, { revision: 0 }, { recordedAt: "2026-10-05T09:00:00.000Z" }, { sourceText: "private" }, { reason: "private" }])
    assert.throws(() => parseLocationScheduleResult({ ...raw, adoption: { ...raw.adoption!, approval: { ...raw.adoption!.approval!, ...change } } }, locationScheduleInput(true)));
});

test("lock-established adoption does not acquire a new cross-entity wall-clock ordering policy", () => {
  const raw = locationScheduleWire(true); raw.adoption!.approval!.recordedAt = "2026-10-08T07:50:00.900001Z";
  raw.adoption!.recordedAt = raw.association!.recordedAt = "2026-10-08T07:49:59.999999Z";
  assert.doesNotThrow(() => parseLocationScheduleResult(raw, locationScheduleInput(true)));
});

test("not approved, explicit none and each unresolved selection remain distinguishable", () => {
  const missing = locationScheduleWire(true); Object.assign(missing.adoption!, { status: "not_approved", reason: "approval_missing", approval: null });
  assert.equal(parseLocationScheduleResult(missing, locationScheduleInput(true)).adoption?.status, "not_approved");
  const none = locationScheduleWire(true); Object.assign(none.association!, { status: "unselected", selection: null, slot: null, reason: null, currentCancelled: null });
  Object.assign(none.adoption!, { status: "unselected", reason: null, approval: null });
  assert.equal(parseLocationScheduleResult(none, { ...locationScheduleInput(true), selection: null }).adoption?.status, "unselected");
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const raw = locationScheduleWire(true); Object.assign(raw.association!, { status: "unverified", reason });
    Object.assign(raw.adoption!, { status: "unverified", reason, approval: null });
    assert.equal(parseLocationScheduleResult(raw, locationScheduleInput(true)).adoption?.reason, reason);
    raw.adoption!.reason = "approval_missing"; assert.throws(() => parseLocationScheduleResult(raw, locationScheduleInput(true)));
  }
  for (const change of [{ status: "not_approved", reason: null }, { status: "unselected" }, { status: "unverified", reason: "cancelled" }, { approval: null }])
    assert.throws(() => parseLocationScheduleResult({ ...locationScheduleWire(true), adoption: { ...locationScheduleWire(true).adoption!, ...change } }, locationScheduleInput(true)));
});

test("later cancellation and current policy changes do not rewrite receipt-time association or adoption", () => {
  const raw = locationScheduleWire(true); raw.association!.currentCancelled = true;
  raw.clock.policy!.settingsVersion = 80; raw.clock.channelEnabled = false; raw.clock.noticeGate = { ready: false, reason: "withdrawn", revision: 9 };
  const parsed = parseLocationScheduleResult(raw, recovery());
  assert.equal(parsed.association!.slot!.cancelled, false); assert.equal(parsed.association!.currentCancelled, true);
  assert.equal(parsed.clock.receiptGate!.noticeRevision, 8); assert.equal(parsed.adoption!.status, "adopted");
});

test("choice bounds are complete-or-limited and saved cross-night UTC is not re-resolved", () => {
  const raw = locationScheduleWire(); raw.choices.entries = Array.from({ length: 100 }, (_, n) => ({ ...locationScheduleSlot(), id: id(100 + n) }));
  assert.equal(parseLocationScheduleResult(raw, locationScheduleInput()).choices.entries.length, 100);
  raw.choices.entries.push({ ...locationScheduleSlot(), id: id(300) }); assert.throws(() => parseLocationScheduleResult(raw, locationScheduleInput()));
  raw.choices.entries = []; raw.choices.limited = true; assert.equal(parseLocationScheduleResult(raw, locationScheduleInput()).choices.limited, true);
  raw.choices.entries = [locationScheduleSlot()]; assert.throws(() => parseLocationScheduleResult(raw, locationScheduleInput()));
  const saved = locationScheduleWire(); Object.assign(saved.choices.entries[0], { startAt: "2026-10-08T22:00:00.000Z", endAt: "2026-10-09T06:00:00.000Z", timeZone: "Pacific/Kiritimati" });
  assert.equal(parseLocationScheduleResult(saved, locationScheduleInput()).choices.entries[0].workDate, "2026-10-08");
});

test("HTTP flags never expose choices after rollback and retain paused read-only original evidence", () => {
  const paused = locationScheduleHttp(true, false, false);
  assert.equal(parseLocationScheduleHttpResult(paused, recovery()).adoption?.status, "adopted");
  assert.throws(() => parseLocationScheduleHttpResult({ ...paused, selectionEnabled: true }, recovery()));
  assert.throws(() => parseLocationScheduleHttpResult({ ...locationScheduleHttp(), selectionEnabled: false }, locationScheduleInput()));
  assert.throws(() => parseLocationScheduleHttpResult({ ok: true, data: locationScheduleWire(), moduleEnabled: true }, locationScheduleInput()));
});
