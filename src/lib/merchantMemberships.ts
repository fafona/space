import type { MerchantCouponDiscountType } from "@/lib/merchantCoupons";
import { appendMutationOperationMarker } from "@/lib/mutationOperationId";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";

export type MerchantMembershipStatus = "active" | "left";

export const MERCHANT_MEMBER_LEGAL_ALLERGENS = [
  "含麸质谷物",
  "甲壳类",
  "蛋类",
  "鱼类",
  "花生",
  "大豆",
  "乳制品",
  "坚果",
  "芹菜",
  "芥末",
  "芝麻",
  "二氧化硫和亚硫酸盐",
  "羽扇豆",
  "软体动物",
] as const;

export type MerchantMemberLegalAllergen = (typeof MERCHANT_MEMBER_LEGAL_ALLERGENS)[number];
export type MerchantMemberAccountTransactionType = "redeem" | "recharge";
export type MerchantMemberAccountTransactionStatus = "completed" | "cancelled";
export type MerchantMemberAccountAdjustmentKind = "" | "recharge_reversal" | "recharge_manual_adjustment";

export type MerchantMemberAccountTransaction = {
  id: string;
  type: MerchantMemberAccountTransactionType;
  status: MerchantMemberAccountTransactionStatus;
  at: string;
  pointDelta: number;
  balanceDelta: number;
  growthDelta: number;
  note: string;
  operatorId: string;
  cancelledAt: string | null;
  cancellationNote: string;
  cancelledBy: string;
  cancellationOperationMarker: string;
  relatedTransactionId: string;
  adjustmentKind: MerchantMemberAccountAdjustmentKind;
};

export type MerchantRechargeCancellationRelatedUsage = {
  id: string;
  at: string;
  pointAmount: number;
  balanceAmount: number;
  note: string;
};

export type MerchantRechargeCancellationQuote = {
  transactionId: string;
  status: "completed" | "adjusted" | "cancelled";
  originalPointAmount: number;
  originalBalanceAmount: number;
  adjustedPointAmount: number;
  adjustedBalanceAmount: number;
  remainingPointAmount: number;
  remainingBalanceAmount: number;
  currentPointBalance: number;
  currentBalanceAmount: number;
  pointShortage: number;
  balanceShortage: number;
  canCancel: boolean;
  alreadyCancelled: boolean;
  relatedUsage: MerchantRechargeCancellationRelatedUsage[];
};

export type MerchantMemberCouponSummary = {
  couponId: string;
  title: string;
  discountLabel: string;
  count: number;
};

export type MerchantMemberCouponHistoryItem = {
  id: string;
  couponId: string;
  couponCode: string;
  title: string;
  discountLabel: string;
  discountType: MerchantCouponDiscountType;
  discountValue: number;
  pointsVoucherMaxPerRedemption: number;
  pointsVoucherMinimumRedeemPoints: number;
  productName: string;
  productBarcode: string;
  productQuantity: number;
  productAmount: number;
  exchangeItem: string;
  exchangeQuantity: number;
  ticketVenue: string;
  ticketDurationMinutes: number;
  claimedAt: string;
  validUntil: string | null;
  redeemedAt: string | null;
  settlementType: "qr" | "barcode";
  settlementCode: string;
  status: "available" | "used" | "expired" | "inactive";
};

export type MerchantMembershipInsight = {
  pointBalance: number;
  balanceAmount: number;
  availableCouponCount: number;
  availableCoupons: MerchantMemberCouponSummary[];
  couponHistory: MerchantMemberCouponHistoryItem[];
  totalSpendAmount: number;
  totalOrderCount: number;
  consumptionFrequencyPerMonth: number;
  averageOrderAmount: number;
  recentPurchaseAt: string | null;
  firstPurchaseAt: string | null;
  yearlySpendAmount: number;
  productPreferences: string[];
};

export type MerchantMembershipProfileDraft = {
  nickname: string;
  name: string;
  phone: string;
  email: string;
  avatarUrl: string;
  birthday: string;
  birthdayMonthDayOnly: boolean;
  gender: string;
  country: string;
  province: string;
  city: string;
  address: string;
  taxName: string;
  taxNumber: string;
  taxCountry: string;
  taxProvince: string;
  taxCity: string;
  taxAddress: string;
  allergens: string[];
};

