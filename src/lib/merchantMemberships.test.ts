import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustMerchantMemberRechargeTransaction,
  cancelMerchantMemberRechargeTransaction,
  normalizeMerchantMembershipRecord,
  quoteMerchantMemberRechargeCancellation,
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
  assert.equal(result.membership.transactions.length, 2);
  assert.equal(result.transaction.status, "cancelled");
  assert.equal(result.transaction.cancellationNote, "客户充值金额录入错误");
  assert.equal(result.transaction.cancelledBy, "10000000");
  assert.ok(result.reversalTransaction);
  assert.equal(result.reversalTransaction.type, "redeem");
  assert.equal(result.reversalTransaction.pointDelta, -1000);
  assert.equal(result.reversalTransaction.balanceDelta, -100);
  assert.equal(result.reversalTransaction.growthDelta, -25);
  assert.equal(result.reversalTransaction.relatedTransactionId, "recharge-1");
  assert.equal(result.reversalTransaction.adjustmentKind, "recharge_reversal");

  const persisted = normalizeMerchantMembershipRecord(result.membership);
  assert.ok(persisted);
  const persistedRecharge = persisted.transactions.find((transaction) => transaction.id === "recharge-1");
  assert.equal(persistedRecharge?.status, "cancelled");
  assert.equal(persistedRecharge?.cancelledAt, "2026-07-16T08:00:00.000Z");
  assert.equal(persistedRecharge?.cancellationNote, "客户充值金额录入错误");
  assert.equal(persisted.transactions[0]?.adjustmentKind, "recharge_reversal");
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

test("a cancelled recharge remains idempotent when a retry uses a different operation id", () => {
  const first = cancelMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T08:00:00.000Z",
    cancellationOperationMarker: "[op:member-recharge-cancel:test-1]",
  });

  const retry = cancelMerchantMemberRechargeTransaction({
    membership: first.membership,
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T08:02:00.000Z",
    cancellationOperationMarker: "[op:member-recharge-cancel:test-2]",
  });

  assert.equal(retry.alreadyCancelled, true);
  assert.equal(retry.membership.pointBalance, 200);
  assert.equal(retry.membership.balanceAmount, 50);
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

test("recharge cancellation quote reports exact shortages and later usage", () => {
  const membership = buildMembership({ pointBalance: 900, balanceAmount: 90 });
  membership.transactions.unshift({
    ...membership.transactions[0]!,
    id: "redeem-1",
    type: "redeem",
    status: "completed",
    at: "2026-07-15T11:00:00.000Z",
    pointDelta: -300,
    balanceDelta: -20,
    growthDelta: 0,
    note: "积分兑换：示例项目",
    relatedTransactionId: "",
    adjustmentKind: "",
  });

  const quote = quoteMerchantMemberRechargeCancellation({ membership, transactionId: "recharge-1" });
  assert.equal(quote.canCancel, false);
  assert.equal(quote.pointShortage, 100);
  assert.equal(quote.balanceShortage, 10);
  assert.equal(quote.remainingPointAmount, 1000);
  assert.equal(quote.remainingBalanceAmount, 100);
  assert.deepEqual(quote.relatedUsage.map((item) => item.id), ["redeem-1"]);
});

test("manual recharge adjustment creates a linked negative ledger entry without negative balances", () => {
  const membership = buildMembership({ pointBalance: 300, balanceAmount: 40 });
  const result = adjustMerchantMemberRechargeTransaction({
    membership,
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:00:00.000Z",
    pointAmount: 300,
    balanceAmount: 40,
    adjustmentNote: "客户已经使用部分充值，先冲正当前可用部分",
    adjustedBy: "10000000",
    adjustmentOperationMarker: "[op:member-recharge-adjustment:test-1]",
    confirmationTransactionId: "recharge-1",
  });

  assert.equal(result.completed, false);
  assert.equal(result.membership.pointBalance, 0);
  assert.equal(result.membership.balanceAmount, 0);
  assert.equal(result.membership.growthValue, 80);
  assert.equal(result.transaction.status, "completed");
  assert.equal(result.adjustmentTransaction.pointDelta, -300);
  assert.equal(result.adjustmentTransaction.balanceDelta, -40);
  assert.equal(result.adjustmentTransaction.growthDelta, 0);
  assert.equal(result.adjustmentTransaction.relatedTransactionId, "recharge-1");

  const quote = quoteMerchantMemberRechargeCancellation({
    membership: result.membership,
    transactionId: "recharge-1",
  });
  assert.equal(quote.status, "adjusted");
  assert.equal(quote.adjustedPointAmount, 300);
  assert.equal(quote.adjustedBalanceAmount, 40);
  assert.equal(quote.remainingPointAmount, 700);
  assert.equal(quote.remainingBalanceAmount, 60);
  assert.equal(quote.pointShortage, 700);
  assert.equal(quote.balanceShortage, 60);
});

test("a final manual recharge adjustment cancels the original record and reverses growth", () => {
  const first = adjustMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:00:00.000Z",
    pointAmount: 400,
    balanceAmount: 25,
    adjustmentNote: "第一次冲正",
    adjustmentOperationMarker: "[op:member-recharge-adjustment:test-1]",
    confirmationTransactionId: "recharge-1",
  });
  const second = adjustMerchantMemberRechargeTransaction({
    membership: first.membership,
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T09:00:00.000Z",
    pointAmount: 600,
    balanceAmount: 75,
    adjustmentNote: "完成剩余冲正",
    adjustmentOperationMarker: "[op:member-recharge-adjustment:test-2]",
    confirmationTransactionId: "recharge-1",
  });

  assert.equal(second.completed, true);
  assert.equal(second.membership.pointBalance, 200);
  assert.equal(second.membership.balanceAmount, 50);
  assert.equal(second.membership.growthValue, 55);
  assert.equal(second.transaction.status, "cancelled");
  assert.equal(second.adjustmentTransaction.growthDelta, -25);
  const quote = quoteMerchantMemberRechargeCancellation({
    membership: second.membership,
    transactionId: "recharge-1",
  });
  assert.equal(quote.status, "cancelled");
  assert.equal(quote.alreadyCancelled, true);
  assert.equal(quote.remainingPointAmount, 0);
  assert.equal(quote.remainingBalanceAmount, 0);
});

