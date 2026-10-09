import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttendanceEvent, initialAttendanceState, isAttendanceCommandReplay,
  summarizeAttendanceSession, validateAttendanceCommand,
  type AttendanceAction, type AttendanceEvent, type AttendanceSession,
} from "./merchantAttendance";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", workerId = id(1), locationId = id(2);
const initial = () => initialAttendanceState(siteId, workerId);
const event = (sequence: number, action: AttendanceAction, time: string, overrides: Partial<AttendanceEvent> = {}): AttendanceEvent => ({
  siteId, workerId, locationId, sequence, action, id: id(100 + sequence), operationId: id(200 + sequence),
  occurredAt: `2026-09-29T${time}:00.000Z`, timeZone: "Europe/Madrid", breakPaid: action === "break_start" ? false : null,
  ...overrides,
});
function error(code: string) { return (value: unknown) => value instanceof MerchantAttendanceError && value.code === code; }
function complete(events: AttendanceEvent[]) {
  let state = initial();
  const sessions: AttendanceSession[] = [];
  for (const item of events) {
    const before = structuredClone(state), input = structuredClone(item);
    const next = applyAttendanceEvent(state, item);
    assert.deepEqual(state, before, "reducer mutated its input state");
    assert.deepEqual(item, input, "reducer mutated the original event");
    state = next.state;
    if (next.completedSession) sessions.push(next.completedSession);
  }
  return { state, sessions };
}

test("keeps actual work, paid breaks and credited time separate", () => {
  const result = complete([
    event(1, "clock_in", "07:00"), event(2, "break_start", "11:00"), event(3, "break_end", "12:00"),
    event(4, "break_start", "14:00", { breakPaid: true }), event(5, "break_end", "14:15"), event(6, "clock_out", "16:00"),
  ]);
  const summary = summarizeAttendanceSession(result.sessions[0]);
  assert.equal(result.state.status, "off");
  assert.equal(result.state.session, null);
  assert.equal(summary.elapsedMs, 9 * 3_600_000);
  assert.equal(summary.breakMs, 75 * 60_000);
  assert.equal(summary.paidBreakMs, 15 * 60_000);
  assert.equal(summary.workedMs, 465 * 60_000);
  assert.equal(summary.creditedMs, 8 * 3_600_000);
});

