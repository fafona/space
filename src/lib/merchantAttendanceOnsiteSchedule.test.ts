import assert from "node:assert/strict";
import test from "node:test";
import { onsiteScheduleActor, onsiteScheduleBody, onsiteScheduleClaims, onsiteScheduleCommand, onsiteScheduleHttp,
  onsiteScheduleId as id, onsiteScheduleInput, onsiteScheduleQuery, onsiteScheduleSelection, onsiteScheduleSite, onsiteScheduleSlot,
  onsiteScheduleToken, onsiteScheduleWire } from "../../scripts/fixtures/attendance-onsite-schedule-model";
import { decodeOnsiteToken } from "./merchantAttendanceOnsiteQrBrowser";
import { ONSITE_SCHEDULE_BYTE_LIMIT, ONSITE_SCHEDULE_ERRORS, onsiteScheduleQueryString, parseOnsiteScheduleBody, parseOnsiteScheduleHttpResult,
  parseOnsiteScheduleJson, parseOnsiteScheduleQuery, parseOnsiteScheduleResult, type OnsiteScheduleResult } from "./merchantAttendanceOnsiteSchedule";

const recovery = () => ({ ...onsiteScheduleInput(), operationId: onsiteScheduleCommand().operationId });
test("new body retains actual onsite six-field command and explicit slot or none", () => {
  assert.deepEqual(parseOnsiteScheduleBody(onsiteScheduleBody()), onsiteScheduleBody());
  assert.equal(parseOnsiteScheduleBody({ ...onsiteScheduleBody(), selection: null }).selection, null);
  for (const command of [null, { ...onsiteScheduleCommand(), action: "clock_out" }, { ...onsiteScheduleCommand(), expectedEmployeeId: null },
    { ...onsiteScheduleCommand(), expectedSequence: -0 }, { ...onsiteScheduleCommand(), expectedSequence: Number.MAX_SAFE_INTEGER },
    { ...onsiteScheduleCommand(), noticeRevision: 1 }])
    assert.throws(() => parseOnsiteScheduleBody({ ...onsiteScheduleBody(), command }), /attendance_invalid_request/);
  for (const change of [{ siteId: onsiteScheduleSite + "\n" }, { authUserId: onsiteScheduleActor }, { moduleEnabled: true }, { source: {} }])
    assert.throws(() => parseOnsiteScheduleBody({ ...onsiteScheduleBody(), ...change }), /attendance_invalid_request/);
  const { selection: _selection, ...absent } = onsiteScheduleBody(); void _selection;
  assert.throws(() => parseOnsiteScheduleBody(absent), /attendance_invalid_request/);
});

test("token validation is bounded structural validation, never a signature or freshness claim", () => {
  assert.deepEqual(decodeOnsiteToken(onsiteScheduleToken()), onsiteScheduleClaims());
  const expired = onsiteScheduleToken({ ...onsiteScheduleClaims(), pairedAtMs: 0, issuedAtMs: 1000, expiresAtMs: 46000 });
  assert.equal(parseOnsiteScheduleBody({ ...onsiteScheduleBody(), token: expired }).token, expired);
  for (const token of [null, "", onsiteScheduleToken() + "\n", "aq1.x." + "a".repeat(42), "aq1." + "a".repeat(1400) + "." + "a".repeat(43)])
    assert.throws(() => parseOnsiteScheduleBody({ ...onsiteScheduleBody(), token }), /attendance_qr_invalid/);
});

test("GET only carries site and optional original operation, never QR, employee, selection or location", () => {
  const query = onsiteScheduleQueryString(onsiteScheduleQuery);
  assert.deepEqual(parseOnsiteScheduleQuery(`https://local.invalid/?${query}`), onsiteScheduleQuery);
  assert.deepEqual(parseOnsiteScheduleQuery(`https://local.invalid/?${query}&operationId=${id(5)}`), { siteId: onsiteScheduleSite, operationId: id(5) });
  for (const suffix of ["&token=x", "&locationId=" + id(4), "&employeeId=" + id(2), "&selection=null", "&operationId=null", "&siteId=" + onsiteScheduleSite])
    assert.throws(() => parseOnsiteScheduleQuery(`https://local.invalid/?${query}${suffix}`), /attendance_invalid_request/);
});

