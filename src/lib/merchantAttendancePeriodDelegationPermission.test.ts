import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MERCHANT_ENTERPRISE_ROLES,
  MERCHANT_ENTERPRISE_COLLABORATION_PERMISSIONS,
  MERCHANT_ENTERPRISE_PERMISSIONS,
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  getMissingMerchantEnterprisePermissionDependencies,
  hasMerchantEnterprisePermission,
  isMerchantEnterpriseCollaborationPermission,
  merchantEnterprisePermissionsFitActor,
  normalizeMerchantEnterprisePermissions,
  parseMerchantEnterprisePermissionsStrict,
  toggleMerchantEnterprisePermissionSelection,
  type MerchantEnterpriseActor,
  type MerchantEnterprisePermission,
} from "./merchantEnterprise";

const periodPermissions = [
  "attendance.period.view", "attendance.period.send", "attendance.period.respond",
  "attendance.period.seal", "attendance.period.reopen",
] as const;
const writes = periodPermissions.slice(1);
const employee = (permissions: MerchantEnterprisePermission[]): MerchantEnterpriseActor => ({
  type: "employee", id: "10000000-0000-4000-8000-000000000001", siteId: "99990001",
  roleId: "10000000-0000-4000-8000-000000000002", displayName: "Synthetic supervisor",
  email: "synthetic@example.invalid", permissions, accessScope: "all", allowedBoardIds: [],
});

test("exactly five independent period capabilities enter the derived permission types and catalog", () => {
  assert.deepEqual(MERCHANT_ENTERPRISE_PERMISSIONS.filter(p => p.startsWith("attendance.period.")), periodPermissions);
  for (const key of periodPermissions) {
    assert(isMerchantEnterpriseCollaborationPermission(key));
    assert.equal(MERCHANT_ENTERPRISE_COLLABORATION_PERMISSIONS.filter(p => p === key).length, 1);
    assert.equal(MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter(p => p.key === key).length, 1);
  }
  assert.deepEqual(parseMerchantEnterprisePermissionsStrict(periodPermissions), periodPermissions);
  for (const unknown of ["attendance.period.confirm", "attendance.period.dispute", "attendance.period.export", "attendance.period.manage", "attendance.period.*"]) {
    assert.equal(isMerchantEnterpriseCollaborationPermission(unknown), false);
    assert.equal(parseMerchantEnterprisePermissionsStrict([unknown]), null);
  }
});

test("view requires enterprise entry only and implies neither a write action nor record/export access", () => {
  assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["attendance.period.view"]), ["enterprise.view"]);
  const selected = toggleMerchantEnterprisePermissionSelection([], "attendance.period.view", true);
  assert.deepEqual(selected, ["enterprise.view", "attendance.period.view"]);
  assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(selected), []);
  for (const key of writes) assert(!selected.includes(key));
  assert(!selected.includes("attendance.self.view"));
  assert(!selected.includes("attendance.records.view"));
  assert(!selected.includes("attendance.reports.export"));
});

for (const key of writes) {
  test(`${key} depends only on enterprise entry and period view, never sibling actions`, () => {
    assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies([key]), ["enterprise.view", "attendance.period.view"]);
    assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["enterprise.view", key]), ["attendance.period.view"]);
    assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["attendance.period.view", key]), ["enterprise.view"]);
    const selected = toggleMerchantEnterprisePermissionSelection([], key, true);
    assert.deepEqual(new Set(selected), new Set(["enterprise.view", "attendance.period.view", key]));
    assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(selected), []);
    for (const sibling of writes) if (sibling !== key) assert(!selected.includes(sibling));
    for (const old of ["attendance.self.view", "attendance.records.view", "attendance.missing.review", "attendance.leave.review", "attendance.work_arrangement.review", "attendance.reports.export"] as const) {
      assert(!selected.includes(old));
    }
  });
}

test("removing period view cascades only its write capabilities and preserves independent record access", () => {
  const selected: MerchantEnterprisePermission[] = ["enterprise.view", "attendance.records.view", ...periodPermissions];
  assert.deepEqual(toggleMerchantEnterprisePermissionSelection(selected, "attendance.period.view", false), ["enterprise.view", "attendance.records.view"]);
  assert.deepEqual(selected, ["enterprise.view", "attendance.records.view", ...periodPermissions], "selection must not mutate stored input");
  const withoutSeal = toggleMerchantEnterprisePermissionSelection(selected, "attendance.period.seal", false);
  for (const key of periodPermissions) assert.equal(withoutSeal.includes(key), key !== "attendance.period.seal");
  assert.deepEqual(toggleMerchantEnterprisePermissionSelection(selected, "enterprise.view", false), []);
});

test("existing role templates and saved permission arrays acquire no period capabilities", () => {
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) {
    for (const key of periodPermissions) assert(!role.permissions.includes(key), `${role.name}:${key}`);
    assert.deepEqual(normalizeMerchantEnterprisePermissions(role.permissions), role.permissions);
    assert.deepEqual(parseMerchantEnterprisePermissionsStrict(role.permissions), role.permissions);
  }
  const saved: MerchantEnterprisePermission[] = ["enterprise.view", "attendance.self.view", "attendance.records.view", "attendance.reports.export"];
  assert.deepEqual(normalizeMerchantEnterprisePermissions(saved), saved);
  assert.deepEqual(parseMerchantEnterprisePermissionsStrict(saved), saved);
  const actor = employee(saved);
  for (const key of periodPermissions) {
    assert.equal(hasMerchantEnterprisePermission(actor, key), false);
    assert.equal(merchantEnterprisePermissionsFitActor(actor, [key]), false);
  }
});

test("period role capabilities do not inherit from broad board scope or imply personnel delegation", () => {
  const viewOnly = employee(["enterprise.view", "attendance.period.view"]);
  assert.equal(hasMerchantEnterprisePermission(viewOnly, "attendance.period.view"), true);
  for (const key of writes) assert.equal(hasMerchantEnterprisePermission(viewOnly, key), false);
  const catalog = MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter(p => periodPermissions.some(key => key === p.key));
  for (const item of catalog) {
    assert.equal(item.group, "考勤");
    assert.match(item.description, /负责人另行授权/);
    assert.match(item.description, /业务日期范围/);
    assert.match(item.description, /有效期/);
    assert.match(item.description, /既有周期须额外授权/);
    assert.match(item.description, /禁止自管/);
    assert.equal(item.risk, item.key === "attendance.period.view" ? "sensitive" : "high");
  }
  const view = catalog.find(p => p.key === "attendance.period.view")!;
  assert.match(view.description, /跨地点/);
  assert.match(view.description, /仅勾选不授予范围/);
  assert.match(view.description, /不包含写操作、导出、精确定位或附件/);
});

test("risk descriptions retain genuine employee confirmation and immutable archives", () => {
  const description = (key: typeof periodPermissions[number]) => MERCHANT_ENTERPRISE_PERMISSION_CATALOG.find(p => p.key === key)!.description;
  assert.match(description("attendance.period.send"), /保存真实来源版本/);
  assert.match(description("attendance.period.send"), /不代本人确认/);
  assert.match(description("attendance.period.respond"), /回复不消除本人争议/);
  assert.match(description("attendance.period.seal"), /本人确认同一版本、来源未变且无阻断或未决争议/);
  assert.match(description("attendance.period.reopen"), /清除当前确认但保留旧版本和归档/);
  assert.match(description("attendance.period.reopen"), /不解除其他补正限制/);
});
