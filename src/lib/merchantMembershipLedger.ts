import type {
  MerchantMemberAccountTransaction,
  MerchantMembershipRecord,
} from "@/lib/merchantMemberships";

export const MERCHANT_MEMBERSHIP_LEDGER_ACCOUNT_TYPES = [
  "points",
  "stored_value",
  "growth",
] as const;

export type MerchantMembershipLedgerAccountType =
  (typeof MERCHANT_MEMBERSHIP_LEDGER_ACCOUNT_TYPES)[number];

export type MerchantMembershipLedgerCustomerMutation = {
  merchant_id: string;
  legacy_membership_id: string;
  member_no: string | null;
  account_id: string | null;
  auth_user_id: string | null;
  email: string | null;
  phone: string | null;
  display_name: string;
  status: "active" | "archived";
  profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MerchantMembershipLedgerEntryMutation = {
  account_type: MerchantMembershipLedgerAccountType;
  delta: number;
  balance_after: number | null;
  currency: string | null;
  entry_type:
    | "recharge"
    | "redeem"
    | "recharge_reversal"
    | "recharge_manual_adjustment"
    | "opening_balance"
    | "legacy_reconciliation";
  reference_type:
    | "legacy_membership_transaction"
    | "legacy_membership_checkpoint";
  reference_id: string;
  idempotency_key: string;
  reverses_idempotency_key: string | null;
  actor_id: string;
  note: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type MerchantMembershipLedgerMutation = {
  customer: MerchantMembershipLedgerCustomerMutation;
  entries: MerchantMembershipLedgerEntryMutation[];
};

const MONEY_SCALE = 100;
const GROWTH_SCALE = 100;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeMembershipLedgerCurrency(value: unknown) {
  const normalized = trimText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "EUR";
}

function toScaledInteger(value: unknown, scale: number) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue * scale);
}

