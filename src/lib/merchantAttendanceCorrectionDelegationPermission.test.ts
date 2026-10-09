import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DEFAULT_MERCHANT_ENTERPRISE_ROLES, MERCHANT_ENTERPRISE_PERMISSIONS, MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  getMissingMerchantEnterprisePermissionDependencies, normalizeMerchantEnterprisePermissions, parseMerchantEnterprisePermissionsStrict,
  toggleMerchantEnterprisePermissionSelection, hasMerchantEnterprisePermission, type MerchantEnterpriseActor } from "./merchantEnterprise";

const permission = "attendance.correction.review" as const;
test("initial correction approval is an explicit separate capability, without a worker/self-view requirement", () => {
  assert.equal(MERCHANT_ENTERPRISE_PERMISSIONS.filter(value => value === permission).length, 1);
  assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies([permission]), ["enterprise.view"]);
  assert.deepEqual(toggleMerchantEnterprisePermissionSelection([], permission, true), ["enterprise.view", permission]);
  assert.deepEqual(toggleMerchantEnterprisePermissionSelection(["enterprise.view", permission], "enterprise.view", false), []);
  const item = MERCHANT_ENTERPRISE_PERMISSION_CATALOG.find(value => value.key === permission)!;
  assert.equal(item.risk, "high");
  for (const text of ["负责人另行授权", "历史地点", "有效期", "首次补正", "既有待审申请须额外授权", "禁止自批", "仅勾选不授予范围", "不包含连续修订"]) assert(item.description.includes(text));
});
test("old stored/default roles and broad board access gain no approval authority", () => {
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) {
    assert(!role.permissions.includes(permission));
    assert.deepEqual(normalizeMerchantEnterprisePermissions(role.permissions), role.permissions);
    assert.deepEqual(parseMerchantEnterprisePermissionsStrict(role.permissions), role.permissions);
  }
  const actor: MerchantEnterpriseActor = { type: "employee", id: "10000000-0000-4000-8000-000000000001", siteId: "99990001",
    roleId: "10000000-0000-4000-8000-000000000002", displayName: "Synthetic delegate", email: "synthetic@example.invalid",
    permissions: ["enterprise.view", "attendance.missing.review", "attendance.self.view", "attendance.period.view"], accessScope: "all", allowedBoardIds: [] };
  assert.equal(hasMerchantEnterprisePermission(actor, permission), false);
  const changed = toggleMerchantEnterprisePermissionSelection(actor.permissions, permission, true);
  assert(changed.includes(permission)); assert(!actor.permissions.includes(permission));
  assert(!changed.includes("attendance.leave.review")); assert(!changed.includes("attendance.reports.export"));
});
const folder = new URL("../../scripts/supabase-migrations/", import.meta.url);
const previous = fs.readFileSync(new URL("202610080185_merchant_attendance_period_delegations.sql", folder), "utf8").replaceAll("\r\n", "\n");
const migration = fs.readFileSync(new URL("202610080190_merchant_attendance_correction_delegation_permission.sql", folder), "utf8").replaceAll("\r\n", "\n");
const definition = (source: string) => {
  const start = source.lastIndexOf("create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(");
  assert(start >= 0); const end = source.indexOf("$$;", start); assert(end > start); return source.slice(start, end + 3);
};
test("190 preserves the full last catalog and adds only one exact permission row", () => {
  const before = definition(previous), after = definition(migration);
  assert.equal(after.replace("      ('attendance.correction.review', array['enterprise.view']::text[]),\n", ""), before);
  assert.match(migration, /version=202610080189/);
  assert.doesNotMatch(migration, /(?:update|delete\s+from|insert\s+into)\s+public\.merchant_enterprise_roles/i);
  assert.doesNotMatch(migration, /grant\s+execute|alter\s+function.*owner/i);
});
test("install/reinstall reject unknown permission definitions instead of overwriting external changes", () => {
  const body = (value: string) => definition(value).split("as $$")[1].slice(0, -3);
  const hash = (value: string) => createHash("md5").update(body(value), "utf8").digest("hex");
  assert(migration.includes(`'${hash(previous)}'`)); assert(migration.includes(`'${hash(migration)}'`));
  assert.match(migration, /permission_drift/); assert.match(migration, /existing_definition\.proowner/);
  assert.match(migration, /existing_definition\.proconfig is distinct from/);
  assert.match(migration, /is distinct from\s+\(case when installed then '[a-f0-9]{32}' else '[a-f0-9]{32}' end\) then/);
});
