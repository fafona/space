import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MERCHANT_ENTERPRISE_ROLES, MERCHANT_ENTERPRISE_PERMISSIONS,
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG, getMissingMerchantEnterprisePermissionDependencies,
  toggleMerchantEnterprisePermissionSelection,
} from "./merchantEnterprise";

test("delegated missing review is independent, self-entry reachable and not default-granted", () => {
  const key = "attendance.missing.review";
  assert(MERCHANT_ENTERPRISE_PERMISSIONS.includes(key));
  assert.equal(MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter(p => p.key === key).length, 1);
  assert(getMissingMerchantEnterprisePermissionDependencies([key]).length > 0);
  assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["enterprise.view", "attendance.self.view", key]), []);
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) assert(!role.permissions.includes(key));
  const selected = toggleMerchantEnterprisePermissionSelection([], key, true);
  assert.deepEqual(new Set(selected), new Set(["enterprise.view", "attendance.self.view", key]));
  assert(!toggleMerchantEnterprisePermissionSelection(selected, "attendance.self.view", false).includes(key));
});

test("161 adds exactly one permission and no stored role/data grants to 157", () => {
  const before = readFileSync("scripts/supabase-migrations/202610060157_merchant_attendance_work_arrangement_permission.sql", "utf8");
  const after = readFileSync("scripts/supabase-migrations/202610060161_merchant_attendance_missing_delegation_permission.sql", "utf8");
  const body = (s: string) => s.slice(s.indexOf("create or replace function"), s.indexOf("insert into public.faolla_schema_migrations")).replaceAll("\r\n", "\n");
  assert.equal(body(after).replace("      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),\n", ""), body(before));
  assert.doesNotMatch(after, /(?:insert into|update|delete from)\s+public\.merchant_enterprise_(?:roles|employees)/i);
});
