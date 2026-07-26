import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantMembershipLedgerBackfillPlan,
  normalizeMerchantMembershipBackfillBatchSize,
} from "@/lib/merchantMembershipLedgerBackfill.server";
import {
  normalizeMerchantMembershipRecords,
  type MerchantMembershipRecord,
} from "@/lib/merchantMemberships";

function membership(
  id: string,
  input: Partial<MerchantMembershipRecord> = {},
) {
  return normalizeMerchantMembershipRecords([
    {
      id,
      siteId: "10000000",
      siteName: "Store",
      memberNo: id.replace(/\D/g, "").padEnd(14, "0"),
      serial: 1,
      accountId: id,
      userId: `${id}-user`,
      pointBalance: 10,
      balanceAmount: 0,
      growthValue: 0,
      transactions: [],
      status: "active",
      joinedAt: "2026-07-25T08:00:00.000Z",
      updatedAt: "2026-07-25T09:00:00.000Z",
      ...input,
    },
  ])[0]!;
}

test("normalizes membership backfill batch sizes", () => {
  assert.equal(normalizeMerchantMembershipBackfillBatchSize(undefined), 20);
  assert.equal(normalizeMerchantMembershipBackfillBatchSize(0), 1);
  assert.equal(normalizeMerchantMembershipBackfillBatchSize(1000), 100);
});

test("builds deterministic batches with opening balances", () => {
  const plan = buildMerchantMembershipLedgerBackfillPlan({
    merchantId: "10000000",
    memberships: [membership("member-2"), membership("member-1")],
    batchSize: 1,
    currency: "EUR",
  });

  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.membershipCount, 2);
  assert.equal(plan.entryCount, 2);
  assert.equal(plan.batches.length, 2);
  assert.equal(plan.batches[0]?.[0]?.entries[0]?.entry_type, "opening_balance");
});

test("reports merchant, member number, transaction id, and timestamp blockers", () => {
  const duplicateTransaction = {
    id: "TX-1",
    type: "recharge" as const,
    status: "completed" as const,
    at: "invalid",
    pointDelta: 1,
    balanceDelta: 0,
    growthDelta: 0,
    note: "",
    operatorId: "",
    cancelledAt: null,
    cancellationNote: "",
    cancelledBy: "",
    cancellationOperationMarker: "",
    relatedTransactionId: "",
    adjustmentKind: "" as const,
  };
  const first = membership("member-1", {
    memberNo: "same",
  });
  first.transactions = [duplicateTransaction, duplicateTransaction];
  const second = membership("member-2", {
    siteId: "10909094",
    memberNo: "same",
  });
  const plan = buildMerchantMembershipLedgerBackfillPlan({
    merchantId: "10000000",
    memberships: [first, second],
  });
  const codes = new Set(plan.blockers.map((blocker) => blocker.code));

  assert.equal(codes.has("merchant_mismatch"), true);
  assert.equal(codes.has("duplicate_member_no"), true);
  assert.equal(codes.has("duplicate_transaction_id"), true);
  assert.equal(codes.has("invalid_transaction_at"), true);
});
