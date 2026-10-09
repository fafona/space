import test from "node:test";
import assert from "node:assert/strict";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { PIN_SCHEDULE_ERRORS, parsePinScheduleBody, parsePinScheduleResult, parsePinScheduleHttpResult, parsePinScheduleJson } from "./merchantAttendancePinSchedule";
import { pinScheduleBody, pinScheduleInput, pinScheduleWire, pinScheduleHttp, pinScheduleId as id, pinScheduleSelection, pinScheduleCommand } from "../../scripts/fixtures/attendance-pin-schedule-model";
const invalidRequest = (fn: () => unknown) => assert.throws(fn, e => e instanceof MerchantAttendanceError && e.code === "attendance_invalid_request");
const invalidResult = (fn: () => unknown) => assert.throws(fn, e => e instanceof MerchantAttendanceError && e.code === "attendance_pin_schedule_invalid");
const recovered = () => ({ ...pinScheduleInput(), operationId: pinScheduleCommand().operationId });

test("request is exactly PIN-authenticated read or explicit clock-in; selection is never inferred", () => {
  assert.deepEqual(parsePinScheduleBody(pinScheduleBody()), pinScheduleBody());
  assert.deepEqual(parsePinScheduleBody(pinScheduleBody(true)), pinScheduleBody(true));
  assert.equal(parsePinScheduleBody({ ...pinScheduleBody(true), selection: null }).selection, null);
  for (const patch of [{ siteId: "99990001" }, { terminalId: id(10) }, { verified: true }, { allowWrite: true }, { lease: id(11) }, { employeeAuthUserId: id(1) }])
    invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(), ...patch }));
  invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(), selection: pinScheduleSelection }));
  invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(true), operationId: id(5) }));
  const { selection: omitted, ...withoutChoice } = pinScheduleBody(true); assert.ok(omitted); invalidRequest(() => parsePinScheduleBody(withoutChoice));
});
test("PIN and worker number are strict with no newline loophole or credential alternatives", () => {
  for (const pin of ["1234567", "1234567890123", "12345678\n", " 12345678", "１２３４５６７８", 12345678, null]) invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(), pin }));
  for (const workerNo of ["", " PIN-01", "PIN-01\n", "😀".repeat(41), null]) invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(), workerNo }));
  assert.equal(parsePinScheduleBody({ ...pinScheduleBody(), workerNo: "😀".repeat(40) }).workerNo, "😀".repeat(40));
  for (const action of ["clock_out", "break_start", "break_end", "toggle"]) invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(true), command: { ...pinScheduleCommand(), action } }));
  for (const expectedSequence of [-0, -1, 1.5, Number.MAX_SAFE_INTEGER]) invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(true), command: { ...pinScheduleCommand(), expectedSequence } }));
  for (const revision of [0, -0, 1.5, Number.MAX_SAFE_INTEGER]) invalidRequest(() => parsePinScheduleBody({ ...pinScheduleBody(true), selection: { ...pinScheduleSelection, revision } }));
});
test("JSON duplicate names, unsafe keys, lone surrogates and byte caps fail with context-specific errors", () => {
  for (const text of ['{"command":null,"command":null}', '{"__proto__":{}}', '{"constructor":null}', '"\ud800"', '{']) {
    invalidRequest(() => parsePinScheduleJson(text, "request")); invalidResult(() => parsePinScheduleJson(text));
  }
  invalidRequest(() => parsePinScheduleJson('"' + "x".repeat(8192) + '"', "request"));
  invalidResult(() => parsePinScheduleJson('"' + "😀".repeat(17000) + '"'));
  assert.deepEqual(parsePinScheduleJson(JSON.stringify(pinScheduleBody()), "request"), pinScheduleBody());
});
test("plain deep JSON only; getters are not invoked, hidden/symbol/sparse properties refused", () => {
  let calls = 0; const accessor = { ...pinScheduleBody() }; Object.defineProperty(accessor, "pin", { enumerable: true, get() { calls++; return "01738264"; } });
  invalidRequest(() => parsePinScheduleBody(accessor)); assert.equal(calls, 0);
  const hidden = pinScheduleWire(); Object.defineProperty(hidden.clock, "private", { value: 1 }); invalidResult(() => parsePinScheduleResult(hidden, pinScheduleInput()));
  const symbol = pinScheduleWire(); Object.defineProperty(symbol, Symbol("secret"), { value: 1 }); invalidResult(() => parsePinScheduleResult(symbol, pinScheduleInput()));
  const sparse = pinScheduleWire(); sparse.choices.entries = new Array(1); invalidResult(() => parsePinScheduleResult(sparse, pinScheduleInput()));
  const inherited = Object.assign(Object.create({ secret: 1 }), pinScheduleWire()); invalidResult(() => parsePinScheduleResult(inherited, pinScheduleInput()));
  const cycle = { ...pinScheduleBody(), self: null as unknown }; cycle.self = cycle; invalidRequest(() => parsePinScheduleBody(cycle));
});
test("genuine PIN clock stays thirteen keys and output is fully detached/frozen", () => {
  const raw = pinScheduleWire(true), parsed = parsePinScheduleResult(raw, pinScheduleInput(true));
  assert.equal(Object.keys(parsed.clock).length, 13); assert.ok(Object.isFrozen(parsed.clock.state)); assert.ok(Object.isFrozen(parsed.association?.slot));
  assert.deepEqual(parsed, raw); raw.clock.workerName = "changed"; raw.adoption!.approval!.revision = 99;
  assert.notEqual(parsed.clock.workerName, raw.clock.workerName); assert.equal(parsed.adoption!.approval!.revision, 6);
  for (const patch of [{ source: "kiosk" }, { actorId: id(1) }, { policy: {} }, { internalFence: null }, { verifier: "private" }, { pin: "01738264" }])
    invalidResult(() => parsePinScheduleResult({ ...pinScheduleWire(), clock: { ...pinScheduleWire().clock, ...patch } }, pinScheduleInput()));
});
test("terminal/site/worker number and pending worker+employee identities all bind strictly", () => {
  assert.equal(parsePinScheduleResult(pinScheduleWire(), { ...pinScheduleInput(), workerNo: "pin-01" }).clock.workerNo, "PIN-01");
  for (const patch of [{ siteId: "99990002" }, { terminalId: id(99) }, { workerNo: "PIN-02" }, { workerId: id(99) }, { employeeId: id(99) }])
    invalidResult(() => parsePinScheduleResult({ ...pinScheduleWire(), clock: { ...pinScheduleWire().clock, ...patch } }, pinScheduleInput()));
  invalidResult(() => parsePinScheduleResult(pinScheduleWire(), { ...pinScheduleInput(), siteId: "99990001\n" }));
  const input = pinScheduleInput(); Object.defineProperty(input, "workerNo", { enumerable: true, get() { throw Error("must not execute"); } });
  invalidResult(() => parsePinScheduleResult(pinScheduleWire(), input));
});
test("clock state/receipt and exact command original sequence/action remain verified", () => {
  for (const mutate of [
    (r: ReturnType<typeof pinScheduleWire>) => { r.clock.receipt!.operationId = id(99); },
    (r: ReturnType<typeof pinScheduleWire>) => { r.clock.receipt!.action = "clock_out"; },
    (r: ReturnType<typeof pinScheduleWire>) => { r.clock.receipt!.sequence = 2; r.clock.state.sequence = 2; },
    (r: ReturnType<typeof pinScheduleWire>) => { r.clock.receipt!.occurredAt = "2026-10-08T07:50:00.000000Z"; },
    (r: ReturnType<typeof pinScheduleWire>) => { r.clock.state.sequence = -0; },
  ]) { const r = pinScheduleWire(true); mutate(r); invalidResult(() => parsePinScheduleResult(r, pinScheduleInput(true))); }
});
test("fresh and replayed clock-in always require both sidecars; legacy authenticated reads may have neither", () => {
  for (const replayed of [false, true]) for (const absent of ["association", "adoption", "both"] as const) {
    const r = pinScheduleWire(true); r.clock.replayed = replayed;
    if (absent !== "adoption") r.association = null; if (absent !== "association") r.adoption = null;
    invalidResult(() => parsePinScheduleResult(r, pinScheduleInput(true)));
  }
  const legacy = pinScheduleWire(true); legacy.association = null; legacy.adoption = null;
  assert.equal(parsePinScheduleResult(legacy, recovered()).adoption, null);
  const onlyRelation = pinScheduleWire(true); onlyRelation.adoption = null; invalidResult(() => parsePinScheduleResult(onlyRelation, recovered()));
});
test("read selection:null is syntax, expectedSelection independently verifies pending original choice", () => {
  assert.ok(parsePinScheduleResult(pinScheduleWire(true), recovered()).association);
  assert.ok(parsePinScheduleResult(pinScheduleWire(true), { ...recovered(), expectedSelection: pinScheduleSelection }).association);
  invalidResult(() => parsePinScheduleResult(pinScheduleWire(true), { ...recovered(), expectedSelection: null }));
  invalidResult(() => parsePinScheduleResult(pinScheduleWire(true), { ...recovered(), expectedSelection: { ...pinScheduleSelection, slotId: id(99) } }));
  invalidResult(() => parsePinScheduleResult(pinScheduleWire(true), { ...recovered(), selection: pinScheduleSelection }));
  invalidResult(() => parsePinScheduleResult(pinScheduleWire(true), { ...pinScheduleInput(true), expectedSelection: null }));
});
test("adoption binds kiosk channel, event, employee and optional saved member auth without inventing a login", () => {
  for (const patch of [{ channel: "onsite" }, { employeeId: id(99) }, { employeeAuthUserId: id(99) }, { employeeAuthUserId: null },
    { startEventId: id(99) }, { operationId: id(99) }, { recordedAt: "2026-10-08T07:50:00.123455Z" }, { policy: "other" }, { authUserId: id(1) }])
    invalidResult(() => parsePinScheduleResult({ ...pinScheduleWire(true), adoption: { ...pinScheduleWire(true).adoption, ...patch } }, pinScheduleInput(true)));
  const r = pinScheduleWire(true); r.adoption!.employeeAuthUserId = id(99); const input = pinScheduleInput(true); delete input.expectedEmployeeAuthUserId;
  assert.equal(parsePinScheduleResult(r, input).adoption?.employeeAuthUserId, id(99));
});
test("compact approval provenance permits dedup and independent revisions but rejects secret/full-source additions", () => {
  const r = pinScheduleWire(true); r.adoption!.approval!.revision = 80;
  // Receipt times are wall clocks; no invented cross-entity ordering is imposed.
  r.adoption!.approval!.recordedAt = "2026-10-09T09:00:00.999999Z";
  assert.equal(parsePinScheduleResult(r, pinScheduleInput(true)).adoption?.approval?.revision, 80);
  assert.notEqual(r.adoption!.approval!.sourceId, r.adoption!.approval!.operationId);
  for (const patch of [{ sourceSha256: "A".repeat(64) }, { sourceSha256: "a".repeat(64) + "\n" }, { sourceText: "private" }, { reason: "owner secret" }, { revision: 0 }, { recordedAt: "2026-02-30T01:00:00.000000Z" }])
    invalidResult(() => parsePinScheduleResult({ ...r, adoption: { ...r.adoption, approval: { ...r.adoption!.approval, ...patch } } }, pinScheduleInput(true)));
});
test("unselected, not-approved and four explicit unverified reasons retain independent status", () => {
  const r = pinScheduleWire(true); r.association = { ...r.association!, selection: null, slot: null, status: "unselected", currentCancelled: null };
  r.adoption = { ...r.adoption!, status: "unselected", approval: null };
  assert.equal(parsePinScheduleResult(r, { ...pinScheduleInput(true), selection: null }).adoption?.status, "unselected");
  const noApproval = pinScheduleWire(true); noApproval.adoption = { ...noApproval.adoption!, status: "not_approved", reason: "approval_missing", approval: null };
  assert.equal(parsePinScheduleResult(noApproval, pinScheduleInput(true)).adoption?.status, "not_approved");
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const q = pinScheduleWire(true); q.association = { ...q.association!, status: "unverified", reason };
    q.adoption = { ...q.adoption!, status: "unverified", reason, approval: null };
    assert.equal(parsePinScheduleResult(q, pinScheduleInput(true)).adoption?.reason, reason);
    q.adoption.status = "not_approved"; invalidResult(() => parsePinScheduleResult(q, pinScheduleInput(true)));
  }
});
test("candidate cap, uniqueness, current terminal location and limited-empty rule are strict", () => {
  for (const mode of ["duplicate", "foreign", "limited", "overcap"] as const) {
    const r = pinScheduleWire();
    if (mode === "duplicate") r.choices.entries.push(structuredClone(r.choices.entries[0]));
    else if (mode === "foreign") r.choices.entries[0].locationId = id(99);
    else if (mode === "limited") r.choices.limited = true;
    else r.choices.entries = Array.from({ length: 101 }, (_, n) => ({ ...r.choices.entries[0], id: id(100 + n) }));
    invalidResult(() => parsePinScheduleResult(r, pinScheduleInput()));
  }
  const limited = pinScheduleWire(); limited.choices.limited = true; limited.choices.entries = [];
  assert.equal(parsePinScheduleResult(limited, pinScheduleInput()).choices.limited, true);
  const full = pinScheduleWire(); full.choices.entries = Array.from({ length: 100 }, (_, n) => ({ ...full.choices.entries[0], id: id(100 + n) }));
  assert.equal(parsePinScheduleResult(full, pinScheduleInput()).choices.entries.length, 100);
});
test("non-starting PIN read can succeed with empty choices and an exact old block reason", () => {
  const r = pinScheduleWire(); r.clock.canStart = false; r.clock.canFinish = false; r.clock.blockReason = "attendance_location_denied"; r.choices.entries = [];
  assert.equal(parsePinScheduleResult(r, pinScheduleInput()).clock.canStart, false);
  for (const patch of [{ canStart: true }, { blockReason: null }, { blockReason: "unknown" }])
    invalidResult(() => parsePinScheduleResult({ ...r, clock: { ...r.clock, ...patch } }, pinScheduleInput()));
});
test("historical receipt remains separate from current terminal location and current cancellation", () => {
  const r = pinScheduleWire(true); r.clock.locationId = id(99); r.association!.currentCancelled = true;
  const a = r.association!.slot!; a.timeZone = "UTC"; a.workDate = "2026-10-07";
  a.startAt = "2026-10-07T23:00:00.000Z"; a.endAt = "2026-10-08T07:00:00.000Z";
  assert.equal(parsePinScheduleResult(r, recovered()).association?.currentCancelled, true);
});
test("HTTP flat flags preserve paused recovery without allowing canStart or candidates", () => {
  assert.equal(parsePinScheduleHttpResult(pinScheduleHttp(), pinScheduleInput()).selectionEnabled, true);
  assert.equal(parsePinScheduleHttpResult(pinScheduleHttp(true, false), recovered()).adoption?.status, "adopted");
  for (const patch of [{ selectionEnabled: true, moduleEnabled: false }, { ok: false }, { data: {} }])
    invalidResult(() => parsePinScheduleHttpResult({ ...pinScheduleHttp(), ...patch }, pinScheduleInput()));
  const blocked = pinScheduleHttp(false, false); blocked.clock.canStart = true;
  invalidResult(() => parsePinScheduleHttpResult(blocked, pinScheduleInput()));
  const off = pinScheduleHttp(); off.selectionEnabled = false; invalidResult(() => parsePinScheduleHttpResult(off, pinScheduleInput()));
});
test("error table keeps original PIN errors and new request/response statuses", () => {
  for (const [code, status] of [["attendance_pin_denied", 403], ["attendance_pin_busy", 429], ["attendance_operation_conflict", 409],
    ["attendance_pin_schedule_disabled", 403], ["attendance_pin_schedule_invalid", 503], ["attendance_shift_rule_binding_invalid", 503], ["attendance_invalid_request", 400],
    ["attendance_body_too_large", 413], ["attendance_invalid_content_type", 415]] as const) assert.equal(PIN_SCHEDULE_ERRORS[code], status);
});