test("allows split shifts without invented scheduled ends or automatic lunch deductions", () => {
  const { sessions } = complete([
    event(1, "clock_in", "08:00"), event(2, "clock_out", "12:00"),
    event(3, "clock_in", "15:00"), event(4, "clock_out", "19:00"),
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.reduce((sum, item) => sum + summarizeAttendanceSession(item).workedMs, 0), 8 * 3_600_000);
});

test("an open or unfinished break never fabricates a completed shift", () => {
  const first = applyAttendanceEvent(initial(), event(1, "clock_in", "07:00"));
  const second = applyAttendanceEvent(first.state, event(2, "break_start", "11:00"));
  assert.equal(first.completedSession, null);
  assert.equal(second.completedSession, null);
  assert.equal(second.state.status, "break");
  assert.throws(() => applyAttendanceEvent(second.state, event(3, "clock_out", "16:00")), error("attendance_break_must_end"));
});

for (const [action, expected] of [["break_start", "attendance_not_working"], ["break_end", "attendance_not_on_break"],
  ["clock_out", "attendance_not_clocked_in"]] as const) {
  test(`rejects ${action} while off`, () => assert.throws(() => applyAttendanceEvent(initial(), event(1, action, "07:00")), error(expected)));
}

test("duplicate taps do not toggle clock-in to clock-out", () => {
  const first = applyAttendanceEvent(initial(), event(1, "clock_in", "07:00"));
  assert.throws(() => applyAttendanceEvent(first.state, event(2, "clock_in", "07:00")), error("attendance_already_clocked_in"));
  assert.throws(() => applyAttendanceEvent(first.state, event(1, "clock_in", "07:00")), error("attendance_sequence_conflict"));
});

for (const [label, patch, expected] of [
  ["another tenant", { siteId: "99990002" }, "attendance_scope_mismatch"],
  ["another worker", { workerId: id(3) }, "attendance_scope_mismatch"],
  ["a sequence gap", { sequence: 2 }, "attendance_sequence_conflict"],
  ["a fractional sequence", { sequence: 1.2 }, "attendance_sequence_conflict"],
  ["an unsafe sequence", { sequence: Number.MAX_SAFE_INTEGER + 1 }, "attendance_sequence_conflict"],
  ["an unknown action", { action: "toggle" as AttendanceAction }, "attendance_invalid_action"],
  ["a missing id", { id: "" }, "attendance_invalid_id"],
  ["a noncanonical UUID", { operationId: "AAAAAAAA-0000-4000-8000-000000000001" }, "attendance_invalid_id"],
  ["a missing location", { locationId: "" }, "attendance_invalid_id"],
  ["break classification on clock-in", { breakPaid: true }, "attendance_invalid_break_type"],
] as const) {
  test(`rejects ${label}`, () => assert.throws(() => applyAttendanceEvent(initial(), event(1, "clock_in", "07:00", patch)), error(expected)));
}

test("rejects reversed event time but accepts explicit adjacent actions at the same instant", () => {
  const first = applyAttendanceEvent(initial(), event(1, "clock_in", "07:00"));
  assert.throws(() => applyAttendanceEvent(first.state, event(2, "clock_out", "06:59")), error("attendance_time_reversed"));
  const closed = applyAttendanceEvent(first.state, event(2, "clock_out", "07:00"));
  assert.equal(summarizeAttendanceSession(closed.completedSession!).workedMs, 0);
});

test("finds a committed retry without treating another employee's operation as its receipt", () => {
  const original = event(1, "clock_in", "07:00");
  assert.equal(isAttendanceCommandReplay(original, { ...original }), true);
  assert.equal(isAttendanceCommandReplay(original, { ...original, workerId: id(4) }), false);
  assert.equal(isAttendanceCommandReplay(original, { ...original, siteId: "99990002" }), false);
  assert.equal(isAttendanceCommandReplay(original, { ...original, operationId: id(5) }), false);
  assert.throws(() => isAttendanceCommandReplay(original, { ...original, action: "clock_out" }), error("attendance_operation_conflict"));
  assert.throws(() => isAttendanceCommandReplay(original, { ...original, locationId: id(6) }), error("attendance_operation_conflict"));
  const paid = event(2, "break_start", "11:00");
  assert.throws(() => isAttendanceCommandReplay(paid, { ...paid, breakPaid: true }), error("attendance_operation_conflict"));
});

test("requires explicit paid/unpaid classification on break start", () => {
  assert.throws(() => validateAttendanceCommand(event(1, "break_start", "07:00", { breakPaid: null })), error("attendance_invalid_break_type"));
});

test("a different checkout location does not rewrite the shift's original time zone", () => {
  const { sessions } = complete([
    event(1, "clock_in", "07:00"), event(2, "clock_out", "08:00", { timeZone: "America/New_York", locationId: id(9) }),
  ]);
  assert.equal(sessions[0].timeZone, "Europe/Madrid");
  assert.equal(sessions[0].endLocationId, id(9));
});

test("splits an overnight shift and midnight break without double counting", () => {
  const { sessions } = complete([
    event(1, "clock_in", "20:00"), event(2, "break_start", "21:45"), event(3, "break_end", "22:15"),
    event(4, "clock_out", "23:00"),
  ]);
  const summary = summarizeAttendanceSession(sessions[0]);
  assert.equal(sessions[0].startDate, "2026-09-29");
  assert.deepEqual(summary.daily.map((day) => [day.date, day.durationMs / 60_000, day.breakMs / 60_000, day.workedMs / 60_000]),
    [["2026-09-29", 120, 15, 105], ["2026-09-30", 60, 15, 45]]);
  assert.equal(summary.workedMs, 150 * 60_000);
});

test("rejects corrupt materialized state instead of calculating plausible hours", () => {
  assert.throws(() => applyAttendanceEvent({ ...initial(), status: "working" }, event(1, "clock_in", "07:00")), error("attendance_invalid_state"));
  const active = applyAttendanceEvent(initial(), event(1, "clock_in", "07:00")).state;
  active.session!.breaks = [{ startAt: "2026-09-29T06:00:00.000Z", endAt: "2026-09-29T06:15:00.000Z", paid: false }];
  assert.throws(() => applyAttendanceEvent(active, event(2, "clock_out", "16:00")), error("attendance_invalid_breaks"));
});

test("rejects overlapping breaks and invalid shift attribution", () => {
  const session = complete([event(1, "clock_in", "07:00"), event(2, "clock_out", "16:00")]).sessions[0];
  assert.throws(() => summarizeAttendanceSession({ ...session, startDate: "2026-09-28" }), error("attendance_invalid_start_date"));
  assert.throws(() => summarizeAttendanceSession({ ...session, breaks: [
    { startAt: "2026-09-29T11:00:00.000Z", endAt: "2026-09-29T12:00:00.000Z", paid: false },
    { startAt: "2026-09-29T11:30:00.000Z", endAt: "2026-09-29T12:30:00.000Z", paid: true },
  ] }), error("attendance_invalid_breaks"));
});