export type MerchantMembershipRecord = {
  id: string;
  siteId: string;
  siteName: string;
  memberNo: string;
  serial: number;
  accountId: string;
  userId: string;
  email: string;
  nickname: string;
  name: string;
  phone: string;
  avatarUrl: string;
  birthday: string;
  birthdayMonthDayOnly: boolean;
  gender: string;
  country: string;
  province: string;
  city: string;
  address: string;
  taxName: string;
  taxNumber: string;
  taxCountry: string;
  taxProvince: string;
  taxCity: string;
  taxAddress: string;
  allergens: string[];
  pointBalance: number;
  balanceAmount: number;
  growthValue: number;
  levelId: string;
  transactions: MerchantMemberAccountTransaction[];
  status: MerchantMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  updatedAt: string;
};

export type PersonalMembershipCard = {
  id: string;
  siteId: string;
  siteName: string;
  memberNo: string;
  qrValue: string;
  status: MerchantMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
};

export type MerchantMembershipListItem = MerchantMembershipRecord & {
  profileVisible: boolean;
  insight?: MerchantMembershipInsight;
};

const MAX_PERSONAL_MEMBERSHIPS = 500;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeIsoDateValue(value: unknown, fallback = "") {
  const raw = trimText(value);
  if (!raw) return fallback;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.floor(numberValue);
}

function normalizeIntegerValue(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.round(numberValue);
}

function normalizeMoneyValue(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue)) return fallback;
  return Number(numberValue.toFixed(2));
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimText(item, 120)).filter(Boolean);
}

export function normalizeMerchantMemberAllergens(value: unknown) {
  const allowed = new Set<string>(MERCHANT_MEMBER_LEGAL_ALLERGENS);
  return Array.from(new Set(normalizeStringArray(value).filter((item) => allowed.has(item))));
}

export function normalizeMerchantMemberAccountTransactions(value: unknown): MerchantMemberAccountTransaction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      const at = normalizeIsoDateValue(record.at);
      if (!at) return null;
      const type: MerchantMemberAccountTransactionType = record.type === "recharge" ? "recharge" : "redeem";
      const status: MerchantMemberAccountTransactionStatus = record.status === "cancelled" ? "cancelled" : "completed";
      const adjustmentKind: MerchantMemberAccountAdjustmentKind =
        record.adjustmentKind === "recharge_reversal"
          ? "recharge_reversal"
          : record.adjustmentKind === "recharge_manual_adjustment"
            ? "recharge_manual_adjustment"
            : "";
      return {
        id: trimText(record.id, 120) || `MT${Date.parse(at).toString(36).toUpperCase()}`,
        type,
        status,
        at,
        pointDelta: normalizeIntegerValue(record.pointDelta),
        balanceDelta: normalizeMoneyValue(record.balanceDelta),
        growthDelta: normalizeMoneyValue(record.growthDelta),
        note: trimText(record.note, 500),
        operatorId: trimText(record.operatorId, 120),
        cancelledAt: status === "cancelled" ? normalizeIsoDateValue(record.cancelledAt) || null : null,
        cancellationNote: status === "cancelled" ? trimText(record.cancellationNote, 500) : "",
        cancelledBy: status === "cancelled" ? trimText(record.cancelledBy, 120) : "",
        cancellationOperationMarker:
          status === "cancelled" ? trimText(record.cancellationOperationMarker, 240) : "",
        relatedTransactionId: adjustmentKind ? trimText(record.relatedTransactionId, 120) : "",
        adjustmentKind,
      };
    })
    .filter((item): item is MerchantMemberAccountTransaction => Boolean(item))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

