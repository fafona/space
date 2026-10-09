import assert from "node:assert/strict";
import test from "node:test";
import { selfScheduleAdoptionActor, selfScheduleAdoptionBody, selfScheduleAdoptionCommand, selfScheduleAdoptionHttp,
  selfScheduleAdoptionId as id, selfScheduleAdoptionInput, selfScheduleAdoptionQuery, selfScheduleAdoptionSelection,
  selfScheduleAdoptionSite, selfScheduleAdoptionSlot, selfScheduleAdoptionWire } from "../../scripts/fixtures/attendance-self-schedule-adoption-model";
import { SELF_SCHEDULE_ADOPTION_API, SELF_SCHEDULE_ADOPTION_BYTE_LIMIT, SELF_SCHEDULE_ADOPTION_ERRORS,
  parseSelfScheduleAdoptionBody, parseSelfScheduleAdoptionHttpResult, parseSelfScheduleAdoptionJson, parseSelfScheduleAdoptionQuery,
  parseSelfScheduleAdoptionResult, selfScheduleAdoptionQueryString, type SelfScheduleAdoptionResult } from "./merchantAttendanceSelfScheduleAdoption";

const recovery = () => ({ ...selfScheduleAdoptionInput(), operationId: selfScheduleAdoptionCommand().operationId });
test("new self body retains exactly the original five command fields and explicit choice", () => {
  assert.deepEqual(parseSelfScheduleAdoptionBody(selfScheduleAdoptionBody()), selfScheduleAdoptionBody());
  assert.equal(parseSelfScheduleAdoptionBody({ ...selfScheduleAdoptionBody(), selection: null }).selection, null);
  for (const command of [null, { ...selfScheduleAdoptionCommand(), action: "clock_out" }, { ...selfScheduleAdoptionCommand(), expectedEmployeeId: id(2) },
    { ...selfScheduleAdoptionCommand(), expectedSequence: -0 }, { ...selfScheduleAdoptionCommand(), expectedSequence: Number.MAX_SAFE_INTEGER }])
    assert.throws(() => parseSelfScheduleAdoptionBody({ ...selfScheduleAdoptionBody(), command }), /attendance_invalid_request/);
  for (const change of [{ siteId: selfScheduleAdoptionSite + "\n" }, { authUserId: selfScheduleAdoptionActor }, { moduleEnabled: true }, { source: {} }])
    assert.throws(() => parseSelfScheduleAdoptionBody({ ...selfScheduleAdoptionBody(), ...change }), /attendance_invalid_request/);
  const { selection: _selection, ...absent } = selfScheduleAdoptionBody(); void _selection;
  assert.throws(() => parseSelfScheduleAdoptionBody(absent), /attendance_invalid_request/);
});

test("GET carries only site and optional original operation, no local expected choice or identity", () => {
  const query = selfScheduleAdoptionQueryString(selfScheduleAdoptionQuery);
  assert.equal(SELF_SCHEDULE_ADOPTION_API, "/api/merchant-enterprise/attendance/self-schedule-adoption");
  assert.deepEqual(parseSelfScheduleAdoptionQuery(`https://local.invalid/?${query}`), selfScheduleAdoptionQuery);
  assert.deepEqual(parseSelfScheduleAdoptionQuery(`https://local.invalid/?${query}&operationId=${id(5)}`), { siteId: selfScheduleAdoptionSite, operationId: id(5) });
  for (const suffix of ["&workerId=" + id(3), "&employeeId=" + id(2), "&selection=null", "&operationId=null", "&siteId=" + selfScheduleAdoptionSite])
    assert.throws(() => parseSelfScheduleAdoptionQuery(`https://local.invalid/?${query}${suffix}`), /attendance_invalid_request/);
});

test("public clock is the actual five-key self shape without invented employee or channel proof", () => {
  for (const post of [false, true]) {
    const raw = selfScheduleAdoptionWire(post), parsed = parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(post));
    assert.deepEqual(parsed, raw); assert.equal(Object.keys(parsed.clock).length, 5);
  }
  for (const extra of [{ employeeId: id(2) }, { channelEnabled: true }, { terminalId: id(10) }, { source: "web" }, { internalFence: null }])
    assert.throws(() => parseSelfScheduleAdoptionResult({ ...selfScheduleAdoptionWire(), clock: { ...selfScheduleAdoptionWire().clock, ...extra } }, selfScheduleAdoptionInput()));
});

