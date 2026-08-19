import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder } from "@/lib/merchantOrders";
import { normalizeMerchantMembershipRecord } from "@/lib/merchantMemberships";
import { createEmptyMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import {
  awardOrderPointsToMembership,
  revokeOrderPointsFromMembership,
} from "@/lib/merchantMemberships.server";

function buildFixture() {
  const membership = normalizeMerchantMembershipRecord({
    id: "membership-1",
    siteId: "10000000",
    siteName: "Merchant",
    memberNo: "10000000000001",
    serial: 1,
    accountId: "50010105",
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    pointBalance: 0,
    growthValue: 0,
    transactions: [],
  });
  assert.ok(membership);
  const settings = createEmptyMerchantMembershipSettings("10000000");
  settings.pointsRules.paidAmount = 1;
  settings.pointsRules.paidPoints = 1;
  settings.growthRules.spendAmountGrowth = 1;
  const order = createMerchantOrder({
    siteId: "10000000",
    customerAccountId: "50010105",
    items: [{ productId: "product-a", name: "Product", quantity: 1, unitPrice: 100 }],
  });
  order.status = "completed";
  return { membership, settings, order };
}

test("order point award, reversal and re-completion stay idempotent", () => {
  const { membership, settings, order } = buildFixture();
  const awarded = awardOrderPointsToMembership({
    membership,
    order,
    settings,
    now: "2026-07-18T10:00:00.000Z",
  });
  assert.equal(awarded.pointBalance, 100);
  assert.equal(awarded.growthValue, 100);
  assert.equal(
    awardOrderPointsToMembership({ membership: awarded, order, settings, now: "2026-07-18T10:01:00.000Z" }),
    awarded,
  );

  const reversed = revokeOrderPointsFromMembership({
    membership: awarded,
    order,
    settings,
    now: "2026-07-18T10:02:00.000Z",
  });
  assert.equal(reversed.pointBalance, 0);
  assert.equal(reversed.growthValue, 0);
  assert.equal(
    revokeOrderPointsFromMembership({ membership: reversed, order, settings, now: "2026-07-18T10:03:00.000Z" }),
    reversed,
  );

  const reawarded = awardOrderPointsToMembership({
    membership: reversed,
    order,
    settings,
    now: "2026-07-18T10:04:00.000Z",
  });
  assert.equal(reawarded.pointBalance, 100);
  assert.equal(reawarded.growthValue, 100);
});

test("order completion cannot be reversed after awarded points are no longer available", () => {
  const { membership, settings, order } = buildFixture();
  const awarded = awardOrderPointsToMembership({
    membership,
    order,
    settings,
    now: "2026-07-18T10:00:00.000Z",
  });
  assert.throws(
    () =>
      revokeOrderPointsFromMembership({
        membership: { ...awarded, pointBalance: 50 },
        order,
        settings,
        now: "2026-07-18T10:05:00.000Z",
      }),
    /membership_recharge_cancel_balance_insufficient/,
  );
});
