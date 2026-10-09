import assert from "node:assert/strict";
import test from "node:test";
import { attendanceActionAllowed, attendanceModuleEnabled } from "./merchantAttendanceEntitlement";
import { createDefaultMerchantPermissionConfig, normalizeMerchantPermissionConfig } from "@/data/platformControlStore";
import { MERCHANT_ATTENDANCE_ACTIONS } from "./merchantAttendance";

// These cases isolate saved permission semantics from a publisher's process env.
// Exact rollout cohorts and missing site identities have their own matrix tests.
const permissionOnlyEnvironment = {};

test("attendance is default closed for new, legacy, malformed and enterprise-only permissions", () => {
  assert.equal(createDefaultMerchantPermissionConfig().allowEmployeeAttendance, false);
  for (const value of [undefined, null, {}, {allowEnterpriseManagement:true}, {allowEmployeeAttendance:true},
    {allowEnterpriseManagement:true,allowEmployeeAttendance:"true"}, {allowEnterpriseManagement:false,allowEmployeeAttendance:true}]) {
    assert.equal(normalizeMerchantPermissionConfig(value).allowEmployeeAttendance, false);
    assert.equal(attendanceModuleEnabled({permissionConfig:value ?? undefined}, permissionOnlyEnvironment), false);
  }
  assert.equal(attendanceModuleEnabled(undefined, permissionOnlyEnvironment), false);
});
test("attendance requires two explicit flags and preserves unrelated permissions", () => {
  const before = normalizeMerchantPermissionConfig({allowEnterpriseManagement:true,allowBusinessCardLinkMode:true});
  const after = normalizeMerchantPermissionConfig({...before,allowEmployeeAttendance:true});
  assert.equal(attendanceModuleEnabled({permissionConfig:after}, permissionOnlyEnvironment), true);
  assert.deepEqual({...after,allowEmployeeAttendance:false}, before);
  assert.deepEqual(normalizeMerchantPermissionConfig(JSON.parse(JSON.stringify(after))), after);
});
test("paused action matrix admits only closing actions; DB still validates actual state", () => {
  for(const action of MERCHANT_ATTENDANCE_ACTIONS) {
    assert.equal(attendanceActionAllowed(true,action),true);
    assert.equal(attendanceActionAllowed(false,action),["break_end","clock_out"].includes(action));
  }
});