test("request and result reject getters, hidden keys, sparse arrays, symbols and prototypes before invocation", () => {
  let called = false; const body = Object.defineProperty(selfScheduleAdoptionBody(), "selection", { enumerable: true, get() { called = true; return null; } });
  assert.throws(() => parseSelfScheduleAdoptionBody(body)); assert.equal(called, false);
  const values = [Object.assign(Object.create({ secret: true }), selfScheduleAdoptionWire()), { ...selfScheduleAdoptionWire(), [Symbol("secret")]: true },
    Object.defineProperty(selfScheduleAdoptionWire(), "hidden", { value: true }), { ...selfScheduleAdoptionWire(), choices: { ...selfScheduleAdoptionWire().choices, entries: new Array(1) } }];
  for (const raw of values) assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput()));
  const input = Object.defineProperty(selfScheduleAdoptionInput(), "authUserId", { enumerable: true, get() { called = true; return id(1); } });
  assert.throws(() => parseSelfScheduleAdoptionResult(selfScheduleAdoptionWire(), input)); assert.equal(called, false);
});

test("JSON bounds and duplicate names fail with request400 or response503", () => {
  assert.deepEqual(parseSelfScheduleAdoptionJson(JSON.stringify(selfScheduleAdoptionHttp())), selfScheduleAdoptionHttp());
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":"\\ud800"}', '{"__proto__":{}}', '{"constructor":1}', '{']) {
    assert.throws(() => parseSelfScheduleAdoptionJson(text, "request"), /attendance_invalid_request/);
    assert.throws(() => parseSelfScheduleAdoptionJson(text), /attendance_self_schedule_adoption_invalid/);
  }
  assert.equal(SELF_SCHEDULE_ADOPTION_ERRORS.attendance_invalid_request, 400);
  assert.equal(SELF_SCHEDULE_ADOPTION_ERRORS.attendance_self_schedule_adoption_invalid, 503);
  assert.equal(SELF_SCHEDULE_ADOPTION_ERRORS.attendance_self_schedule_adoption_disabled, 403);
  assert.throws(() => parseSelfScheduleAdoptionJson(JSON.stringify({ x: "x".repeat(SELF_SCHEDULE_ADOPTION_BYTE_LIMIT) })));
  assert.throws(() => parseSelfScheduleAdoptionJson(JSON.stringify({ x: "x".repeat(8192) }), "request"), /attendance_invalid_request/);
});

test("parsed results detach and deep freeze without mutating caller data", () => {
  const raw = selfScheduleAdoptionHttp(true), parsed = parseSelfScheduleAdoptionHttpResult(raw, selfScheduleAdoptionInput(true));
  raw.association!.slot!.locationName = "mutated"; raw.adoption!.approval!.revision = 99;
  assert.equal(parsed.association!.slot!.locationName, selfScheduleAdoptionSlot().locationName); assert.equal(parsed.adoption!.approval!.revision, 6);
  assert.equal(Object.isFrozen(parsed), true); assert.equal(Object.isFrozen(parsed.clock.state.lastEvent), true);
  assert.equal(Object.isFrozen(parsed.adoption!.approval), true); assert.equal(Object.isFrozen(raw), false);
});

test("receipt binds original pending worker, sequence, operation and location", () => {
  for (const patch of [{ expectedWorkerId: id(99) }, { locationId: id(99) }, { operationId: id(99) }, { expectedSequence: 1 }])
    assert.throws(() => parseSelfScheduleAdoptionResult(selfScheduleAdoptionWire(true), { ...selfScheduleAdoptionInput(true), command: { ...selfScheduleAdoptionCommand(), ...patch } }));
  assert.throws(() => parseSelfScheduleAdoptionResult(selfScheduleAdoptionWire(true), { ...recovery(), operationId: id(99) }));
  const badSequence = selfScheduleAdoptionWire(true); badSequence.clock.receipt!.sequence = 2; badSequence.clock.state.sequence = 2;
  assert.throws(() => parseSelfScheduleAdoptionResult(badSequence, selfScheduleAdoptionInput(true)));
});

