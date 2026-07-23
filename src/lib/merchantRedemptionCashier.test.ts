import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeanRedemptionCashierMembership,
  buildRedemptionCashierMembershipList,
} from "./merchantRedemptionCashier";

test("cashier list is capped and strips transaction-heavy details", () => {
  const memberships = Array.from({ length: 305 }, (_, index) => ({
    id: `member-${index}`,
    status: "active",
    transactions: [{ type: "recharge", note: "large history row" }],
    insight: { couponHistory: ["claim"] },
  }));

  const result = buildRedemptionCashierMembershipList(memberships, {
    mode: "cashier",
    limit: 300,
  });

  assert.equal(result.length, 300);
  assert.deepEqual(result[0]?.transactions, []);
  assert.equal(result[0]?.insight, undefined);
  assert.equal(memberships[0]?.transactions.length, 1);
  assert.notEqual(result[0], memberships[0]);
});

test("record views preserve matching transaction history", () => {
  const memberships = [
    {
      id: "recharge",
      status: "active",
      transactions: [{ type: "recharge", adjustmentKind: "" }],
      insight: { marker: true },
    },
    {
      id: "adjustment-only",
      status: "active",
      transactions: [{ type: "recharge", adjustmentKind: "manual_adjustment" }],
      insight: { marker: true },
    },
    {
      id: "redeem",
      status: "inactive",
      transactions: [{ type: "redeem", adjustmentKind: "" }],
      insight: { marker: true },
    },
  ];

  const rechargeRecords = buildRedemptionCashierMembershipList(memberships, {
    mode: "rechargeRecords",
    limit: 1,
  });
  const redemptionRecords = buildRedemptionCashierMembershipList(memberships, {
    mode: "records",
    limit: 1,
  });

  assert.deepEqual(rechargeRecords.map((membership) => membership.id), ["recharge"]);
  assert.deepEqual(redemptionRecords.map((membership) => membership.id), ["redeem"]);
  assert.equal(rechargeRecords[0]?.transactions.length, 1);
  assert.deepEqual(buildLeanRedemptionCashierMembership(memberships[0]!).transactions, []);
});