test("public result is actual six-key onsite clock, with no forged location policy or QR secrets", () => {
  for (const post of [false, true]) {
    const raw = onsiteScheduleWire(post), parsed = parseOnsiteScheduleResult(raw, onsiteScheduleInput(post));
    assert.deepEqual(parsed, raw); assert.equal(Object.keys(parsed.clock).length, 6);
    assert.doesNotMatch(JSON.stringify(parsed), /aq1\.|nonce|terminalId|claims|internalFence|locationResult|channelEnabled/);
  }
  for (const extra of [{ siteId: onsiteScheduleSite }, { channelEnabled: true }, { policy: null }, { terminalId: id(10) }, { token: onsiteScheduleToken() }])
    assert.throws(() => parseOnsiteScheduleResult({ ...onsiteScheduleWire(), clock: { ...onsiteScheduleWire().clock, ...extra } }, onsiteScheduleInput()));
});

test("body and response reject getters, class prototypes, hidden and symbolic keys without invocation", () => {
  let called = false; const body = Object.defineProperty(onsiteScheduleBody(), "selection", { enumerable: true, get() { called = true; return null; } });
  assert.throws(() => parseOnsiteScheduleBody(body)); assert.equal(called, false);
  const values = [Object.assign(Object.create({ secret: true }), onsiteScheduleWire()), { ...onsiteScheduleWire(), [Symbol("secret")]: true },
    Object.defineProperty(onsiteScheduleWire(), "hidden", { value: true }), { ...onsiteScheduleWire(), choices: { ...onsiteScheduleWire().choices, entries: new Array(1) } }];
  for (const raw of values) assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput()));
});

test("JSON rejects duplicate keys and unsafe trees with distinct request400 and response503 codes", () => {
  assert.deepEqual(parseOnsiteScheduleJson(JSON.stringify(onsiteScheduleHttp())), onsiteScheduleHttp());
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":"\\ud800"}', '{"__proto__":{}}', '{"constructor":1}', '{']) {
    assert.throws(() => parseOnsiteScheduleJson(text, "request"), /attendance_invalid_request/);
    assert.throws(() => parseOnsiteScheduleJson(text), /attendance_onsite_schedule_invalid/);
  }
  assert.equal(ONSITE_SCHEDULE_ERRORS.attendance_invalid_request, 400); assert.equal(ONSITE_SCHEDULE_ERRORS.attendance_onsite_schedule_invalid, 503);
  assert.throws(() => parseOnsiteScheduleJson(JSON.stringify({ x: "x".repeat(ONSITE_SCHEDULE_BYTE_LIMIT) })));
  assert.throws(() => parseOnsiteScheduleJson(JSON.stringify({ x: "x".repeat(8192) }), "request"), /attendance_invalid_request/);
});

test("parsed values are detached and frozen without mutating source inputs", () => {
  const raw = onsiteScheduleHttp(true), parsed = parseOnsiteScheduleHttpResult(raw, onsiteScheduleInput(true));
  raw.association!.slot!.locationName = "mutated"; raw.adoption!.approval!.revision = 99;
  assert.equal(parsed.association!.slot!.locationName, "合成现场地点"); assert.equal(parsed.adoption!.approval!.revision, 6);
  assert.equal(Object.isFrozen(parsed), true); assert.equal(Object.isFrozen(parsed.clock.state.lastEvent), true);
  assert.equal(Object.isFrozen(parsed.adoption!.approval), true); assert.equal(Object.isFrozen(raw), false);
});

test("original receipt and pending employee, worker, sequence and operation must agree", () => {
  for (const patch of [{ employeeId: id(99) }, { expectedWorkerId: id(99) }, { operationId: id(99) }])
    assert.throws(() => parseOnsiteScheduleResult(onsiteScheduleWire(true), { ...recovery(), ...patch }));
  const badSequence = onsiteScheduleWire(true); badSequence.clock.receipt!.sequence = 2; badSequence.clock.state.sequence = 2;
  assert.throws(() => parseOnsiteScheduleResult(badSequence, onsiteScheduleInput(true)));
  const raw = onsiteScheduleWire(true); raw.clock.receipt!.operationId = id(99);
  assert.throws(() => parseOnsiteScheduleResult(raw, recovery()));
  const changedCommand = { ...onsiteScheduleCommand(), expectedEmployeeId: id(99) };
  assert.throws(() => parseOnsiteScheduleResult(onsiteScheduleWire(true), { ...onsiteScheduleInput(true), command: changedCommand }));
});

