import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MERCHANT_ENTERPRISE_ROLES, MERCHANT_ENTERPRISE_PERMISSIONS,
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG, getMissingMerchantEnterprisePermissionDependencies,
  toggleMerchantEnterprisePermissionSelection,
} from "./merchantEnterprise";

for (const key of ["attendance.leave.review", "attendance.work_arrangement.review"] as const) {
  test(`${key} requires explicit personnel delegation and is never default granted`, () => {
    assert(MERCHANT_ENTERPRISE_PERMISSIONS.includes(key));
    assert.equal(MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter(p => p.key === key).length, 1);
    assert(getMissingMerchantEnterprisePermissionDependencies([key]).length > 0);
    assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["enterprise.view", "attendance.self.view", key]), []);
    for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) assert(!role.permissions.includes(key));
    const selected = toggleMerchantEnterprisePermissionSelection([], key, true);
    assert.deepEqual(new Set(selected), new Set(["enterprise.view", "attendance.self.view", key]));
    assert(!selected.includes("attendance.records.view"));
    assert(!selected.includes("attendance.missing.review"));
    assert(!toggleMerchantEnterprisePermissionSelection(selected, "attendance.self.view", false).includes(key));
  });
}

test("163 extends 161 with exactly two independent permissions and no stored grants", () => {
  const before = readFileSync("scripts/supabase-migrations/202610060161_merchant_attendance_missing_delegation_permission.sql", "utf8");
  const after = readFileSync("scripts/supabase-migrations/202610060163_merchant_attendance_application_delegation_permissions.sql", "utf8");
  const body = (s: string) => s.slice(s.indexOf("create or replace function"), s.indexOf("insert into public.faolla_schema_migrations")).replaceAll("\r\n", "\n");
  assert.equal(body(after).replace("      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),\n", "")
    .replace("      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),\n", ""), body(before));
  assert.doesNotMatch(after, /(?:insert into|update|delete from)\s+public\.merchant_enterprise_(?:roles|employees)/i);
});
