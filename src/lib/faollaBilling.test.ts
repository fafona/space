import assert from "node:assert/strict";
import test from "node:test";
import {
  getFaollaPlanEntitlements,
  isFaollaSubscriptionEntitled,
  normalizeFaollaMerchantSubscription,
  resolveFaollaSubscriptionPermissionConfig,
} from "@/lib/faollaBilling";

test("faolla subscription plans map to expected permission tiers", () => {
  const basic = getFaollaPlanEntitlements("basic");
  const advanced = getFaollaPlanEntitlements("advanced");
  const pro = getFaollaPlanEntitlements("pro");

  assert.equal(basic.permissionConfig.businessCardLimit, 1);
  assert.equal(basic.permissionConfig.allowOrderManagement, false);
  assert.equal(advanced.permissionConfig.businessCardLimit, 3);
  assert.equal(advanced.permissionConfig.allowOrderManagement, true);
  assert.equal(pro.permissionConfig.allowMembershipManagement, true);
  assert.equal(pro.permissionConfig.allowPointsRedemption, true);
  assert.equal(pro.allowMerchantConnectPayments, true);
});

test("faolla subscription entitlement allows active and trialing statuses", () => {
  const base = normalizeFaollaMerchantSubscription({
    merchantId: "10000000",
    planKey: "pro",
    billingInterval: "year",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.ok(base);
  assert.equal(isFaollaSubscriptionEntitled(base), true);
  assert.equal(resolveFaollaSubscriptionPermissionConfig(base).allowMembershipManagement, true);
});

test("faolla subscription entitlement grants a bounded past_due grace period", () => {
  const subscription = normalizeFaollaMerchantSubscription({
    merchantId: "10000000",
    planKey: "advanced",
    billingInterval: "month",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    status: "past_due",
    currentPeriodEnd: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  });
  assert.ok(subscription);
  assert.equal(isFaollaSubscriptionEntitled(subscription, "2026-06-16T23:59:00.000Z"), true);
  assert.equal(isFaollaSubscriptionEntitled(subscription, "2026-06-18T00:00:01.000Z"), false);
});

test("faolla subscription falls back to basic permissions when not entitled", () => {
  const subscription = normalizeFaollaMerchantSubscription({
    merchantId: "10000000",
    planKey: "pro",
    billingInterval: "month",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    status: "canceled",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  });
  assert.ok(subscription);
  const permission = resolveFaollaSubscriptionPermissionConfig(subscription);
  assert.equal(permission.businessCardLimit, 1);
  assert.equal(permission.allowMembershipManagement, false);
});
