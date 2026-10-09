import assert from "node:assert/strict";
import test from "node:test";
import { ATTENDANCE_SELF_ERROR_STATUS } from "./merchantAttendanceSelf";
import { attendanceMessage } from "./merchantAttendanceSelfClient";
import { executeAttendanceSelf } from "./merchantAttendanceSelf.server";
import { SELF_SCHEDULE_ADOPTION_ERRORS } from "./merchantAttendanceSelfScheduleAdoption";
import { ATTENDANCE_LOCATION_CLOCK_ERRORS } from "./merchantAttendanceLocationClock";
import { LOCATION_SCHEDULE_ERRORS } from "./merchantAttendanceLocationSchedule";
import { PIN_CLOCK_ERRORS } from "./merchantAttendancePinClock";
import { PIN_SCHEDULE_ERRORS } from "./merchantAttendancePinSchedule";
import { ONSITE_QR_ERRORS } from "./merchantAttendanceOnsiteQr";
import { ONSITE_SCHEDULE_ERRORS } from "./merchantAttendanceOnsiteSchedule";

const code = "attendance_operational_punch_protocol_required";
test("legacy four-channel whitelists preserve the new protocol gate without admitting arbitrary errors", () => {
  for (const errors of [ATTENDANCE_SELF_ERROR_STATUS, SELF_SCHEDULE_ADOPTION_ERRORS, ATTENDANCE_LOCATION_CLOCK_ERRORS,
    LOCATION_SCHEDULE_ERRORS, PIN_CLOCK_ERRORS, PIN_SCHEDULE_ERRORS, ONSITE_QR_ERRORS, ONSITE_SCHEDULE_ERRORS]) {
    assert.equal(errors[code], 409);
    assert.equal(Object.hasOwn(errors, `${code}_unknown`), false);
  }
  assert.match(attendanceMessage(code), /规则打卡.*原号核对/);
  assert.match(attendanceMessage(code), /先在原入口核对/);
});
test("legacy service exposes only the exact protocol gate, not private SQL details", async () => {
  const input = { siteId: "99990001", authUserId: "00000000-0000-4000-8000-000000000001", command: null, operationId: null };
  await assert.rejects(executeAttendanceSelf(input, { rpc: async () => ({ data: null, error: { message: code } }) }), { message: code });
  await assert.rejects(executeAttendanceSelf(input, { rpc: async () => ({ data: null, error: { message: `${code}:private_detail` } }) }), { message: "attendance_unavailable" });
});
