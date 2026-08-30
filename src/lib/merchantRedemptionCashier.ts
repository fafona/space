type RedemptionCashierTransaction = {
  type?: unknown;
  adjustmentKind?: unknown;
};

type RedemptionCashierMembershipSource = {
  status?: unknown;
  transactions: RedemptionCashierTransaction[];
  insight?: unknown;
};

type RedemptionCashierSearchMembershipSource = RedemptionCashierMembershipSource & {
  id?: unknown;
  profileVisible?: unknown;
  memberNo?: unknown;
  nickname?: unknown;
  name?: unknown;
  accountId?: unknown;
  email?: unknown;
  phone?: unknown;
  joinedAt?: unknown;
  leftAt?: unknown;
  birthday?: unknown;
  gender?: unknown;
  country?: unknown;
  province?: unknown;
  city?: unknown;
  address?: unknown;
  taxName?: unknown;
  taxNumber?: unknown;
  taxCountry?: unknown;
  taxProvince?: unknown;
  taxCity?: unknown;
  taxAddress?: unknown;
};

function normalizeMembershipSearchValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

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

export function searchRedemptionCashierMemberships<
  T extends RedemptionCashierSearchMembershipSource,
>(
  memberships: readonly T[],
  input: {
    query: string;
    canViewCustomerData: boolean;
    limit: number;
  },
): T[] {
  const query = normalizeMembershipSearchValue(input.query);
  const limit = Math.max(0, Math.floor(input.limit));
  if (!query || !limit) return [];

  const eligibleMemberships = memberships.filter(
    (membership) => membership.status === "active" && membership.profileVisible === true,
  );

  if (!input.canViewCustomerData) {
    const membership = eligibleMemberships.find(
      (candidate) => normalizeMembershipSearchValue(candidate.memberNo) === query,
    );
    return membership ? [buildLeanRedemptionCashierMembership(membership)] : [];
  }

  return eligibleMemberships
    .filter((membership) =>
      [
        membership.id,
        membership.memberNo,
        membership.nickname,
        membership.name,
        membership.accountId,
        membership.email,
        membership.phone,
        membership.status,
        membership.joinedAt,
        membership.leftAt,
        membership.birthday,
        membership.gender,
        membership.country,
        membership.province,
        membership.city,
        membership.address,
        membership.taxName,
        membership.taxNumber,
        membership.taxCountry,
        membership.taxProvince,
        membership.taxCity,
        membership.taxAddress,
      ].some((value) => normalizeMembershipSearchValue(value).includes(query)),
    )
    .slice(0, limit)
    .map(buildLeanRedemptionCashierMembership);
}