test("GET preserves both legacy kinds: plain receipt and old137 relation without adoption", () => {
  const old = selfScheduleAdoptionWire(true); old.adoption = null;
  assert.equal(parseSelfScheduleAdoptionResult(old, recovery()).association!.status, "linked");
  assert.equal(parseSelfScheduleAdoptionResult(old, recovery()).adoption, null);
  old.association = null;
  assert.equal(parseSelfScheduleAdoptionResult(old, recovery()).association, null);
  const invalid = selfScheduleAdoptionWire(true); invalid.association = null;
  assert.throws(() => parseSelfScheduleAdoptionResult(invalid, recovery()), "adoption cannot exist without association");
});

test("every successful new POST including replay requires both sidecars", () => {
  for (const patch of [{ association: null }, { adoption: null }, { association: null, adoption: null }]) {
    const raw = { ...selfScheduleAdoptionWire(true), ...patch };
    assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(true)));
    raw.clock.replayed = true; assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(true)));
  }
  const replay = selfScheduleAdoptionWire(true); replay.clock.replayed = true;
  assert.equal(parseSelfScheduleAdoptionResult(replay, selfScheduleAdoptionInput(true)).adoption?.status, "adopted");
});

test("local pending GET distinguishes absent choice from explicit none even for legacy137", () => {
  for (const hasAdoption of [false, true]) {
    const raw = selfScheduleAdoptionWire(true); if (!hasAdoption) raw.adoption = null;
    assert.equal(parseSelfScheduleAdoptionResult(raw, recovery()).association?.status, "linked");
    assert.doesNotThrow(() => parseSelfScheduleAdoptionResult(raw, { ...recovery(), selection: selfScheduleAdoptionSelection }));
    for (const selection of [null, { slotId: id(99), revision: 3 }, { ...selfScheduleAdoptionSelection, revision: 4 }])
      assert.throws(() => parseSelfScheduleAdoptionResult(raw, { ...recovery(), selection }));
  }
});

test("self adoption binds exact sidecar event and optional current authenticated identity", () => {
  for (const patch of [{ channel: "location" }, { channel: "onsite" }, { channel: "pin" }, { employeeAuthUserId: id(99) }, { employeeId: id(99) },
    { startEventId: id(99) }, { operationId: id(99) }, { recordedAt: "2026-10-08T07:50:00.123457Z" }, { policy: "latest-policy" }])
    assert.throws(() => parseSelfScheduleAdoptionResult({ ...selfScheduleAdoptionWire(true), adoption: { ...selfScheduleAdoptionWire(true).adoption!, ...patch } }, selfScheduleAdoptionInput(true)));
  const { authUserId: _auth, expectedEmployeeId: _employee, ...noIdentityHint } = selfScheduleAdoptionInput(true); void _auth; void _employee;
  assert.equal(parseSelfScheduleAdoptionResult(selfScheduleAdoptionWire(true), noIdentityHint).adoption?.employeeAuthUserId, selfScheduleAdoptionActor);
  for (const employeeId of [null, "", id(2) + "\n"])
    assert.throws(() => parseSelfScheduleAdoptionResult({ ...selfScheduleAdoptionWire(true), adoption: { ...selfScheduleAdoptionWire(true).adoption!, employeeId } }, noIdentityHint));
});

test("approval reference keeps dedup IDs and independent ledger revision without re-evaluating current rules", () => {
  const raw = selfScheduleAdoptionWire(true);
  assert.ok(raw.adoption!.approval!.revision > raw.association!.observedRevision);
  assert.notEqual(raw.adoption!.approval!.sourceId, raw.adoption!.approval!.operationId);
  for (const patch of [{ sourceSha256: "g".repeat(64) }, { revision: 0 }, { sourceText: "secret" }, { actorId: id(99) }, { recordedAt: "2026-02-30T07:00:00.123456Z" }])
    assert.throws(() => parseSelfScheduleAdoptionResult({ ...raw, adoption: { ...raw.adoption!, approval: { ...raw.adoption!.approval!, ...patch } } }, selfScheduleAdoptionInput(true)));
  raw.adoption!.approval!.recordedAt = "2026-10-08T07:50:00.987654Z";
  assert.doesNotThrow(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(true)), "no invented cross-entity wall-clock order");
});

