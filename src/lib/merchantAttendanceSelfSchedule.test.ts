import assert from "node:assert/strict";
import test from "node:test";
import { parseSelfScheduleBody, parseSelfScheduleQuery, parseSelfScheduleResult, parseSelfScheduleHttpResult,
  type SelfScheduleResult, type SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";
import { attendanceSelfScheduleEnabled, executeAttendanceSelfSchedule } from "./merchantAttendanceSelfSchedule.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", command = { expectedWorkerId: id(2), operationId: id(3), locationId: id(4), action: "clock_in" as const, expectedSequence: 0 };
const selection = { slotId: id(5), revision: 1 };
function slot(): SelfScheduleSlot { return { id: id(5), revision: 1, locationId: id(4), locationName: "合成地点", timeZone: "Europe/Madrid",
  workDate: "2026-10-05", startAt: "2026-10-05T08:00:00.000Z", endAt: "2026-10-05T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true }; }
function result(post = false): SelfScheduleResult {
  const receipt = post ? { id: id(6), ...command, workerId: id(2), siteId, breakPaid: null, sequence: 1,
    occurredAt: "2026-10-05T07:50:00.000Z", timeZone: "Europe/Madrid" } : null;
  // Construct the exact public event, not private command keys.
  const event = receipt && { id: receipt.id, siteId, workerId: receipt.workerId, locationId: receipt.locationId, operationId: receipt.operationId,
    action: receipt.action, breakPaid: receipt.breakPaid, sequence: receipt.sequence, occurredAt: receipt.occurredAt, timeZone: receipt.timeZone };
  return { protocol: "self-schedule-v1", clock: { workerId: id(2), locationId: id(4),
    state: { sequence: post ? 1 : 0, status: post ? "working" : "off", lastEvent: event }, receipt: event, replayed: false },
  choices: { timeZone: "Europe/Madrid", fromDate: "2026-10-04", throughDate: "2026-10-06", revision: 1, limited: false, entries: [slot()] },
  association: post ? { startEventId: id(6), operationId: id(3), selection, status: "linked", reason: null, slot: slot(), observedRevision: 1,
    recordedAt: "2026-10-05T07:50:00.123456Z", currentCancelled: false } : null };
}
const read = { siteId, command: null, operationId: null };
const write = { siteId, command, operationId: null, selection };

test("new envelope preserves the old command and makes none an explicit choice", () => {
  assert.deepEqual(parseSelfScheduleBody({ siteId, command, selection }), writeBody(selection));
  assert.deepEqual(parseSelfScheduleBody(writeBody(null)), writeBody(null));
  for (const bad of [{ siteId, command }, { ...writeBody(selection), authUserId: id(9) }, { ...writeBody(selection), command: { ...command, slotId: id(5) } },
    { ...writeBody(selection), command: { ...command, action: "clock_out" } }, writeBody({ slotId: id(5), revision: 0 }),
    { ...writeBody(selection), siteId: siteId + "\n" }]) assert.throws(() => parseSelfScheduleBody(bad));
});
function writeBody(value: unknown) { return { siteId, command, selection: value }; }
test("request rejects prototypes, getters, hidden or symbolic fields without invoking getters", () => {
  let called = false;
  const accessor = Object.defineProperty(writeBody(selection), "selection", { get() { called = true; return selection; } });
  assert.throws(() => parseSelfScheduleBody(accessor)); assert.equal(called, false);
  assert.throws(() => parseSelfScheduleBody(Object.assign(Object.create({ hidden: true }), writeBody(selection))));
  assert.throws(() => parseSelfScheduleBody({ ...writeBody(selection), [Symbol("x")]: true }));
});
test("GET only accepts an authenticated-self site and optional original operation", () => {
  assert.deepEqual(parseSelfScheduleQuery(`https://local.invalid/?siteId=${siteId}`), { siteId, operationId: null });
  for (const q of [`siteId=${siteId}&workerId=${id(2)}`, `siteId=${siteId}&siteId=${siteId}`, `siteId=${siteId}%0A`, `siteId=${siteId}&selection=none`])
    assert.throws(() => parseSelfScheduleQuery(`https://local.invalid/?${q}`));
});
test("valid read and linked receipt are defensively copied without private metadata", () => {
  const raw = result(), parsed = parseSelfScheduleResult(raw, read);
  assert.deepEqual(parsed, raw); raw.choices.entries[0].locationName = "changed"; assert.equal(parsed.choices.entries[0].locationName, "合成地点");
  assert.deepEqual(parseSelfScheduleResult(result(true), write), result(true));
  assert.throws(() => parseSelfScheduleResult({ ...result(), employeeAuthUserId: id(9) }, read));
});
test("original selection survives later cancellation without rewriting captured slot", () => {
  const raw = result(true); raw.association!.currentCancelled = true;
  const parsed = parseSelfScheduleResult(raw, write); assert.equal(parsed.association!.slot!.cancelled, false); assert.equal(parsed.association!.currentCancelled, true);
});
test("choice limits and historical dates are strict without re-resolving saved timezone mapping", () => {
  const raw = result(); raw.choices.entries[0].timeZone = "Pacific/Kiritimati";
  assert.equal(parseSelfScheduleResult(raw, read).choices.entries.length, 1);
  for (const edit of [(v: SelfScheduleResult) => { v.choices.entries.push(slot()); },
    (v: SelfScheduleResult) => { v.choices.entries = Array.from({ length: 101 }, (_, n) => ({ ...slot(), id: id(100+n) })); },
    (v: SelfScheduleResult) => { v.choices.limited = true; }, (v: SelfScheduleResult) => { v.choices.throughDate = "2026-10-07"; },
    (v: SelfScheduleResult) => { v.choices.entries[0].locationId = id(9); }, (v: SelfScheduleResult) => { v.choices.entries[0].revision = 2; }]) {
    const v = result(); edit(v); assert.throws(() => parseSelfScheduleResult(v, read));
  }
  raw.choices.entries = []; raw.choices.limited = true; assert.equal(parseSelfScheduleResult(raw, read).choices.limited, true);
});
test("fresh punches must have an outcome, exact old replays may explicitly lack one", () => {
  const raw = result(true); raw.association = null;
  assert.throws(() => parseSelfScheduleResult(raw, write)); raw.clock.replayed = true;
  assert.equal(parseSelfScheduleResult(raw, write).association, null);
});
test("GET pending recovery must match original selection including none", () => {
  const raw = result(true);
  assert.doesNotThrow(() => parseSelfScheduleResult(raw, { ...read, operationId: command.operationId, selection }));
  assert.throws(() => parseSelfScheduleResult(raw, { ...read, operationId: command.operationId, selection: null }));
  assert.throws(() => parseSelfScheduleResult(raw, { ...read, operationId: command.operationId, selection: { ...selection, slotId: id(77) } }));
});
test("none and unresolved are distinct from linked and cannot forge verification", () => {
  const raw = result(true); Object.assign(raw.association!, { selection: null, slot: null, reason: null, currentCancelled: null, status: "unselected" });
  assert.equal(parseSelfScheduleResult(raw, { ...write, selection: null }).association?.status, "unselected");
  raw.association!.reason = "cancelled"; assert.throws(() => parseSelfScheduleResult(raw, { ...write, selection: null }));
  for (const field of ["cancelled", "hasPublicationEvidence"] as const) {
    const linked = result(true); linked.association!.slot![field] = field === "cancelled";
    assert.throws(() => parseSelfScheduleResult(linked, write));
  }
});
test("receipt association identity and observation revision cannot drift", () => {
  for (const edit of [(v: SelfScheduleResult) => { v.association!.startEventId = id(88); },
    (v: SelfScheduleResult) => { v.association!.operationId = id(88); },
    (v: SelfScheduleResult) => { v.association!.observedRevision = 0; },
    (v: SelfScheduleResult) => { v.association!.observedRevision = 2; },
    (v: SelfScheduleResult) => { v.association!.recordedAt = "2026-02-30T07:50:00.123456Z"; }]) {
    const raw = result(true); edit(raw); assert.throws(() => parseSelfScheduleResult(raw, write));
  }
});
test("HTTP envelope cannot claim write enabled while paused or expose off-gate choices", () => {
  assert.doesNotThrow(() => parseSelfScheduleHttpResult({ ok: true, moduleEnabled: true, selectionEnabled: true, ...result() }, read));
  for (const fields of [{ moduleEnabled: false, selectionEnabled: true }, { moduleEnabled: true, selectionEnabled: false }])
    assert.throws(() => parseSelfScheduleHttpResult({ ok: true, ...fields, ...result() }, read));
});
test("independent server gate is strict, bounded and requires an explicit merchant", () => {
  const on = { FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED: "1", FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS: siteId };
  assert.equal(attendanceSelfScheduleEnabled(siteId, on), true); assert.equal(attendanceSelfScheduleEnabled(siteId, {}), false);
  for (const value of ["*", "", `${siteId},bad`, Array(101).fill(siteId).join(","), "1".repeat(4097)])
    assert.equal(attendanceSelfScheduleEnabled(siteId, { ...on, FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS: value }), false);
  assert.equal(attendanceSelfScheduleEnabled(siteId + "\n", on), false); assert.equal(attendanceSelfScheduleEnabled("99990002", on), false);
});
test("actual service sends exactly one transaction request and preserves independent binding choice", async () => {
  for (const bindRules of [false, true]) {
    let calls = 0;
    await executeAttendanceSelfSchedule({ ...write, authUserId: id(1), allowWrite: true, bindRules }, { rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_attendance_self_schedule_v1"); assert.deepEqual(args, { p_site_id: siteId, p_auth_user_id: id(1),
        p_command: command, p_selection: selection, p_operation_id: null, p_allow_write: true, p_bind_rules: bindRules });
      return { data: result(true), error: null };
    } }); assert.equal(calls, 1);
  }
});
test("service feature rollback permits current-auth recovery but never POST or silent fallback", async () => {
  let calls = 0; const rpc = { rpc: async () => { calls++; return { data: result(), error: null }; } };
  await assert.rejects(executeAttendanceSelfSchedule({ ...write, authUserId: id(1), allowWrite: false, bindRules: false }, rpc), /attendance_self_schedule_disabled/);
  assert.equal(calls, 0);
  await executeAttendanceSelfSchedule({ ...read, selection: null, authUserId: id(1), allowWrite: false, bindRules: false }, rpc); assert.equal(calls, 1);
  const fail = { rpc: async () => { calls++; return { data: null, error: { message: "internal secret" } }; } };
  await assert.rejects(executeAttendanceSelfSchedule({ ...write, authUserId: id(1), allowWrite: true, bindRules: false }, fail), /attendance_unavailable/);
  assert.equal(calls, 2);
});

test("service GET null transport selection does not overwrite an original selected association", async () => {
  const raw = result(true);
  const recovered = await executeAttendanceSelfSchedule({ ...read, operationId: command.operationId, selection: null,
    authUserId: id(1), allowWrite: false, bindRules: false }, { rpc: async () => ({ data: raw, error: null }) });
  assert.deepEqual(recovered.association?.selection, selection);
});