function toNonNegativeBalance(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function getDisplayName(membership: MerchantMembershipRecord) {
  return (
    trimText(membership.name, 160) ||
    trimText(membership.nickname, 160) ||
    trimText(membership.memberNo, 120) ||
    "Member"
  );
}

export function buildMerchantMembershipLedgerCustomer(
  membership: MerchantMembershipRecord,
): MerchantMembershipLedgerCustomerMutation {
  return {
    merchant_id: membership.siteId,
    legacy_membership_id: membership.id,
    member_no: trimText(membership.memberNo, 120) || null,
    account_id: trimText(membership.accountId, 160) || null,
    auth_user_id: trimText(membership.userId, 160) || null,
    email: trimText(membership.email, 320).toLowerCase() || null,
    phone: trimText(membership.phone, 80) || null,
    display_name: getDisplayName(membership),
    status: membership.status === "active" ? "active" : "archived",
    profile: {
      siteName: membership.siteName,
      nickname: membership.nickname,
      name: membership.name,
      avatarUrl: membership.avatarUrl,
      birthday: membership.birthday,
      birthdayMonthDayOnly: membership.birthdayMonthDayOnly,
      gender: membership.gender,
      country: membership.country,
      province: membership.province,
      city: membership.city,
      address: membership.address,
      taxName: membership.taxName,
      taxNumber: membership.taxNumber,
      taxCountry: membership.taxCountry,
      taxProvince: membership.taxProvince,
      taxCity: membership.taxCity,
      taxAddress: membership.taxAddress,
      allergens: membership.allergens,
      serial: membership.serial,
      levelId: membership.levelId,
      joinedAt: membership.joinedAt,
      leftAt: membership.leftAt,
      legacyPointBalance: membership.pointBalance,
      legacyBalanceAmount: membership.balanceAmount,
      legacyGrowthValue: membership.growthValue,
      legacyTransactionCount: membership.transactions.length,
    },
    created_at: membership.joinedAt,
    updated_at: membership.updatedAt,
  };
}

function buildLedgerIdempotencyKey(input: {
  siteId: string;
  membershipId: string;
  transactionId: string;
  accountType: MerchantMembershipLedgerAccountType;
}) {
  return [
    "legacy-membership",
    input.siteId,
    input.membershipId,
    input.transactionId,
    input.accountType,
    "v1",
  ].join(":");
}

function buildCheckpointIdempotencyKey(input: {
  siteId: string;
  membershipId: string;
  checkpoint: "opening" | "reconciliation";
  checkpointId: string;
  accountType: MerchantMembershipLedgerAccountType;
  balanceAfter: number;
}) {
  return [
    "legacy-membership",
    input.siteId,
    input.membershipId,
    input.checkpoint,
    input.checkpointId,
    input.accountType,
    input.balanceAfter,
    "v1",
  ].join(":");
}

function getLedgerEntryType(
  transaction: MerchantMemberAccountTransaction,
): MerchantMembershipLedgerEntryMutation["entry_type"] {
  if (transaction.adjustmentKind === "recharge_reversal") return "recharge_reversal";
  if (transaction.adjustmentKind === "recharge_manual_adjustment") {
    return "recharge_manual_adjustment";
  }
  return transaction.type;
}

function buildLedgerEntry(input: {
  membership: MerchantMembershipRecord;
  transaction: MerchantMemberAccountTransaction;
  accountType: MerchantMembershipLedgerAccountType;
  delta: number;
  balanceAfter: number | null;
  currency: string;
}): MerchantMembershipLedgerEntryMutation {
  const { membership, transaction, accountType } = input;
  const idempotencyKey = buildLedgerIdempotencyKey({
    siteId: membership.siteId,
    membershipId: membership.id,
    transactionId: transaction.id,
    accountType,
  });
  const reversesIdempotencyKey = transaction.relatedTransactionId
    ? buildLedgerIdempotencyKey({
        siteId: membership.siteId,
        membershipId: membership.id,
        transactionId: transaction.relatedTransactionId,
        accountType,
      })
    : null;

  return {
    account_type: accountType,
    delta: input.delta,
    balance_after: input.balanceAfter,
    currency: accountType === "stored_value" ? input.currency : null,
    entry_type: getLedgerEntryType(transaction),
    reference_type: "legacy_membership_transaction",
    reference_id: transaction.id,
    idempotency_key: idempotencyKey,
    reverses_idempotency_key: reversesIdempotencyKey,
    actor_id: trimText(transaction.operatorId, 120) || "legacy-membership-bridge",
    note: trimText(transaction.note, 500),
    metadata: {
      legacyMembershipId: membership.id,
      legacyMemberNo: membership.memberNo,
      legacyTransactionId: transaction.id,
      legacyTransactionType: transaction.type,
      legacyTransactionStatus: transaction.status,
      adjustmentKind: transaction.adjustmentKind,
      relatedTransactionId: transaction.relatedTransactionId,
      cancelledAt: transaction.cancelledAt,
      cancelledBy: transaction.cancelledBy,
      cancellationNote: transaction.cancellationNote,
      cancellationOperationMarker: transaction.cancellationOperationMarker,
      unitScale: accountType === "points" ? 1 : 100,
    },
    created_at: transaction.at,
  };
}

function buildCheckpointEntry(input: {
  membership: MerchantMembershipRecord;
  accountType: MerchantMembershipLedgerAccountType;
  checkpoint: "opening" | "reconciliation";
  checkpointId: string;
  delta: number;
  balanceAfter: number;
  currency: string;
  createdAt: string;
}): MerchantMembershipLedgerEntryMutation {
  return {
    account_type: input.accountType,
    delta: input.delta,
    balance_after: input.balanceAfter,
    currency: input.accountType === "stored_value" ? input.currency : null,
    entry_type:
      input.checkpoint === "opening" ? "opening_balance" : "legacy_reconciliation",
    reference_type: "legacy_membership_checkpoint",
    reference_id: input.checkpointId,
    idempotency_key: buildCheckpointIdempotencyKey({
      siteId: input.membership.siteId,
      membershipId: input.membership.id,
      checkpoint: input.checkpoint,
      checkpointId: input.checkpointId,
      accountType: input.accountType,
      balanceAfter: input.balanceAfter,
    }),
    reverses_idempotency_key: null,
    actor_id: "legacy-membership-bridge",
    note:
      input.checkpoint === "opening"
        ? "Legacy membership opening balance"
        : "Legacy membership balance reconciliation",
    metadata: {
      legacyMembershipId: input.membership.id,
      legacyMemberNo: input.membership.memberNo,
      checkpoint: input.checkpoint,
      checkpointId: input.checkpointId,
      unitScale: input.accountType === "points" ? 1 : 100,
    },
    created_at: input.createdAt,
  };
}

function getNewTransactions(
  previous: MerchantMembershipRecord | undefined,
  next: MerchantMembershipRecord,
) {
  const previousIds = new Set(previous?.transactions.map((transaction) => transaction.id) ?? []);
  return next.transactions.filter((transaction) => !previousIds.has(transaction.id)).reverse();
}

function buildLedgerEntries(input: {
  previous?: MerchantMembershipRecord;
  next: MerchantMembershipRecord;
  currency: string;
}) {
  const newTransactions = getNewTransactions(input.previous, input.next);

  const totalNewPointDelta = newTransactions.reduce(
    (sum, transaction) => sum + Math.round(transaction.pointDelta),
    0,
  );
  const totalNewBalanceDelta = newTransactions.reduce(
    (sum, transaction) => sum + toScaledInteger(transaction.balanceDelta, MONEY_SCALE),
    0,
  );
  const totalNewGrowthDelta = newTransactions.reduce(
    (sum, transaction) => sum + toScaledInteger(transaction.growthDelta, GROWTH_SCALE),
    0,
  );

  const entries: MerchantMembershipLedgerEntryMutation[] = [];
  const targetBalances = {
    points: Math.round(input.next.pointBalance),
    stored_value: toScaledInteger(input.next.balanceAmount, MONEY_SCALE),
    growth: toScaledInteger(input.next.growthValue, GROWTH_SCALE),
  };
  const totalNewDeltas = {
    points: totalNewPointDelta,
    stored_value: totalNewBalanceDelta,
    growth: totalNewGrowthDelta,
  };
  const runningBalances = {
    points: input.previous ? Math.round(input.previous.pointBalance) : 0,
    stored_value: input.previous
      ? toScaledInteger(input.previous.balanceAmount, MONEY_SCALE)
      : 0,
    growth: input.previous
      ? toScaledInteger(input.previous.growthValue, GROWTH_SCALE)
      : 0,
  };

  if (!input.previous) {
    MERCHANT_MEMBERSHIP_LEDGER_ACCOUNT_TYPES.forEach((accountType) => {
      const openingDelta = targetBalances[accountType] - totalNewDeltas[accountType];
      if (openingDelta <= 0) return;
      runningBalances[accountType] += openingDelta;
      entries.push(
        buildCheckpointEntry({
          membership: input.next,
          accountType,
          checkpoint: "opening",
          checkpointId: input.next.joinedAt,
          delta: openingDelta,
          balanceAfter: runningBalances[accountType],
          currency: input.currency,
          createdAt: input.next.joinedAt,
        }),
      );
    });
  }

  newTransactions.forEach((transaction) => {
    const pointDelta = Math.round(transaction.pointDelta);
    const storedValueDelta = toScaledInteger(transaction.balanceDelta, MONEY_SCALE);
    const growthDelta = toScaledInteger(transaction.growthDelta, GROWTH_SCALE);

    runningBalances.points += pointDelta;
    runningBalances.stored_value += storedValueDelta;
    runningBalances.growth += growthDelta;

    if (pointDelta !== 0) {
      entries.push(
        buildLedgerEntry({
          membership: input.next,
          transaction,
          accountType: "points",
          delta: pointDelta,
          balanceAfter: toNonNegativeBalance(runningBalances.points),
          currency: input.currency,
        }),
      );
    }
    if (storedValueDelta !== 0) {
      entries.push(
        buildLedgerEntry({
          membership: input.next,
          transaction,
          accountType: "stored_value",
          delta: storedValueDelta,
          balanceAfter: toNonNegativeBalance(runningBalances.stored_value),
          currency: input.currency,
        }),
      );
    }
    if (growthDelta !== 0) {
      entries.push(
        buildLedgerEntry({
          membership: input.next,
          transaction,
          accountType: "growth",
          delta: growthDelta,
          balanceAfter: toNonNegativeBalance(runningBalances.growth),
          currency: input.currency,
        }),
      );
    }
  });

  MERCHANT_MEMBERSHIP_LEDGER_ACCOUNT_TYPES.forEach((accountType) => {
    const reconciliationDelta = targetBalances[accountType] - runningBalances[accountType];
    if (reconciliationDelta === 0) return;
    runningBalances[accountType] += reconciliationDelta;
    entries.push(
      buildCheckpointEntry({
        membership: input.next,
        accountType,
        checkpoint: "reconciliation",
        checkpointId: input.next.updatedAt,
        delta: reconciliationDelta,
        balanceAfter: targetBalances[accountType],
        currency: input.currency,
        createdAt: input.next.updatedAt,
      }),
    );
  });

  return entries;
}

function customerMutationChanged(
  previous: MerchantMembershipRecord | undefined,
  next: MerchantMembershipRecord,
) {
  if (!previous) return true;
  return JSON.stringify(buildMerchantMembershipLedgerCustomer(previous)) !==
    JSON.stringify(buildMerchantMembershipLedgerCustomer(next));
}

export function buildMerchantMembershipLedgerMutations(input: {
  previousMemberships?: readonly MerchantMembershipRecord[] | null;
  nextMemberships: readonly MerchantMembershipRecord[];
  currency?: string;
}) {
  const previousById = new Map(
    (input.previousMemberships ?? []).map((membership) => [membership.id, membership]),
  );
  const currency = normalizeMembershipLedgerCurrency(input.currency);

  return input.nextMemberships.flatMap<MerchantMembershipLedgerMutation>((next) => {
    if (!next.siteId || !next.id) return [];
    const previous = previousById.get(next.id);
    const entries = buildLedgerEntries({ previous, next, currency });
    if (entries.length === 0 && !customerMutationChanged(previous, next)) return [];
    return [
      {
        customer: buildMerchantMembershipLedgerCustomer(next),
        entries,
      },
    ];
  });
}
