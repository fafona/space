import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelMerchantMemberRechargeTransaction,
  normalizeMerchantMembershipRecord,
} from "./merchantMemberships";

function buildMembership(input?: { pointBalance?: number; balanceAmount?: number; transactionType?: "recharge" | "redeem" }) {
  const membership = normalizeMerchantMembershipRecord({
    id: "membership-1",
    siteId: "10000000",
    siteName: "Test merchant",
    memberNo: "10000000000001",
    serial: 1,
    accountId: "account-1",
    joinedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    status: "active",
    pointBalance: input?.pointBalance ?? 1200,
    balanceAmount: input?.balanceAmount ?? 150,
    growthValue: 80,
    transactions: [
      {
        id: "recharge-1",
        type: input?.transactionType ?? "recharge",
        at: "2026-07-15T10:00:00.000Z",
        pointDelta: 1000,
        balanceDelta: 100,
        growthDelta: 25,
        note: "充值方案：方案 1",
        operatorId: "10000000",
      },
    ],
  });
  assert.ok(membership);
  return membership;
}

test("legacy recharge transactions normalize to completed status", () => {
  const membership = buildMembership();
  assert.equal(membership.transactions[0]?.status, "completed");
  assert.equal(membership.transactions[0]?.cancelledAt, null);
});

test("cancelling a recharge reverses balances and preserves the cancelled record", () => {
  const membership = buildMembership();
  const result = cancelMerchantMemberRechargeTransaction({
    membership,
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T08:00:00.000Z",
    cancellationNote: "客户充值金额录入错误",
    cancelledBy: "10000000",
    cancellationOperationMarker: "[op:member-recharge-cancel:test-1]",
  });

  assert.equal(result.alreadyCancelled, false);
  assert.equal(result.membership.pointBalance, 200);
  assert.equal(result.membership.balanceAmount, 50);
  assert.equal(result.membership.growthValue, 55);
  assert.equal(result.membership.transactions.length, 1);
  assert.equal(result.transaction.status, "cancelled");
  assert.equal(result.transaction.cancellationNote, "客户充值金额录入错误");
  assert.equal(result.transaction.cancelledBy, "10000000");

  const persisted = normalizeMerchantMembershipRecord(result.membership);
  assert.ok(persisted);
  assert.equal(persisted.transactions[0]?.status, "cancelled");
  assert.equal(persisted.transactions[0]?.cancelledAt, "2026-07-16T08:00:00.000Z");
  assert.equal(persisted.transactions[0]?.cancellationNote, "客户充值金额录入错误");
});

test("replaying the same recharge cancellation is idempotent", () => {
  const first = cancelMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T08:00:00.000Z",
    cancellationOperationMarker: "[op:member-recharge-cancel:test-1]",
  });
  const replay = cancelMerchantMemberRechargeTransaction({
    membership: first.membership,
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T08:01:00.000Z",
    cancellationOperationMarker: "[op:member-recharge-cancel:test-1]",
  });

  assert.equal(replay.alreadyCancelled, true);
  assert.equal(replay.membership.pointBalance, 200);
  assert.equal(replay.membership.balanceAmount, 50);
});

test("a cancelled recharge cannot be cancelled by a different operation", () => {
  const first = cancelMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T08:00:00.000Z",
    cancellationOperationMarker: "[op:member-recharge-cancel:test-1]",
  });

  assert.throws(
    () =>
      cancelMerchantMemberRechargeTransaction({
        membership: first.membership,
        transactionId: "recharge-1",
        cancelledAt: "2026-07-16T08:02:00.000Z",
        cancellationOperationMarker: "[op:member-recharge-cancel:test-2]",
      }),
    /membership_recharge_already_cancelled/,
  );
});

test("recharge cancellation is rejected when the credited value has already been spent", () => {
  const membership = buildMembership({ pointBalance: 900, balanceAmount: 90 });
  assert.throws(
    () =>
      cancelMerchantMemberRechargeTransaction({
        membership,
        transactionId: "recharge-1",
        cancelledAt: "2026-07-16T08:00:00.000Z",
      }),
    /membership_recharge_cancel_balance_insufficient/,
  );
  assert.equal(membership.transactions[0]?.status, "completed");
});

test("redemption transactions cannot be cancelled as recharges", () => {
  assert.throws(
    () =>
      cancelMerchantMemberRechargeTransaction({
        membership: buildMembership({ transactionType: "redeem" }),
        transactionId: "recharge-1",
        cancelledAt: "2026-07-16T08:00:00.000Z",
      }),
    /membership_recharge_not_cancellable/,
  );
});
