/**
 * Payment arithmetic only. These functions do not create Stripe objects, save
 * settings, grant entitlements or change an order/booking's business status.
 *
 * Callers must load the price, collection history and commission from trusted
 * server storage. A browser-supplied quote is never authority to charge money.
 * All amounts are integer minor units of one already-validated currency; the
 * provider's currency-specific limits must be checked before creating Checkout.
 */
export type MerchantInitialPaymentPolicy =
  | { mode: "full" }
  | { mode: "deposit_fixed"; amountMinor: number }
  | { mode: "deposit_percent"; basisPoints: number };

export type PlatformCommissionPolicy = { basisPoints: number };

export type FaollaPaymentRuleError =
  | "invalid_total"
  | "invalid_payment_policy"
  | "invalid_deposit"
  | "deposit_exceeds_total"
  | "deposit_rounds_to_zero"
  | "commission_not_configured"
  | "invalid_commission"
  | "invalid_paid_amount"
  | "nothing_to_pay"
  | "invalid_renewal_choice";

export type FaollaPaymentRuleResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FaollaPaymentRuleError };

export type MerchantPaymentQuote = {
  totalMinor: number;
  payNowMinor: number;
  remainingMinor: number;
  applicationFeeMinor: number;
  commissionBasisPoints: number;
};

const BASIS_POINTS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeMinorAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBasisPoints(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BASIS_POINTS;
}

function quote(
  totalMinor: number,
  payNowMinor: number,
  remainingMinor: number,
  commission: unknown,
): FaollaPaymentRuleResult<MerchantPaymentQuote> {
  // An unset fee is not silently treated as an approved zero-fee promotion.
  if (commission === undefined || commission === null) {
    return { ok: false, error: "commission_not_configured" };
  }
  if (!isRecord(commission) || !isBasisPoints(commission.basisPoints) || commission.basisPoints >= BASIS_POINTS) {
    return { ok: false, error: "invalid_commission" };
  }
  // Round the platform fee down on the amount actually being collected, not on
  // the whole booking again. BigInt avoids intermediate floating-point overflow.
  // A zero result must be omitted from Stripe's application_fee_amount field.
  const applicationFeeMinor = Number(
    BigInt(payNowMinor) * BigInt(commission.basisPoints) / BigInt(BASIS_POINTS),
  );
  return {
    ok: true,
    value: {
      totalMinor,
      payNowMinor,
      remainingMinor,
      applicationFeeMinor,
      commissionBasisPoints: commission.basisPoints,
    },
  };
}

export function quoteMerchantInitialPayment(
  totalMinor: unknown,
  policy: unknown,
  commission: unknown,
): FaollaPaymentRuleResult<MerchantPaymentQuote> {
  if (!isNonnegativeMinorAmount(totalMinor) || totalMinor === 0) {
    return { ok: false, error: "invalid_total" };
  }
  if (!isRecord(policy)) return { ok: false, error: "invalid_payment_policy" };

  let payNowMinor: number;
  if (policy.mode === "full") {
    payNowMinor = totalMinor;
  } else if (policy.mode === "deposit_fixed") {
    if (!isNonnegativeMinorAmount(policy.amountMinor) || policy.amountMinor === 0) {
      return { ok: false, error: "invalid_deposit" };
    }
    if (policy.amountMinor > totalMinor) return { ok: false, error: "deposit_exceeds_total" };
    payNowMinor = policy.amountMinor;
  } else if (policy.mode === "deposit_percent") {
    if (!isBasisPoints(policy.basisPoints) || policy.basisPoints === 0) {
      return { ok: false, error: "invalid_deposit" };
    }
    // Round the customer's deposit half-up to the currency's minor unit.
    payNowMinor = Number(
      (BigInt(totalMinor) * BigInt(policy.basisPoints) + BigInt(5_000)) / BigInt(BASIS_POINTS),
    );
    if (payNowMinor === 0) return { ok: false, error: "deposit_rounds_to_zero" };
  } else {
    return { ok: false, error: "invalid_payment_policy" };
  }
  return quote(totalMinor, payNowMinor, totalMinor - payNowMinor, commission);
}

/**
 * Only quote a customer-initiated balance payment from reconciled server data.
 * This is not permission to debit a saved card or automatically retry a payment.
 * Existing pending payments, refunds and disputes need ledger reconciliation
 * before the caller can decide how much remains collectible.
 */
export function quoteMerchantBalancePayment(
  totalMinor: unknown,
  paidMinor: unknown,
  commission: unknown,
): FaollaPaymentRuleResult<MerchantPaymentQuote> {
  if (!isNonnegativeMinorAmount(totalMinor) || totalMinor === 0) {
    return { ok: false, error: "invalid_total" };
  }
  if (!isNonnegativeMinorAmount(paidMinor) || paidMinor > totalMinor) {
    return { ok: false, error: "invalid_paid_amount" };
  }
  if (paidMinor === totalMinor) return { ok: false, error: "nothing_to_pay" };
  return quote(totalMinor, totalMinor - paidMinor, 0, commission);
}

export function resolveFaollaRenewalChoice(
  autoRenew: unknown,
): FaollaPaymentRuleResult<{ autoRenew: boolean; checkoutMode: "payment" | "subscription" }> {
  // No opt-in means a single-period purchase. Do not coerce strings such as
  // "false" to true. Separate server-controlled prices and access expiry are
  // required for one-time purchases before connecting this to a checkout route.
  if (autoRenew === undefined || autoRenew === null || autoRenew === false) {
    return { ok: true, value: { autoRenew: false, checkoutMode: "payment" } };
  }
  if (autoRenew === true) {
    return { ok: true, value: { autoRenew: true, checkoutMode: "subscription" } };
  }
  return { ok: false, error: "invalid_renewal_choice" };
}
