import {
  buildMerchantMembershipLedgerMutations,
  type MerchantMembershipLedgerMutation,
} from "@/lib/merchantMembershipLedger";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";

export const MERCHANT_MEMBERSHIP_BACKFILL_DEFAULT_BATCH_SIZE = 20;
export const MERCHANT_MEMBERSHIP_BACKFILL_MAX_BATCH_SIZE = 100;

export type MerchantMembershipLedgerBackfillBlocker = {
  code:
    | "merchant_mismatch"
    | "duplicate_membership_id"
    | "duplicate_member_no"
    | "duplicate_transaction_id"
    | "invalid_joined_at"
    | "invalid_updated_at"
    | "invalid_transaction_at"
    | "unsafe_transaction_delta";
  membershipId: string;
  transactionId?: string;
};

export type MerchantMembershipLedgerBackfillPlan = {
  merchantId: string;
  currency: string;
  batchSize: number;
  membershipCount: number;
  entryCount: number;
  batches: MerchantMembershipLedgerMutation[][];
  blockers: MerchantMembershipLedgerBackfillBlocker[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTimestamp(value: unknown) {
  const text = trimText(value);
  return Boolean(text) && Number.isFinite(Date.parse(text));
}

function isSafeScaledDelta(value: number, scale: number) {
  return Number.isFinite(value) && Number.isSafeInteger(Math.round(value * scale));
}

export function normalizeMerchantMembershipBackfillBatchSize(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return MERCHANT_MEMBERSHIP_BACKFILL_DEFAULT_BATCH_SIZE;
  return Math.min(
    MERCHANT_MEMBERSHIP_BACKFILL_MAX_BATCH_SIZE,
    Math.max(1, parsed),
  );
}

function compareMemberships(
  left: MerchantMembershipRecord,
  right: MerchantMembershipRecord,
) {
  const leftTime = Date.parse(left.joinedAt);
  const rightTime = Date.parse(right.joinedAt);
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

export function buildMerchantMembershipLedgerBackfillPlan(input: {
  merchantId: string;
  memberships: MerchantMembershipRecord[];
  batchSize?: unknown;
  currency?: string;
}): MerchantMembershipLedgerBackfillPlan {
  const merchantId = trimText(input.merchantId);
  const batchSize = normalizeMerchantMembershipBackfillBatchSize(input.batchSize);
  const memberships = [...(Array.isArray(input.memberships) ? input.memberships : [])].sort(
    compareMemberships,
  );
  const blockers: MerchantMembershipLedgerBackfillBlocker[] = [];
  const membershipIds = new Set<string>();
  const memberNumbers = new Map<string, string>();

  memberships.forEach((membership) => {
    const membershipId = trimText(membership.id);
    if (trimText(membership.siteId) !== merchantId) {
      blockers.push({ code: "merchant_mismatch", membershipId });
    }
    if (membershipIds.has(membershipId)) {
      blockers.push({ code: "duplicate_membership_id", membershipId });
    } else {
      membershipIds.add(membershipId);
    }

    const memberNo = trimText(membership.memberNo);
    const existingMembershipId = memberNo ? memberNumbers.get(memberNo) : "";
    if (memberNo && existingMembershipId && existingMembershipId !== membershipId) {
      blockers.push({ code: "duplicate_member_no", membershipId });
    } else if (memberNo) {
      memberNumbers.set(memberNo, membershipId);
    }

    if (!isValidTimestamp(membership.joinedAt)) {
      blockers.push({ code: "invalid_joined_at", membershipId });
    }
    if (!isValidTimestamp(membership.updatedAt)) {
      blockers.push({ code: "invalid_updated_at", membershipId });
    }

    const transactionIds = new Set<string>();
    membership.transactions.forEach((transaction) => {
      if (transactionIds.has(transaction.id)) {
        blockers.push({
          code: "duplicate_transaction_id",
          membershipId,
          transactionId: transaction.id,
        });
      } else {
        transactionIds.add(transaction.id);
      }
      if (!isValidTimestamp(transaction.at)) {
        blockers.push({
          code: "invalid_transaction_at",
          membershipId,
          transactionId: transaction.id,
        });
      }
      if (
        !isSafeScaledDelta(transaction.pointDelta, 1) ||
        !isSafeScaledDelta(transaction.balanceDelta, 100) ||
        !isSafeScaledDelta(transaction.growthDelta, 100)
      ) {
        blockers.push({
          code: "unsafe_transaction_delta",
          membershipId,
          transactionId: transaction.id,
        });
      }
    });
  });

  const mutations = buildMerchantMembershipLedgerMutations({
    nextMemberships: memberships,
    currency: input.currency,
  });
  const batches: MerchantMembershipLedgerMutation[][] = [];
  for (let index = 0; index < mutations.length; index += batchSize) {
    batches.push(mutations.slice(index, index + batchSize));
  }

  return {
    merchantId,
    currency:
      mutations[0]?.entries.find((entry) => entry.account_type === "stored_value")
        ?.currency ?? "EUR",
    batchSize,
    membershipCount: memberships.length,
    entryCount: mutations.reduce((sum, mutation) => sum + mutation.entries.length, 0),
    batches,
    blockers,
  };
}
