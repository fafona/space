import assert from "node:assert/strict";
import test from "node:test";

import { buildMerchantMembershipLedgerMutations } from "@/lib/merchantMembershipLedger";
import { reconcileMerchantMembershipLedger } from "@/lib/merchantMembershipLedgerReconciliation";
import {
  normalizeMerchantMembershipRecords,
  type MerchantMembershipRecord,
} from "@/lib/merchantMemberships";

function membership(input: Partial<MerchantMembershipRecord> = {}) {
  return normalizeMerchantMembershipRecords([
    {
      id: "10000000:account-1",
      siteId: "10000000",
      siteName: "Store",
      memberNo: "10000000000001",
      serial: 1,
      accountId: "account-1",
      userId: "user-1",
      pointBalance: 20,
      balanceAmount: 5,
      growthValue: 1.5,
      transactions: [
        {
          id: "TX-1",
          type: "recharge",
          status: "completed",
          at: "2026-07-25T09:00:00.000Z",
          pointDelta: 20,
          balanceDelta: 5,
          growthDelta: 1.5,
          note: "",
          operatorId: "",
        },
      ],
      status: "active",
      joinedAt: "2026-07-25T08:00:00.000Z",
      updatedAt: "2026-07-25T09:00:00.000Z",
      ...input,
    },
  ])[0]!;
}

function buildRows(current: MerchantMembershipRecord) {
  const mutation = buildMerchantMembershipLedgerMutations({
    nextMemberships: [current],
    currency: "EUR",
  })[0]!;
  const customer = {
    id: "customer-1",
    merchant_id: "10000000",
    legacy_membership_id: current.id,
    member_no: current.memberNo,
    status: "active",
  };
  const ledger = mutation.entries.map((entry, index) => ({
    id: `entry-${index}`,
    merchant_id: "10000000",
    customer_id: "customer-1",
    ...entry,
  }));
  return { customer, ledger };
}

test("reports parity when customer, transaction entries, and balances match", () => {
  const current = membership();
  const rows = buildRows(current);
  const report = reconcileMerchantMembershipLedger({
    merchantId: "10000000",
    legacyMemberships: [current],
    customers: [rows.customer],
    ledgerEntries: rows.ledger,
    currency: "EUR",
  });

  assert.equal(report.isMatch, true);
  assert.equal(report.matchedCustomerCount, 1);
  assert.equal(report.balanceMismatches.length, 0);
});

test("detects missing transaction entries and account balance drift", () => {
  const current = membership();
  const rows = buildRows(current);
  const report = reconcileMerchantMembershipLedger({
    merchantId: "10000000",
    legacyMemberships: [current],
    customers: [rows.customer],
    ledgerEntries: rows.ledger.slice(1),
    currency: "EUR",
  });

  assert.equal(report.isMatch, false);
  assert.equal(report.missingTransactionEntryKeys.length, 1);
  assert.equal(report.balanceMismatches.some((item) => item.accountType === "points"), true);
});

test("ignores checkpoint key shape while still including checkpoints in balance totals", () => {
  const current = membership({ pointBalance: 30 });
  const rows = buildRows(current);
  const checkpoint = rows.ledger.find(
    (entry) => entry.reference_type === "legacy_membership_checkpoint",
  );
  assert.ok(checkpoint);
  checkpoint.idempotency_key = "older-valid-checkpoint-key";
  const report = reconcileMerchantMembershipLedger({
    merchantId: "10000000",
    legacyMemberships: [current],
    customers: [rows.customer],
    ledgerEntries: rows.ledger,
    currency: "EUR",
  });

  assert.equal(report.isMatch, true);
  assert.equal(report.unexpectedTransactionEntryKeys.length, 0);
});