test("unselected, not-approved and four unresolved reasons never become adopted fallbacks", () => {
  const missing = selfScheduleAdoptionWire(true); Object.assign(missing.adoption!, { status: "not_approved", reason: "approval_missing", approval: null });
  assert.equal(parseSelfScheduleAdoptionResult(missing, selfScheduleAdoptionInput(true)).adoption?.status, "not_approved");
  const none = selfScheduleAdoptionWire(true); Object.assign(none.association!, { status: "unselected", selection: null, slot: null, reason: null, currentCancelled: null });
  Object.assign(none.adoption!, { status: "unselected", reason: null, approval: null });
  assert.equal(parseSelfScheduleAdoptionResult(none, { ...selfScheduleAdoptionInput(true), selection: null }).adoption?.status, "unselected");
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const raw = selfScheduleAdoptionWire(true); Object.assign(raw.association!, { status: "unverified", reason });
    Object.assign(raw.adoption!, { status: "unverified", reason, approval: null });
    assert.equal(parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(true)).adoption?.reason, reason);
    raw.adoption!.reason = "approval_missing"; assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(true)));
  }
});

test("strict nested clock refuses extra claims, wrong scope, invalid state and precision", () => {
  const edits: Array<(v: SelfScheduleAdoptionResult) => void> = [
    v => { Object.assign(v.clock.state, { source: "web" }); }, v => { Object.assign(v.clock.receipt!, { employeeId: id(2) }); },
    v => { v.clock.state.status = "off"; }, v => { v.clock.receipt!.occurredAt = "2026-10-08T07:50:00.000000Z"; },
    v => { v.clock.receipt!.siteId = "99990002"; }, v => { v.clock.receipt!.workerId = id(99); },
  ];
  for (const edit of edits) { const raw = selfScheduleAdoptionWire(true); edit(raw); assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput(true))); }
});

test("choices retain complete-or-limited100 and original saved timezone/crossnight metadata", () => {
  const raw = selfScheduleAdoptionWire(); raw.choices.entries = Array.from({ length: 100 }, (_, n) => ({ ...selfScheduleAdoptionSlot(), id: id(100 + n) }));
  assert.equal(parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput()).choices.entries.length, 100);
  raw.choices.entries.push({ ...selfScheduleAdoptionSlot(), id: id(999) }); assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput()));
  raw.choices.entries = []; raw.choices.limited = true; assert.equal(parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput()).choices.limited, true);
  raw.choices.entries = [selfScheduleAdoptionSlot()]; assert.throws(() => parseSelfScheduleAdoptionResult(raw, selfScheduleAdoptionInput()));
  const foreign = selfScheduleAdoptionWire(); foreign.choices.entries[0].locationId = id(99);
  assert.throws(() => parseSelfScheduleAdoptionResult(foreign, selfScheduleAdoptionInput()));
  const saved = selfScheduleAdoptionWire(); Object.assign(saved.choices.entries[0], { timeZone: "Pacific/Kiritimati", startAt: "2026-10-08T22:00:00.000Z", endAt: "2026-10-09T06:00:00.000Z" });
  assert.equal(parseSelfScheduleAdoptionResult(saved, selfScheduleAdoptionInput()).choices.entries[0].workDate, "2026-10-08");
});

test("historical receipt survives new default location and later cancellation without rewriting adoption", () => {
  const raw = selfScheduleAdoptionWire(true); raw.clock.locationId = id(99); raw.association!.currentCancelled = true;
  const parsed = parseSelfScheduleAdoptionResult(raw, recovery());
  assert.equal(parsed.clock.locationId, id(99)); assert.equal(parsed.clock.receipt!.locationId, id(4));
  assert.equal(parsed.association!.slot!.locationId, id(4)); assert.equal(parsed.adoption!.status, "adopted");
});

test("flat HTTP paused or feature-off recovery keeps proof but cannot expose selectable entries", () => {
  const paused = selfScheduleAdoptionHttp(true, false, false);
  assert.equal(parseSelfScheduleAdoptionHttpResult(paused, recovery()).adoption?.status, "adopted");
  assert.throws(() => parseSelfScheduleAdoptionHttpResult({ ...paused, selectionEnabled: true }, recovery()));
  assert.throws(() => parseSelfScheduleAdoptionHttpResult({ ...selfScheduleAdoptionHttp(), selectionEnabled: false }, selfScheduleAdoptionInput()));
  assert.throws(() => parseSelfScheduleAdoptionHttpResult({ ok: true, data: selfScheduleAdoptionWire(), moduleEnabled: true }, selfScheduleAdoptionInput()));
});