export function calculateExpiredMerchantMemberPoints(input: {
  transactions: readonly MerchantMemberAccountTransaction[];
  pointBalance: unknown;
  cutoffTimestamp: unknown;
}) {
  const pointBalance = normalizeNonNegativeInteger(input.pointBalance);
  const cutoffTimestamp = Number(input.cutoffTimestamp);
  if (pointBalance <= 0 || !Number.isFinite(cutoffTimestamp)) return 0;

  const lots: Array<{ transactionId: string; at: number; remaining: number }> = [];
  const adjustedTransactionIds = new Set(
    input.transactions
      .filter((transaction) => transaction.pointDelta < 0 && transaction.relatedTransactionId)
      .map((transaction) => transaction.relatedTransactionId),
  );
  [...input.transactions]
    .map((transaction, index) => ({ transaction, index, at: Date.parse(transaction.at) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.transaction.pointDelta !== 0)
    .sort((left, right) => left.at - right.at || left.index - right.index)
    .forEach(({ transaction, at }) => {
      if (transaction.pointDelta > 0) {
        if (transaction.status === "cancelled" && !adjustedTransactionIds.has(transaction.id)) return;
        lots.push({ transactionId: transaction.id, at, remaining: transaction.pointDelta });
        return;
      }

      let amountToConsume = Math.abs(transaction.pointDelta);
      if (transaction.relatedTransactionId) {
        const relatedLot = lots.find(
          (lot) => lot.transactionId === transaction.relatedTransactionId && lot.remaining > 0,
        );
        if (relatedLot) {
          const relatedAmount = Math.min(relatedLot.remaining, amountToConsume);
          relatedLot.remaining -= relatedAmount;
          amountToConsume -= relatedAmount;
        }
      }
      for (const lot of lots) {
        if (amountToConsume <= 0) break;
        if (lot.remaining <= 0) continue;
        const consumed = Math.min(lot.remaining, amountToConsume);
        lot.remaining -= consumed;
        amountToConsume -= consumed;
      }
    });

  const expiredPoints = lots
    .filter((lot) => lot.at < cutoffTimestamp)
    .reduce((sum, lot) => sum + lot.remaining, 0);
  return Math.min(pointBalance, Math.max(0, Math.round(expiredPoints)));
}

function isRechargeAdjustmentForTransaction(
  transaction: MerchantMemberAccountTransaction,
  transactionId: string,
) {
  return (
    transaction.status === "completed" &&
    transaction.type === "redeem" &&
    Boolean(transaction.adjustmentKind) &&
    transaction.relatedTransactionId === transactionId
  );
}

function normalizeNonNegativeInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.max(0, Math.round(numberValue));
}

function normalizeNonNegativeMoney(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Number(Math.max(0, numberValue).toFixed(2));
}

function buildRechargeAdjustmentTransaction(input: {
  id?: unknown;
  kind: Exclude<MerchantMemberAccountAdjustmentKind, "">;
  relatedTransactionId: string;
  at: string;
  pointAmount: number;
  balanceAmount: number;
  growthAmount: number;
  note: string;
  operatorId?: unknown;
  operationMarker?: unknown;
}) {
  const operationMarker = trimText(input.operationMarker, 240);
  const note = appendMutationOperationMarker(input.note, operationMarker);
  return {
    id:
      trimText(input.id, 120) ||
      `MT${Date.parse(input.at).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    type: "redeem" as const,
    status: "completed" as const,
    at: input.at,
    pointDelta: -input.pointAmount,
    balanceDelta: normalizeMoneyValue(-input.balanceAmount),
    growthDelta: normalizeMoneyValue(-input.growthAmount),
    note,
    operatorId: trimText(input.operatorId, 120),
    cancelledAt: null,
    cancellationNote: "",
    cancelledBy: "",
    cancellationOperationMarker: "",
    relatedTransactionId: input.relatedTransactionId,
    adjustmentKind: input.kind,
  } satisfies MerchantMemberAccountTransaction;
}

function prependTransaction(
  transactions: MerchantMemberAccountTransaction[],
  nextTransaction: MerchantMemberAccountTransaction,
) {
  const withoutNext = transactions.filter((transaction) => transaction.id !== nextTransaction.id);
  return [nextTransaction, ...withoutNext];
}

export function quoteMerchantMemberRechargeCancellation(input: {
  membership: MerchantMembershipRecord;
  transactionId: unknown;
  allowGrowthOnly?: boolean;
}): MerchantRechargeCancellationQuote {
  const transactionId = trimText(input.transactionId, 120);
  const transaction = input.membership.transactions.find((item) => item.id === transactionId);
  if (!transaction) throw new Error("membership_recharge_not_found");
  if (transaction.type !== "recharge") throw new Error("membership_recharge_not_cancellable");

  const originalPointAmount = Math.max(0, transaction.pointDelta);
  const originalBalanceAmount = normalizeNonNegativeMoney(transaction.balanceDelta);
  const originalGrowthAmount = Math.max(0, transaction.growthDelta);
  if (
    transaction.pointDelta < 0 ||
    transaction.balanceDelta < 0 ||
    (originalPointAmount <= 0 && originalBalanceAmount <= 0 && !(input.allowGrowthOnly && originalGrowthAmount > 0))
  ) {
    throw new Error("membership_recharge_not_cancellable");
  }

  const adjustments = input.membership.transactions.filter((item) =>
    isRechargeAdjustmentForTransaction(item, transactionId),
  );
  const adjustedPointAmount = Math.min(
    originalPointAmount,
    adjustments.reduce((sum, item) => sum + Math.abs(Math.min(0, item.pointDelta)), 0),
  );
  const adjustedBalanceAmount = Math.min(
    originalBalanceAmount,
    normalizeNonNegativeMoney(
      adjustments.reduce((sum, item) => sum + Math.abs(Math.min(0, item.balanceDelta)), 0),
    ),
  );
  const remainingPointAmount = Math.max(0, originalPointAmount - adjustedPointAmount);
  const remainingBalanceAmount = normalizeNonNegativeMoney(originalBalanceAmount - adjustedBalanceAmount);
  const currentPointBalance = Math.max(0, input.membership.pointBalance);
  const currentBalanceAmount = normalizeNonNegativeMoney(input.membership.balanceAmount);
  const pointShortage = Math.max(0, remainingPointAmount - currentPointBalance);
  const balanceShortage = normalizeNonNegativeMoney(remainingBalanceAmount - currentBalanceAmount);
  const alreadyCancelled = transaction.status === "cancelled";
  const hasAdjustments = adjustedPointAmount > 0 || adjustedBalanceAmount > 0;
  const relatedUsage = input.membership.transactions
    .filter((item) => {
      return (
        item.status === "completed" &&
        item.type === "redeem" &&
        !item.adjustmentKind &&
        Date.parse(item.at) >= Date.parse(transaction.at) &&
        (item.pointDelta < 0 || item.balanceDelta < 0)
      );
    })
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      at: item.at,
      pointAmount: Math.abs(Math.min(0, item.pointDelta)),
      balanceAmount: Math.abs(Math.min(0, item.balanceDelta)),
      note: item.note,
    }));

  return {
    transactionId,
    status: alreadyCancelled ? "cancelled" : hasAdjustments ? "adjusted" : "completed",
    originalPointAmount,
    originalBalanceAmount,
    adjustedPointAmount,
    adjustedBalanceAmount,
    remainingPointAmount: alreadyCancelled ? 0 : remainingPointAmount,
    remainingBalanceAmount: alreadyCancelled ? 0 : remainingBalanceAmount,
    currentPointBalance,
    currentBalanceAmount,
    pointShortage: alreadyCancelled ? 0 : pointShortage,
    balanceShortage: alreadyCancelled ? 0 : balanceShortage,
    canCancel: !alreadyCancelled && pointShortage <= 0 && balanceShortage <= 0,
    alreadyCancelled,
    relatedUsage,
  };
}

export function cancelMerchantMemberRechargeTransaction(input: {
  membership: MerchantMembershipRecord;
  transactionId: unknown;
  cancelledAt: unknown;
  cancellationNote?: unknown;
  cancelledBy?: unknown;
  cancellationOperationMarker?: unknown;
  reversalTransactionId?: unknown;
  allowGrowthOnly?: boolean;
}) {
  const transactionId = trimText(input.transactionId, 120);
  const transaction = input.membership.transactions.find((item) => item.id === transactionId);
  if (!transaction) throw new Error("membership_recharge_not_found");
  if (transaction.type !== "recharge") throw new Error("membership_recharge_not_cancellable");

  const cancellationOperationMarker = trimText(input.cancellationOperationMarker, 240);
  if (transaction.status === "cancelled") {
    return { membership: input.membership, transaction, alreadyCancelled: true };
  }

  const quote = quoteMerchantMemberRechargeCancellation({
    membership: input.membership,
    transactionId,
    allowGrowthOnly: input.allowGrowthOnly,
  });
  if (!quote.canCancel) {
    throw new Error("membership_recharge_cancel_balance_insufficient");
  }

  const nextPointBalance = input.membership.pointBalance - quote.remainingPointAmount;
  const nextBalanceAmount = normalizeMoneyValue(input.membership.balanceAmount - quote.remainingBalanceAmount);

  const cancelledAt = normalizeIsoDateValue(input.cancelledAt);
  if (!cancelledAt) throw new Error("membership_recharge_cancel_invalid_time");
  const cancelledTransaction: MerchantMemberAccountTransaction = {
    ...transaction,
    status: "cancelled",
    cancelledAt,
    cancellationNote: trimText(input.cancellationNote, 500),
    cancelledBy: trimText(input.cancelledBy, 120),
    cancellationOperationMarker,
  };
  const reversalTransaction = buildRechargeAdjustmentTransaction({
    id: input.reversalTransactionId,
    kind: "recharge_reversal",
    relatedTransactionId: transaction.id,
    at: cancelledAt,
    pointAmount: quote.remainingPointAmount,
    balanceAmount: quote.remainingBalanceAmount,
    growthAmount: Math.max(0, transaction.growthDelta),
    note: `充值撤销：${transaction.id}${trimText(input.cancellationNote, 500) ? `；${trimText(input.cancellationNote, 500)}` : ""}`,
    operatorId: input.cancelledBy,
    operationMarker: cancellationOperationMarker,
  });
  const updatedTransactions = input.membership.transactions.map((item) =>
    item.id === transaction.id ? cancelledTransaction : item,
  );
  const membership: MerchantMembershipRecord = {
    ...input.membership,
    pointBalance: nextPointBalance,
    balanceAmount: nextBalanceAmount,
    growthValue: normalizeMoneyValue(
      Math.max(0, input.membership.growthValue - Math.max(0, transaction.growthDelta)),
    ),
    transactions: prependTransaction(updatedTransactions, reversalTransaction),
    updatedAt: cancelledAt,
  };
  return { membership, transaction: cancelledTransaction, reversalTransaction, alreadyCancelled: false };
}

export function adjustMerchantMemberRechargeTransaction(input: {
  membership: MerchantMembershipRecord;
  transactionId: unknown;
  adjustedAt: unknown;
  pointAmount?: unknown;
  balanceAmount?: unknown;
  adjustmentNote?: unknown;
  adjustedBy?: unknown;
  adjustmentOperationMarker?: unknown;
  adjustmentTransactionId?: unknown;
  confirmationTransactionId?: unknown;
}) {
  const transactionId = trimText(input.transactionId, 120);
  const transaction = input.membership.transactions.find((item) => item.id === transactionId);
  if (!transaction) throw new Error("membership_recharge_not_found");
  if (transaction.type !== "recharge") throw new Error("membership_recharge_not_cancellable");

  const operationMarker = trimText(input.adjustmentOperationMarker, 240);
  const existingAdjustment = operationMarker
    ? input.membership.transactions.find(
        (item) => isRechargeAdjustmentForTransaction(item, transactionId) && item.note.includes(operationMarker),
      )
    : null;
  if (existingAdjustment) {
    return {
      membership: input.membership,
      transaction,
      adjustmentTransaction: existingAdjustment,
      completed: transaction.status === "cancelled",
      alreadyAdjusted: true,
    };
  }
  if (transaction.status === "cancelled") throw new Error("membership_recharge_already_cancelled");
  if (trimText(input.confirmationTransactionId, 120) !== transactionId) {
    throw new Error("membership_recharge_adjustment_confirmation_mismatch");
  }
  const adjustmentNote = trimText(input.adjustmentNote, 500);
  if (adjustmentNote.length < 2) throw new Error("membership_recharge_adjustment_note_required");

  const quote = quoteMerchantMemberRechargeCancellation({ membership: input.membership, transactionId });
  const pointAmount = normalizeNonNegativeInteger(input.pointAmount);
  const balanceAmount = normalizeNonNegativeMoney(input.balanceAmount);
  if (pointAmount <= 0 && balanceAmount <= 0) throw new Error("membership_recharge_adjustment_empty");
  if (pointAmount > quote.remainingPointAmount || balanceAmount > quote.remainingBalanceAmount) {
    throw new Error("membership_recharge_adjustment_exceeds_remaining");
  }
  if (pointAmount > quote.currentPointBalance || balanceAmount > quote.currentBalanceAmount) {
    throw new Error("membership_recharge_cancel_balance_insufficient");
  }

  const adjustedAt = normalizeIsoDateValue(input.adjustedAt);
  if (!adjustedAt) throw new Error("membership_recharge_cancel_invalid_time");
  const completed =
    pointAmount === quote.remainingPointAmount &&
    Math.abs(balanceAmount - quote.remainingBalanceAmount) < 0.005;
  const nextPointBalance = input.membership.pointBalance - pointAmount;
  const nextBalanceAmount = normalizeMoneyValue(input.membership.balanceAmount - balanceAmount);
  const adjustedTransaction: MerchantMemberAccountTransaction = completed
    ? {
        ...transaction,
        status: "cancelled",
        cancelledAt: adjustedAt,
        cancellationNote: adjustmentNote,
        cancelledBy: trimText(input.adjustedBy, 120),
        cancellationOperationMarker: operationMarker,
      }
    : transaction;
  const adjustmentTransaction = buildRechargeAdjustmentTransaction({
    id: input.adjustmentTransactionId,
    kind: "recharge_manual_adjustment",
    relatedTransactionId: transaction.id,
    at: adjustedAt,
    pointAmount,
    balanceAmount,
    growthAmount: completed ? Math.max(0, transaction.growthDelta) : 0,
    note: `充值人工冲正：${transaction.id}；${adjustmentNote}`,
    operatorId: input.adjustedBy,
    operationMarker,
  });
  const updatedTransactions = input.membership.transactions.map((item) =>
    item.id === transaction.id ? adjustedTransaction : item,
  );
  const membership: MerchantMembershipRecord = {
    ...input.membership,
    pointBalance: nextPointBalance,
    balanceAmount: nextBalanceAmount,
    growthValue: completed
      ? normalizeMoneyValue(Math.max(0, input.membership.growthValue - Math.max(0, transaction.growthDelta)))
      : input.membership.growthValue,
    transactions: prependTransaction(updatedTransactions, adjustmentTransaction),
    updatedAt: adjustedAt,
  };
  return {
    membership,
    transaction: adjustedTransaction,
    adjustmentTransaction,
    completed,
    alreadyAdjusted: false,
  };
}

export function buildMerchantMemberNo(siteId: string, serial: number) {
  const normalizedSiteId = trimText(siteId);
  const normalizedSerial = Math.max(1, Math.floor(Number(serial) || 1));
  return `${normalizedSiteId}${String(normalizedSerial).padStart(6, "0")}`;
}

export function buildMerchantMembershipQrValue(siteId: string, memberNo: string) {
  const normalizedSiteId = trimText(siteId, 64);
  const normalizedMemberNo = trimText(memberNo, 80);
  return `FAOLLA_MEMBER:${normalizedSiteId}:${normalizedMemberNo}`;
}

export function normalizeMerchantMembershipStatus(value: unknown): MerchantMembershipStatus {
  return value === "left" ? "left" : "active";
}

export function normalizeMerchantMembershipProfileDraft(
  value: unknown,
  fallback: Partial<MerchantMembershipProfileDraft> = {},
): MerchantMembershipProfileDraft {
  const record = readRecord(value) ?? {};
  return {
    nickname:
      trimText(record.nickname, 120) ||
      trimText(record.displayName, 120) ||
      trimText(record.display_name, 120) ||
      trimText(fallback.nickname, 120) ||
      trimText(fallback.name, 120),
    name: trimText(record.name, 120) || trimText(record.displayName, 120) || trimText(fallback.name, 120),
    phone: trimText(record.phone, 80) || trimText(fallback.phone, 80),
    email: (trimText(record.email, 320) || trimText(fallback.email, 320)).toLowerCase(),
    avatarUrl: trimText(record.avatarUrl, 1200) || trimText(record.avatar_url, 1200) || trimText(fallback.avatarUrl, 1200),
    birthday: trimText(record.birthday, 32) || trimText(fallback.birthday, 32),
    birthdayMonthDayOnly: normalizeBoolean(record.birthdayMonthDayOnly ?? record.birthday_month_day_only, fallback.birthdayMonthDayOnly === true),
    gender: trimText(record.gender, 32) || trimText(fallback.gender, 32),
    country: trimText(record.country, 80) || trimText(fallback.country, 80),
    province: trimText(record.province, 80) || trimText(fallback.province, 80),
    city: trimText(record.city, 80) || trimText(fallback.city, 80),
    address: trimText(record.address, 240) || trimText(fallback.address, 240),
    taxName: trimText(record.taxName, 160) || trimText(record.tax_name, 160) || trimText(fallback.taxName, 160),
    taxNumber: trimText(record.taxNumber, 120) || trimText(record.tax_number, 120) || trimText(fallback.taxNumber, 120),
    taxCountry: trimText(record.taxCountry, 80) || trimText(record.tax_country, 80) || trimText(fallback.taxCountry, 80),
    taxProvince: trimText(record.taxProvince, 80) || trimText(record.tax_province, 80) || trimText(fallback.taxProvince, 80),
    taxCity: trimText(record.taxCity, 80) || trimText(record.tax_city, 80) || trimText(fallback.taxCity, 80),
    taxAddress: trimText(record.taxAddress, 240) || trimText(record.tax_address, 240) || trimText(fallback.taxAddress, 240),
    allergens: normalizeMerchantMemberAllergens(record.allergens ?? fallback.allergens),
  };
}

function isValidMembershipBirthday(value: string, monthDayOnly: boolean) {
  const match = value.match(monthDayOnly ? /^(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = monthDayOnly ? 2000 : Number(match[1]);
  const month = Number(match[monthDayOnly ? 1 : 2]);
  const day = Number(match[monthDayOnly ? 2 : 3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function getMerchantMembershipProfileValidationError(profile: MerchantMembershipProfileDraft) {
  if (!profile.nickname) return "请填写昵称";
  if (!profile.phone) return "请填写手机";
  if (!profile.email) return "请填写邮箱";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return "邮箱格式不正确";
  if (!profile.birthday) return profile.birthdayMonthDayOnly ? "请填写生日月日" : "请填写生日";
  if (!isValidMembershipBirthday(profile.birthday, profile.birthdayMonthDayOnly)) {
    return profile.birthdayMonthDayOnly ? "生日月日格式不正确" : "生日格式不正确";
  }
  return "";
}

export function normalizeMerchantMembershipRecord(value: unknown): MerchantMembershipRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const siteId = trimText(record.siteId, 64);
  const accountId = normalizeCanonicalPersonalAccountId(record.accountId);
  const userId = trimText(record.userId, 128);
  const joinedAt = normalizeIsoDateValue(record.joinedAt);
  if (!siteId || (!accountId && !userId) || !joinedAt) return null;
  const serial = normalizePositiveInteger(record.serial) || 1;
  const memberNo = trimText(record.memberNo, 64) || buildMerchantMemberNo(siteId, serial);
  const storedId =
    typeof record.id === "string" && record.id === record.id.trim()
      ? record.id
      : "";
  const id =
    storedId ||
    (userId ? `${siteId}:user:${userId}` : `${siteId}:account:${accountId}`);
  const status = normalizeMerchantMembershipStatus(record.status);
  return {
    id,
    siteId,
    siteName: trimText(record.siteName, 120) || siteId,
    memberNo,
    serial,
    accountId,
    userId,
    email: trimText(record.email, 320).toLowerCase(),
    nickname: trimText(record.nickname, 120) || trimText(record.name, 120),
    name: trimText(record.name, 120),
    phone: trimText(record.phone, 80),
    avatarUrl: trimText(record.avatarUrl, 1200),
    birthday: trimText(record.birthday, 32),
    birthdayMonthDayOnly: normalizeBoolean(record.birthdayMonthDayOnly ?? record.birthday_month_day_only),
    gender: trimText(record.gender, 32),
    country: trimText(record.country, 80),
    province: trimText(record.province, 80),
    city: trimText(record.city, 80),
    address: trimText(record.address, 240),
    taxName: trimText(record.taxName, 160) || trimText(record.tax_name, 160),
    taxNumber: trimText(record.taxNumber, 120) || trimText(record.tax_number, 120),
    taxCountry: trimText(record.taxCountry, 80) || trimText(record.tax_country, 80),
    taxProvince: trimText(record.taxProvince, 80) || trimText(record.tax_province, 80),
    taxCity: trimText(record.taxCity, 80) || trimText(record.tax_city, 80),
    taxAddress: trimText(record.taxAddress, 240) || trimText(record.tax_address, 240),
    allergens: normalizeMerchantMemberAllergens(record.allergens),
    pointBalance: Math.max(0, normalizeIntegerValue(record.pointBalance)),
    balanceAmount: Math.max(0, normalizeMoneyValue(record.balanceAmount)),
    growthValue: Math.max(0, normalizeMoneyValue(record.growthValue)),
    levelId: trimText(record.levelId, 120),
    transactions: normalizeMerchantMemberAccountTransactions(record.transactions),
    status,
    joinedAt,
    leftAt: status === "left" ? normalizeIsoDateValue(record.leftAt, new Date().toISOString()) : null,
    updatedAt: normalizeIsoDateValue(record.updatedAt, joinedAt),
  };
}

export function normalizeMerchantMembershipRecords(value: unknown): MerchantMembershipRecord[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, MerchantMembershipRecord>();
  value.forEach((item) => {
    const membership = normalizeMerchantMembershipRecord(item);
    if (!membership) return;
    const existing = map.get(membership.id);
    if (!existing || Date.parse(membership.updatedAt) >= Date.parse(existing.updatedAt)) {
      map.set(membership.id, membership);
    }
  });
  return Array.from(map.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function toPersonalMembershipCard(record: MerchantMembershipRecord): PersonalMembershipCard {
  return {
    id: record.id,
    siteId: record.siteId,
    siteName: record.siteName,
    memberNo: record.memberNo,
    qrValue: buildMerchantMembershipQrValue(record.siteId, record.memberNo),
    status: record.status,
    joinedAt: record.joinedAt,
    leftAt: record.leftAt,
  };
}

export function normalizePersonalMembershipCard(value: unknown): PersonalMembershipCard | null {
  const record = readRecord(value);
  if (!record) return null;
  const siteId = trimText(record.siteId, 64);
  const memberNo = trimText(record.memberNo, 64);
  const joinedAt = normalizeIsoDateValue(record.joinedAt);
  if (!siteId || !memberNo || !joinedAt) return null;
  const qrValue = trimText(record.qrValue, 200) || buildMerchantMembershipQrValue(siteId, memberNo);
  return {
    id: trimText(record.id, 160) || `${siteId}:${memberNo}`,
    siteId,
    siteName: trimText(record.siteName, 120) || siteId,
    memberNo,
    qrValue,
    status: normalizeMerchantMembershipStatus(record.status),
    joinedAt,
    leftAt: normalizeMerchantMembershipStatus(record.status) === "left" ? normalizeIsoDateValue(record.leftAt, new Date().toISOString()) : null,
  };
}

export function normalizePersonalMembershipCards(value: unknown): PersonalMembershipCard[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, PersonalMembershipCard>();
  value.forEach((item) => {
    const membership = normalizePersonalMembershipCard(item);
    if (!membership) return;
    map.set(membership.id, membership);
  });
  return Array.from(map.values()).sort((left, right) => Date.parse(right.joinedAt) - Date.parse(left.joinedAt));
}

export function readPersonalMembershipCardsFromUserMetadata(userMetadata: Record<string, unknown> | null | undefined) {
  const profile = readRecord(userMetadata?.personal_profile) ?? {};
  return normalizePersonalMembershipCards(profile.memberships);
}

export function writePersonalMembershipCardToUserMetadata(
  userMetadata: Record<string, unknown> | null | undefined,
  membership: PersonalMembershipCard,
) {
  const nextMetadata = userMetadata && typeof userMetadata === "object" ? { ...userMetadata } : {};
  const profile = readRecord(nextMetadata.personal_profile) ? { ...(nextMetadata.personal_profile as Record<string, unknown>) } : {};
  const current = normalizePersonalMembershipCards(profile.memberships);
  profile.memberships = [membership, ...current.filter((item) => item.id !== membership.id)].slice(0, MAX_PERSONAL_MEMBERSHIPS);
  nextMetadata.personal_profile = profile;
  return nextMetadata;
}

export function toMerchantMembershipListItem(record: MerchantMembershipRecord): MerchantMembershipListItem {
  if (record.status === "active") {
    return {
      ...record,
      profileVisible: true,
    };
  }
  return {
    ...record,
    nickname: "",
    email: "",
    name: "已退会会员",
    phone: "",
    avatarUrl: "",
    birthday: "",
    birthdayMonthDayOnly: false,
    gender: "",
    country: "",
    province: "",
    city: "",
    address: "",
    taxName: "",
    taxNumber: "",
    taxCountry: "",
    taxProvince: "",
    taxCity: "",
    taxAddress: "",
    allergens: [],
    pointBalance: 0,
    balanceAmount: 0,
    growthValue: 0,
    levelId: "",
    transactions: [],
    profileVisible: false,
  };
}
