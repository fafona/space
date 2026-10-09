import assert from "node:assert/strict";
import test from "node:test";
import { attendanceRolloutSiteEnabled, attendanceUiAdmissionCurrent } from "./merchantAttendanceRollout";
import { attendanceActionAllowed, attendanceModuleEnabled } from "./merchantAttendanceEntitlement";

const env = { FAOLLA_ATTENDANCE_ROLLOUT_ENABLED: "1", FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS: "10000000" };
test("production cohort never grants saved platform rights or admits another merchant", () => {
  for (const id of ["10000000", "10000001", "*", undefined, null, " 10000000", "10000000,10000001"]) {
    for (const enterprise of [false, true]) for (const attendance of [false, true]) {
      const site = { id, permissionConfig: { allowEnterpriseManagement: enterprise, allowEmployeeAttendance: attendance } };
      const before = JSON.stringify(site);
      assert.equal(attendanceModuleEnabled(site, env), id === "10000000" && enterprise && attendance);
      assert.equal(JSON.stringify(site), before);
    }
  }
  assert.equal(attendanceRolloutSiteEnabled("10000000", {}), true);
  for (const raw of ["", "*", "10000000,*", "10000000,", "10000000,10000000", "1000000", Array(101).fill("10000000").join(",")]) {
    assert.equal(attendanceRolloutSiteEnabled("10000000", { ...env, FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS: raw }), false);
  }
  assert.equal(attendanceRolloutSiteEnabled("10000000", { ...env, FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS: "10000000, 10000001" }), true);
});
test("UI admission is default false and bound to exact site, auth and requester scope", () => {
  const scope = JSON.stringify(["10000000", "token-a", "actor-a", "auth-a"]);
  assert.equal(attendanceUiAdmissionCurrent(null, scope), false);
  assert.equal(attendanceUiAdmissionCurrent({ enabled: false, scope }, scope), false);
  assert.equal(attendanceUiAdmissionCurrent({ enabled: true, scope }, scope), true);
  for (let index = 0; index < 4; index++) {
    const current = ["10000000", "token-a", "actor-a", "auth-a"]; current[index] = "changed";
    assert.equal(attendanceUiAdmissionCurrent({ enabled: true, scope }, JSON.stringify(current)), false);
  }
});
test("admission pause preserves existing exact closing actions", () => {
  const enabled = attendanceModuleEnabled({ id: "10000001", permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }, env);
  assert.equal(enabled, false);
  assert.equal(attendanceActionAllowed(enabled, "clock_in"), false);
  assert.equal(attendanceActionAllowed(enabled, "break_start"), false);
  assert.equal(attendanceActionAllowed(enabled, "clock_out"), true);
  assert.equal(attendanceActionAllowed(enabled, "break_end"), true);
});
