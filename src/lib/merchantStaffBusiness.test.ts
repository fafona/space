import assert from "node:assert/strict";
import test from "node:test";
import {
  getMerchantStaffBusinessPermissionDependencies,
  hasMerchantStaffBusinessPermissions,
  isMerchantStaffBusinessPermission,
  MERCHANT_STAFF_BUSINESS_PERMISSION_CATALOG,
  MERCHANT_STAFF_BUSINESS_PERMISSIONS,
} from "@/lib/merchantStaffBusiness";
import {
  isMerchantStaffBusinessRolloutEnabled,
  resolveMerchantStaffBusinessRolloutConfig,
} from "@/lib/merchantStaffBusinessRollout.server";

test("staff business permissions are unique and have one catalog entry", () => {
  assert.equal(
    new Set(MERCHANT_STAFF_BUSINESS_PERMISSIONS).size,
    MERCHANT_STAFF_BUSINESS_PERMISSIONS.length,
  );
  assert.deepEqual(
    MERCHANT_STAFF_BUSINESS_PERMISSION_CATALOG.map((entry) => entry.key),
    [...MERCHANT_STAFF_BUSINESS_PERMISSIONS],
  );
  for (const permission of MERCHANT_STAFF_BUSINESS_PERMISSIONS) {
    assert.equal(isMerchantStaffBusinessPermission(permission), true);
  }
  assert.equal(isMerchantStaffBusinessPermission("enterprise.view"), false);
  assert.equal(hasMerchantStaffBusinessPermissions(["enterprise.view"]), false);
  assert.equal(
    hasMerchantStaffBusinessPermissions(["enterprise.view", "orders.view"]),
    true,
  );
});

test("staff business permission dependencies stay inside their own menu", () => {
  for (const permission of MERCHANT_STAFF_BUSINESS_PERMISSIONS) {
    const moduleName = permission.split(".")[0];
    for (const dependency of getMerchantStaffBusinessPermissionDependencies(
      permission,
    )) {
      assert.equal(
        dependency.split(".")[0],
        moduleName,
        `${permission} unexpectedly depends on ${dependency}`,
      );
    }
  }
});

test("staff business rollout is default-off and exact-site allowlisted", () => {
  assert.deepEqual(resolveMerchantStaffBusinessRolloutConfig({}), {
    mode: "off",
    siteIds: [],
    valid: true,
  });
  const enabled = resolveMerchantStaffBusinessRolloutConfig({
    MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce",
    MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "10000001,10000000",
    FAOLLA_CANONICAL_PORTAL_ORIGIN: "https://launch.faolla.com",
  });
  assert.deepEqual(enabled, {
    mode: "enforce",
    siteIds: ["10000000", "10000001"],
    valid: true,
  });
  assert.equal(isMerchantStaffBusinessRolloutEnabled("10000000", enabled), true);
  assert.equal(isMerchantStaffBusinessRolloutEnabled("10000002", enabled), false);
});

test("staff business rollout rejects ambiguous or unsafe configuration", () => {
  for (const environment of [
    { MERCHANT_STAFF_BUSINESS_RBAC_MODE: "true" },
    { MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce" },
    {
      MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce",
      MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "10000000",
    },
    {
      MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce",
      MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "10000000",
      FAOLLA_CANONICAL_PORTAL_ORIGIN: "https://launch.faolla.com/path",
    },
    {
      MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce",
      MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "*",
    },
    {
      MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce",
      MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "10000000,10000000",
    },
    {
      MERCHANT_STAFF_BUSINESS_RBAC_MODE: "off",
      MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "10000000,",
    },
  ]) {
    const config = resolveMerchantStaffBusinessRolloutConfig(environment);
    assert.equal(config.valid, false);
    assert.equal(
      isMerchantStaffBusinessRolloutEnabled("10000000", config),
      false,
    );
  }
});