test("all successful POSTs including replay need both sidecars, while legacy GET never backfills", () => {
  for (const patch of [{ association: null }, { adoption: null }, { association: null, adoption: null }]) {
    const raw = { ...onsiteScheduleWire(true), ...patch };
    assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput(true)));
    raw.clock.replayed = true; assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput(true)));
  }
  const old = onsiteScheduleWire(true); old.association = null; old.adoption = null;
  assert.equal(parseOnsiteScheduleResult(old, recovery()).association, null);
  const replay = onsiteScheduleWire(true); replay.clock.replayed = true;
  assert.equal(parseOnsiteScheduleResult(replay, onsiteScheduleInput(true)).adoption?.status, "adopted");
});

test("pending GET distinguishes absent selection from explicit none and rejects changed slot or revision", () => {
  assert.equal(parseOnsiteScheduleResult(onsiteScheduleWire(true), recovery()).association?.status, "linked");
  assert.doesNotThrow(() => parseOnsiteScheduleResult(onsiteScheduleWire(true), { ...recovery(), selection: onsiteScheduleSelection }));
  for (const selection of [null, { slotId: id(99), revision: 3 }, { ...onsiteScheduleSelection, revision: 4 }])
    assert.throws(() => parseOnsiteScheduleResult(onsiteScheduleWire(true), { ...recovery(), selection }));
});

test("adoption identity is onsite-specific and shares exact event, operation and recorded timestamp", () => {
  for (const patch of [{ channel: "location" }, { channel: "pin" }, { employeeAuthUserId: id(99) }, { employeeId: id(99) },
    { startEventId: id(99) }, { operationId: id(99) }, { recordedAt: "2026-10-08T07:50:00.123457Z" }, { policy: "latest-policy" }])
    assert.throws(() => parseOnsiteScheduleResult({ ...onsiteScheduleWire(true), adoption: { ...onsiteScheduleWire(true).adoption!, ...patch } }, onsiteScheduleInput(true)));
  const { authUserId: _auth, ...browserScope } = onsiteScheduleInput(true); void _auth;
  assert.equal(parseOnsiteScheduleResult(onsiteScheduleWire(true), browserScope).adoption?.employeeAuthUserId, onsiteScheduleActor);
});

test("approved reference is compact, not a current rules body or schedule revision", () => {
  const raw = onsiteScheduleWire(true);
  assert.ok(raw.adoption!.approval!.revision > raw.association!.observedRevision);
  assert.notEqual(raw.adoption!.approval!.sourceId, raw.adoption!.approval!.operationId);
  for (const patch of [{ sourceSha256: "g".repeat(64) }, { revision: 0 }, { sourceText: "secret" }, { actorId: id(99) }, { recordedAt: "2026-02-30T07:00:00.123456Z" }])
    assert.throws(() => parseOnsiteScheduleResult({ ...raw, adoption: { ...raw.adoption!, approval: { ...raw.adoption!.approval!, ...patch } } }, onsiteScheduleInput(true)));
  raw.adoption!.approval!.recordedAt = "2026-10-08T07:50:00.987654Z";
  assert.doesNotThrow(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput(true)), "do not invent cross-entity wall-clock ordering");
});

