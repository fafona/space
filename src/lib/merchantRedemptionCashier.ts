type RedemptionCashierTransaction = {
  type?: unknown;
  adjustmentKind?: unknown;
};

type RedemptionCashierMembershipSource = {
  status?: unknown;
  transactions: RedemptionCashierTransaction[];
  insight?: unknown;
};

export function buildLeanRedemptionCashierMembership<T extends RedemptionCashierMembershipSource>(
  membership: T,
): T {
  return {
    ...membership,
    transactions: [],
    insight: undefined,
  };
}

export function buildRedemptionCashierMembershipList<T extends RedemptionCashierMembershipSource>(
  memberships: readonly T[],
  input: {
    mode: string;
    limit: number;
  },
): T[] {
  const recordTransactionType =
    input.mode === "rechargeRecords" ? "recharge" : input.mode === "records" ? "redeem" : "";
  if (recordTransactionType) {
    return memberships.filter((membership) =>
      membership.transactions.some(
        (transaction) => transaction.type === recordTransactionType && !transaction.adjustmentKind,
      ),
    );
  }

  return memberships
    .filter((membership) => membership.status === "active")
    .slice(0, input.limit)
    .map(buildLeanRedemptionCashierMembership);
}
