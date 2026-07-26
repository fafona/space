import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantMembershipLedgerMutations,
  normalizeMembershipLedgerCurrency,
} from "@/lib/merchantMembershipLedger";
import {
  normalizeMerchantMembershipRecords,
  type MerchantMemberAccountTransaction,
  type MerchantMembershipRecord,
} from "@/lib/merchantMemberships";

const SITE_ID = "10000000";
const MEMBERSHIP_ID = `${SITE_ID}:account-1`;
const JOINED_AT = "2026-07-25T08:00:00.000Z";

function transaction(
  input: Partial<MerchantMemberAccountTransaction> &
    Pick<MerchantMemberAccountTransaction, "id" | "at">,
): MerchantMemberAccountTransaction {
  return {
    id: input.id,
    type: input.type ?? "recharge",
    status: input.status ?? "completed",
    at: input.at,
    pointDelta: input.pointDelta ?? 0,
    balanceDelta: input.balanceDelta ?? 0,
    growthDelta: input.growthDelta ?? 0,
    note: input.note ?? "",
    operatorId: input.operatorId ?? "",
    cancelledAt: input.cancelledAt ?? null,
    cancellationNote: input.cancellationNote ?? "",
    cancelledBy: input.cancelledBy ?? "",
    cancellationOperationMarker: input.cancellationOperationMarker ?? "",
    relatedTransactionId: input.relatedTransactionId ?? "",
    adjustmentKind: input.adjustmentKind ?? "",
  };
}

function membership(
  input: Partial<MerchantMembershipRecord> = {},
): MerchantMembershipRecord {
  const result = normalizeMerchantMembershipRecords([
    {
      id: MEMBERSHIP_ID,
      siteId: SITE_ID,
      siteName: "Store",
      memberNo: "10000000000001",
      serial: 1,
      accountId: "account-1",
      userId: "user-1",
      email: "member@example.com",
      nickname: "Member",
      name: "Member Name",
      phone: "600000000",
      pointBalance: 0,
      balanceAmount: 0,
      growthValue: 0,
      transactions: [],
      status: "active",
      joinedAt: JOINED_AT,
      updatedAt: JOINED_AT,
      ...input,
    },
  ]);
  assert.equal(result.length, 1);
  return result[0]!;
}

test("builds one immutable entry per changed account and preserves minor units", () => {
  const previous = membership();
  const next = membership({
    pointBalance: 120,
    balanceAmount: 10.25,
    growthValue: 3.5,
    updatedAt: "2026-07-25T09:00:00.000Z",
    transactions: [
      transaction({
        id: "TX-1",
        at: "2026-07-25T09:00:00.000Z",
        pointDelta: 120,
        balanceDelta: 10.25,
        growthDelta: 3.5,
        note: "Recharge",
        operatorId: "operator-1",
      }),
    ],
  });

  const mutations = buildMerchantMembershipLedgerMutations({
    previousMemberships: [previous],
    nextMemberships: [next],
    currency: "eur",
  });

  assert.equal(mutations.length, 1);
  assert.deepEqual(
    mutations[0]!.entries.map((entry) => [
      entry.account_type,
      entry.delta,
      entry.balance_after,
      entry.currency,
    ]),
    [
      ["points", 120, 120, null],
      ["stored_value", 1025, 1025, "EUR"],
      ["growth", 350, 350, null],
    ],
  );
  assert.equal(mutations[0]!.customer.email, "member@example.com");
});

test("does not emit an existing legacy transaction twice", () => {
  const existing = transaction({
    id: "TX-1",
    at: "2026-07-25T09:00:00.000Z",
    pointDelta: 100,
  });
  const previous = membership({
    pointBalance: 100,
    transactions: [existing],
    updatedAt: "2026-07-25T09:00:00.000Z",
  });
  const next = membership({
    pointBalance: 100,
    transactions: [{ ...existing, status: "cancelled" }],
    updatedAt: "2026-07-25T10:00:00.000Z",
  });

  const mutations = buildMerchantMembershipLedgerMutations({
    previousMemberships: [previous],
    nextMemberships: [next],
  });

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]!.entries.length, 0);
});

test("links a recharge reversal to the original account entries without replaying the credit", () => {
  const original = transaction({
    id: "TX-ORIGINAL",
    at: "2026-07-25T09:00:00.000Z",
    pointDelta: 100,
    balanceDelta: 20,
  });
  const previous = membership({
    pointBalance: 100,
    balanceAmount: 20,
    transactions: [original],
    updatedAt: "2026-07-25T09:00:00.000Z",
  });
  const reversal = transaction({
    id: "TX-REVERSAL",
    type: "redeem",
    at: "2026-07-25T10:00:00.000Z",
    pointDelta: -100,
    balanceDelta: -20,
    adjustmentKind: "recharge_reversal",
    relatedTransactionId: original.id,
  });
  const next = membership({
    pointBalance: 0,
    balanceAmount: 0,
    transactions: [reversal, { ...original, status: "cancelled" }],
    updatedAt: "2026-07-25T10:00:00.000Z",
  });

  const [mutation] = buildMerchantMembershipLedgerMutations({
    previousMemberships: [previous],
    nextMemberships: [next],
  });

  assert.ok(mutation);
  assert.equal(mutation.entries.length, 2);
  assert.ok(
    mutation.entries.every(
      (entry) =>
        entry.entry_type === "recharge_reversal" &&
        entry.reverses_idempotency_key?.includes("TX-ORIGINAL"),
    ),
  );
  assert.deepEqual(
    mutation.entries.map((entry) => entry.balance_after),
    [0, 0],
  );
});

test("reconstructs a new membership opening point before applying its transactions", () => {
  const next = membership({
    pointBalance: 150,
    transactions: [
      transaction({
        id: "TX-NEW",
        at: "2026-07-25T10:00:00.000Z",
        pointDelta: 50,
      }),
    ],
    updatedAt: "2026-07-25T10:00:00.000Z",
  });

  const [mutation] = buildMerchantMembershipLedgerMutations({
    nextMemberships: [next],
  });

  assert.equal(mutation?.entries[0]?.entry_type, "opening_balance");
  assert.equal(mutation?.entries[0]?.delta, 100);
  assert.equal(mutation?.entries[0]?.balance_after, 100);
  assert.equal(mutation?.entries[1]?.reference_id, "TX-NEW");
  assert.equal(mutation?.entries[1]?.balance_after, 150);
});

test("adds an auditable reconciliation entry when a legacy balance changes without a transaction", () => {
  const previous = membership({
    growthValue: 25,
    updatedAt: "2026-07-25T09:00:00.000Z",
  });
  const next = membership({
    growthValue: 10,
    updatedAt: "2026-07-25T10:00:00.000Z",
  });

  const [mutation] = buildMerchantMembershipLedgerMutations({
    previousMemberships: [previous],
    nextMemberships: [next],
  });

  assert.equal(mutation?.entries.length, 1);
  assert.deepEqual(
    {
      accountType: mutation?.entries[0]?.account_type,
      entryType: mutation?.entries[0]?.entry_type,
      delta: mutation?.entries[0]?.delta,
      balanceAfter: mutation?.entries[0]?.balance_after,
    },
    {
      accountType: "growth",
      entryType: "legacy_reconciliation",
      delta: -1500,
      balanceAfter: 1000,
    },
  );
});

test("normalizes unsupported currency input to EUR", () => {
  assert.equal(normalizeMembershipLedgerCurrency("usd"), "USD");
  assert.equal(normalizeMembershipLedgerCurrency("EURO"), "EUR");
  assert.equal(normalizeMembershipLedgerCurrency(""), "EUR");
});