test("none, missing approval and four unresolved selection reasons are not adopted defaults", () => {
  const missing = onsiteScheduleWire(true); Object.assign(missing.adoption!, { status: "not_approved", reason: "approval_missing", approval: null });
  assert.equal(parseOnsiteScheduleResult(missing, onsiteScheduleInput(true)).adoption?.status, "not_approved");
  const none = onsiteScheduleWire(true); Object.assign(none.association!, { status: "unselected", selection: null, slot: null, reason: null, currentCancelled: null });
  Object.assign(none.adoption!, { status: "unselected", reason: null, approval: null });
  assert.equal(parseOnsiteScheduleResult(none, { ...onsiteScheduleInput(true), selection: null }).adoption?.status, "unselected");
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const raw = onsiteScheduleWire(true); Object.assign(raw.association!, { status: "unverified", reason });
    Object.assign(raw.adoption!, { status: "unverified", reason, approval: null });
    assert.equal(parseOnsiteScheduleResult(raw, onsiteScheduleInput(true)).adoption?.reason, reason);
    raw.adoption!.reason = "approval_missing"; assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput(true)));
  }
});

test("strict nested clock rejects unknown source claims and impossible original state", () => {
  const edits: Array<(v: OnsiteScheduleResult) => void> = [
    v => { Object.assign(v.clock.state, { source: "web" }); }, v => { Object.assign(v.clock.receipt!, { terminalId: id(10) }); },
    v => { v.clock.state.status = "off"; }, v => { v.clock.receipt!.occurredAt = "2026-10-08T07:50:00.000000Z"; },
    v => { v.clock.receipt!.siteId = "99990002"; }, v => { v.clock.receipt!.workerId = id(99); },
  ];
  for (const edit of edits) { const raw = onsiteScheduleWire(true); edit(raw); assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput(true))); }
});

test("choices are bounded current-default-location metadata and do not contain QR verification", () => {
  const raw = onsiteScheduleWire(); raw.choices.entries = Array.from({ length: 100 }, (_, n) => ({ ...onsiteScheduleSlot(), id: id(100 + n) }));
  assert.equal(parseOnsiteScheduleResult(raw, onsiteScheduleInput()).choices.entries.length, 100);
  raw.choices.entries.push({ ...onsiteScheduleSlot(), id: id(999) }); assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput()));
  raw.choices.entries = []; raw.choices.limited = true; assert.equal(parseOnsiteScheduleResult(raw, onsiteScheduleInput()).choices.limited, true);
  raw.choices.entries = [onsiteScheduleSlot()]; assert.throws(() => parseOnsiteScheduleResult(raw, onsiteScheduleInput()));
  const foreign = onsiteScheduleWire(); foreign.choices.entries[0].locationId = id(99);
  assert.throws(() => parseOnsiteScheduleResult(foreign, onsiteScheduleInput()));
  assert.throws(() => parseOnsiteScheduleResult({ ...onsiteScheduleWire(), choices: { ...onsiteScheduleWire().choices, qrVerified: true } }, onsiteScheduleInput()));
});

test("historical receipt location and cancellation do not get overwritten by today's default location", () => {
  const raw = onsiteScheduleWire(true); raw.clock.locationId = id(99); raw.association!.currentCancelled = true;
  const parsed = parseOnsiteScheduleResult(raw, recovery());
  assert.equal(parsed.clock.locationId, id(99)); assert.equal(parsed.clock.receipt!.locationId, id(4));
  assert.equal(parsed.association!.slot!.locationId, id(4)); assert.equal(parsed.adoption!.status, "adopted");
  const saved = onsiteScheduleWire(); Object.assign(saved.choices.entries[0], { timeZone: "Pacific/Kiritimati", startAt: "2026-10-08T22:00:00.000Z", endAt: "2026-10-09T06:00:00.000Z" });
  assert.equal(parseOnsiteScheduleResult(saved, onsiteScheduleInput()).choices.entries[0].workDate, "2026-10-08");
});

test("flat HTTP disables candidate exposure while retaining explicit paused original-number reads", () => {
  const paused = onsiteScheduleHttp(true, false, false);
  assert.equal(parseOnsiteScheduleHttpResult(paused, recovery()).adoption?.status, "adopted");
  assert.throws(() => parseOnsiteScheduleHttpResult({ ...paused, selectionEnabled: true }, recovery()));
  assert.throws(() => parseOnsiteScheduleHttpResult({ ...onsiteScheduleHttp(), selectionEnabled: false }, onsiteScheduleInput()));
  assert.throws(() => parseOnsiteScheduleHttpResult({ ok: true, data: onsiteScheduleWire(), moduleEnabled: true }, onsiteScheduleInput()));
});