test("manual recharge adjustment requires a reason and exact transaction confirmation", () => {
  const membership = buildMembership();
  assert.throws(
    () =>
      adjustMerchantMemberRechargeTransaction({
        membership,
        transactionId: "recharge-1",
        adjustedAt: "2026-07-16T08:00:00.000Z",
        pointAmount: 100,
        adjustmentNote: "原因",
        confirmationTransactionId: "wrong-id",
      }),
    /membership_recharge_adjustment_confirmation_mismatch/,
  );
  assert.throws(
    () =>
      adjustMerchantMemberRechargeTransaction({
        membership,
        transactionId: "recharge-1",
        adjustedAt: "2026-07-16T08:00:00.000Z",
        pointAmount: 100,
        adjustmentNote: "",
        confirmationTransactionId: "recharge-1",
      }),
    /membership_recharge_adjustment_note_required/,
  );
});

test("manual recharge adjustment replay is idempotent", () => {
  const first = adjustMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:00:00.000Z",
    pointAmount: 100,
    balanceAmount: 10,
    adjustmentNote: "人工冲正",
    adjustmentOperationMarker: "[op:member-recharge-adjustment:test-1]",
    confirmationTransactionId: "recharge-1",
  });
  const replay = adjustMerchantMemberRechargeTransaction({
    membership: first.membership,
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:01:00.000Z",
    pointAmount: 100,
    balanceAmount: 10,
    adjustmentNote: "人工冲正",
    adjustmentOperationMarker: "[op:member-recharge-adjustment:test-1]",
    confirmationTransactionId: "recharge-1",
  });
  assert.equal(replay.alreadyAdjusted, true);
  assert.equal(replay.membership.pointBalance, 1100);
  assert.equal(replay.membership.balanceAmount, 140);
  assert.equal(replay.membership.transactions.length, 2);
});

test("manual recharge adjustment keeps its idempotency marker when the reason is long", () => {
  const marker = "[op:member-recharge-adjustment:long-note-test]";
  const first = adjustMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:00:00.000Z",
    pointAmount: 100,
    balanceAmount: 10,
    adjustmentNote: "长".repeat(500),
    adjustmentOperationMarker: marker,
    confirmationTransactionId: "recharge-1",
  });
  assert.equal(first.adjustmentTransaction.note.includes(marker), true);

  const replay = adjustMerchantMemberRechargeTransaction({
    membership: first.membership,
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:01:00.000Z",
    pointAmount: 100,
    balanceAmount: 10,
    adjustmentNote: "长".repeat(500),
    adjustmentOperationMarker: marker,
    confirmationTransactionId: "recharge-1",
  });
  assert.equal(replay.alreadyAdjusted, true);
  assert.equal(replay.membership.transactions.length, 2);
});

test("full cancellation after a partial adjustment only recovers the remaining credit", () => {
  const partial = adjustMerchantMemberRechargeTransaction({
    membership: buildMembership(),
    transactionId: "recharge-1",
    adjustedAt: "2026-07-16T08:00:00.000Z",
    pointAmount: 250,
    balanceAmount: 30,
    adjustmentNote: "先冲正可用部分",
    adjustmentOperationMarker: "[op:member-recharge-adjustment:partial]",
    confirmationTransactionId: "recharge-1",
  });
  const cancelled = cancelMerchantMemberRechargeTransaction({
    membership: partial.membership,
    transactionId: "recharge-1",
    cancelledAt: "2026-07-16T09:00:00.000Z",
    cancellationOperationMarker: "[op:member-recharge-cancel:after-partial]",
  });

  assert.equal(cancelled.membership.pointBalance, 200);
  assert.equal(cancelled.membership.balanceAmount, 50);
  assert.equal(cancelled.membership.growthValue, 55);
  assert.ok(cancelled.reversalTransaction);
  assert.equal(cancelled.reversalTransaction.pointDelta, -750);
  assert.equal(cancelled.reversalTransaction.balanceDelta, -70);
  assert.equal(cancelled.membership.transactions.length, 3);
});

test("manual recharge adjustment rejects amounts above the outstanding or available balance", () => {
  assert.throws(
    () =>
      adjustMerchantMemberRechargeTransaction({
        membership: buildMembership(),
        transactionId: "recharge-1",
        adjustedAt: "2026-07-16T08:00:00.000Z",
        pointAmount: 1001,
        adjustmentNote: "超过剩余充值",
        confirmationTransactionId: "recharge-1",
      }),
    /membership_recharge_adjustment_exceeds_remaining/,
  );
  assert.throws(
    () =>
      adjustMerchantMemberRechargeTransaction({
        membership: buildMembership({ pointBalance: 10, balanceAmount: 5 }),
        transactionId: "recharge-1",
        adjustedAt: "2026-07-16T08:00:00.000Z",
        pointAmount: 11,
        adjustmentNote: "超过当前可用积分",
        confirmationTransactionId: "recharge-1",
      }),
    /membership_recharge_cancel_balance_insufficient/,
  );
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
