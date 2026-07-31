import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MERCHANT_ENTERPRISE_ROLES,
  hasMerchantEnterprisePermission,
  isMerchantEnterpriseSchemaMissingError,
  isMerchantEnterpriseVersion,
  MERCHANT_ENTERPRISE_PERMISSIONS,
  merchantEnterprisePermissionsFitActor,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterprisePermissions,
  normalizeMerchantTask,
  parseMerchantEnterprisePermissionsStrict,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";

test("enterprise permission normalization removes unknown and duplicate permissions", () => {
  assert.deepEqual(
    normalizeMerchantEnterprisePermissions([
      "tasks.view",
      "tasks.view",
      "unknown.permission",
      "employees.manage",
    ]),
    ["tasks.view", "employees.manage"],
  );
});

test("owner has every enterprise permission while employees use their assigned permissions", () => {
  const owner = {
    type: "owner" as const,
    id: "owner-1",
    siteId: "10000000",
    displayName: "Owner",
    email: "owner@example.com",
    permissions: [],
  };
  assert.equal(hasMerchantEnterprisePermission(owner, "roles.manage"), true);
  assert.equal(
    hasMerchantEnterprisePermission(
      {
        type: "employee",
        id: "employee-1",
        siteId: "10000000",
        displayName: "Employee",
        email: "employee@example.com",
        roleId: "role-1",
        permissions: ["tasks.view"],
      },
      "roles.manage",
    ),
    false,
  );
});

test("default administrator role covers the complete initial permission catalog", () => {
  assert.deepEqual(DEFAULT_MERCHANT_ENTERPRISE_ROLES[0]?.permissions, [...MERCHANT_ENTERPRISE_PERMISSIONS]);
});

test("enterprise row normalization accepts database snake-case fields", () => {
  const employee = normalizeMerchantEnterpriseEmployee({
    id: "employee-1",
    merchant_id: "10000000",
    auth_user_id: "auth-1",
    email: "STAFF@EXAMPLE.COM",
    display_name: "Staff",
    role_id: "role-1",
    status: "active",
    version: 2,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T09:00:00.000Z",
  });
  assert.equal(employee?.email, "staff@example.com");
  assert.equal(employee?.roleId, "role-1");
  assert.equal(employee?.version, 2);
});

test("task normalization keeps assignees unique and rejects incomplete rows", () => {
  const task = normalizeMerchantTask(
    {
      id: "task-1",
      merchant_id: "10000000",
      board_id: "board-1",
      column_id: "column-1",
      title: "Prepare order",
      priority: "high",
      created_at: "2026-07-31T08:00:00.000Z",
      updated_at: "2026-07-31T08:00:00.000Z",
    },
    ["employee-1", "employee-1"],
  );
  assert.deepEqual(task?.assigneeIds, ["employee-1"]);
  assert.equal(normalizeMerchantTask({ title: "missing scope" }), null);
});

test("enterprise schema missing errors are recognized without masking unrelated failures", () => {
  assert.equal(isMerchantEnterpriseSchemaMissingError({ code: "42P01" }), true);
  assert.equal(isMerchantEnterpriseSchemaMissingError({ code: "PGRST205" }), true);
  assert.equal(isMerchantEnterpriseSchemaMissingError({ message: "permission denied" }), false);
});

test("strict enterprise permission parsing rejects unknown and malformed values", () => {
  assert.deepEqual(
    parseMerchantEnterprisePermissionsStrict(["enterprise.view", "tasks.view"]),
    ["enterprise.view", "tasks.view"],
  );
  assert.equal(parseMerchantEnterprisePermissionsStrict(["enterprise.view", "unknown"]), null);
  assert.equal(parseMerchantEnterprisePermissionsStrict("enterprise.view"), null);
  assert.equal(parseMerchantEnterprisePermissionsStrict(["enterprise.view", 1]), null);
});

test("employee permission grants cannot exceed the acting employee", () => {
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "主管",
    email: "lead@example.com",
    roleId: "role-1",
    permissions: ["enterprise.view", "tasks.view", "tasks.assign"],
  };
  assert.equal(
    merchantEnterprisePermissionsFitActor(actor, ["enterprise.view", "tasks.view"]),
    true,
  );
  assert.equal(
    merchantEnterprisePermissionsFitActor(actor, ["enterprise.view", "roles.manage"]),
    false,
  );
});

test("enterprise mutations require a positive safe integer version", () => {
  assert.equal(isMerchantEnterpriseVersion(1), true);
  assert.equal(isMerchantEnterpriseVersion(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isMerchantEnterpriseVersion(0), false);
  assert.equal(isMerchantEnterpriseVersion(1.5), false);
  assert.equal(isMerchantEnterpriseVersion("1"), false);
  assert.equal(isMerchantEnterpriseVersion(undefined), false);
});
