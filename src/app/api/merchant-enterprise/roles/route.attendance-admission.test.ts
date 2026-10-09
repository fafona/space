import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canMerchantEnterpriseRoleIntroduceAttendancePermissions } from "./route-handler";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";

const enterprise = ["enterprise.view", "roles.view", "roles.manage"];
const saved = [...enterprise, "attendance.self.view", "attendance.self.clock"];

test("closed admission rejects only newly introduced attendance grants on create or edit", () => {
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions([], enterprise, false), true);
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions([], [...enterprise, "attendance.self.view"], false), false);
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions(saved, [...saved, "attendance.records.view"], false), false);
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions(enterprise, ["attendance.self.view"], false), false);
});

test("unchanged historical attendance rights and omitted permissions preserve unrelated role editing", () => {
  const before = [...saved];
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions(saved, undefined, false), true);
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions(saved, [...saved].reverse(), false), true);
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions(saved, [...saved, "tasks.view"], false), true);
  // Explicit removal remains a caller request; the admission check itself never
  // edits the array or manufactures a replacement role.
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions(saved, enterprise, false), true);
  assert.deepEqual(saved, before);
});

test("open admission does not replace the existing actor, dependency or version checks", () => {
  assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions([], ["attendance.self.view"], true), true);
  const source = readFileSync(new URL("./route-handler.ts", import.meta.url), "utf8");
  assert.match(source, /requiredPermission: "roles\.manage"/);
  assert.match(source, /getMissingMerchantEnterprisePermissionDependencies\(permissions\)/);
  assert.match(source, /merchantEnterprisePermissionsFitActor\(actor, permissions\)/);
  assert.match(source, /isMerchantEnterpriseVersion\(body\?\.version\)/);
  assert.match(source, /permissions \? \{ permissions \} : \{\}/);
});

test("authoritative platform permission and exact release cohort jointly decide new grant admission", () => {
  const env = { FAOLLA_ATTENDANCE_ROLLOUT_ENABLED: "1", FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS: "10000000" };
  const permissionConfig = { allowEnterpriseManagement: true, allowEmployeeAttendance: true };
  for (const site of [
    { id: "10000001", permissionConfig },
    { id: "10000000", permissionConfig: { ...permissionConfig, allowEmployeeAttendance: false } },
    { id: "10000000", permissionConfig: { ...permissionConfig, allowEnterpriseManagement: false } },
    null,
  ]) {
    assert.equal(canMerchantEnterpriseRoleIntroduceAttendancePermissions([], ["attendance.self.view"], attendanceModuleEnabled(site, env)), false);
  }
  assert.equal(attendanceModuleEnabled({ id: "10000000", permissionConfig }, env), true);
});

test("both real mutation handlers deny new grants before their write RPC and reuse the validated entitlement", () => {
  const source = readFileSync(new URL("./route-handler.ts", import.meta.url), "utf8");
  assert.match(source, /const site = await requireMerchantEnterpriseEntitlement\(siteId\);\s*return \{ actor, attendanceEnabled: attendanceModuleEnabled\(site\) \};/);
  const post = source.slice(source.indexOf("export async function POST("), source.indexOf("export async function PATCH("));
  const patch = source.slice(source.indexOf("export async function PATCH("));
  assert.match(post, /canMerchantEnterpriseRoleIntroduceAttendancePermissions\(\[\], permissions, attendanceEnabled\)/);
  assert.match(patch, /canMerchantEnterpriseRoleIntroduceAttendancePermissions\(targetRole\.permissions, permissions \?\? undefined, attendanceEnabled\)/);
  for (const [body, writer] of [[post, "await createMerchantEnterpriseRole("], [patch, "await updateMerchantEnterpriseRole("]] as const) {
    assert(body.indexOf('error: "attendance_permission_grant_disabled"') < body.indexOf(writer));
    assert.match(body, /\{ status: 403 \}/);
  }
  assert.doesNotMatch(source, /permissions\.filter\([^)]*attendance|permissions\.push\([^)]*attendance/);
});
