import assert from "node:assert/strict";
import test from "node:test";
import { executeLeave } from "./merchantAttendanceLeave.server";
import type { LeaveCommand, LeaveQuery } from "./merchantAttendanceLeave";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (access: LeaveQuery["access"]): LeaveQuery => ({ siteId: "99990001", access, requestId: null,
  operationId: null, beforeAt: null, beforeId: null });
const submit: LeaveCommand = { operationId: id(501), action: "submit", reason: "Synthetic dispatch probe", expectedWorkerId: id(201),
  expectedSettingsVersion: 1, timeZone: "Europe/Madrid", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z" };
const decision = (action: "approve" | "reject" | "cancel" | "withdraw"): LeaveCommand => ({ action, operationId: id(502),
  requestId: id(501), reason: "Synthetic dispatch probe", expectedRevision: action === "cancel" ? 2 : 1 });
const authUserId = id(99);

test("flag off and nonliteral values leave all existing executor traffic on original leave_v1", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED; else process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = previous; });
  for (const flag of [undefined, "", "0", "true"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;
    else process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = flag;
    for (const [q, command] of [[query("self"), null], [query("owner"), null], [query("self"), submit],
      [{ ...query("self"), requestId: id(501) }, decision("withdraw")],
      ...(["approve", "reject", "cancel"] as const).map(action => [{ ...query("owner"), requestId: id(501) }, decision(action)] as const)] as readonly (readonly [LeaveQuery, LeaveCommand | null])[]) {
      let calls = 0;
      await assert.rejects(executeLeave({ query: q, command, authUserId, allowWrite: true }, { rpc: async (name, args) => {
        calls++; assert.equal(name, "faolla_attendance_leave_v1");
        assert.deepEqual(args, { p_query: q, p_auth_user_id: authUserId, p_command: command, p_allow_write: true });
        return { data: null, error: { message: "attendance_leave_invalid" } };
      } }), /attendance_leave_invalid/);
      assert.equal(calls, 1);
    }
  }
});

test("enabled dispatch moves only owner approve/reject/cancel to capture wrapper and preserves error and write-gate semantics", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED; else process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = previous; });
  process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED = "1";
  for (const allowWrite of [true, false]) for (const action of ["approve", "reject", "cancel"] as const) {
    const q = { ...query("owner"), requestId: id(501) }, command = decision(action); let calls = 0;
    await assert.rejects(executeLeave({ query: q, command, authUserId, allowWrite }, { rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_attendance_leave_notify_v1");
      assert.deepEqual(args, { p_query: q, p_auth_user_id: authUserId, p_command: command, p_allow_write: allowWrite });
      return { data: null, error: { message: "attendance_leave_invalid" } };
    } }), /attendance_leave_invalid/);
    assert.equal(calls, 1, "capture failure must not retry the old RPC and accidentally commit a decision");
  }
  for (const [q, command] of [[query("self"), null], [query("owner"), null],
    [{ ...query("owner"), requestId: id(501) }, null], [{ ...query("owner"), operationId: id(502) }, null],
    [query("self"), submit], [{ ...query("self"), requestId: id(501) }, decision("withdraw")]] as const) {
    await assert.rejects(executeLeave({ query: q, command, authUserId, allowWrite: true }, { rpc: async name => {
      assert.equal(name, "faolla_attendance_leave_v1"); return { data: null, error: { message: "attendance_leave_invalid" } };
    } }), /attendance_leave_invalid/);
  }
  let calls = 0;
  await assert.rejects(executeLeave({ query: { ...query("self"), requestId: id(501) }, command: decision("approve"), authUserId, allowWrite: true },
    { rpc: async () => { calls++; return { data: null, error: null }; } }), /attendance_invalid_request/);
  assert.equal(calls, 0, "invalid self approval is rejected before any RPC");
});
