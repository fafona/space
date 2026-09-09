const CONFLICT_ERRORS = new Set([
  "merchant_membership_settings_conflict", "merchant_coupons_conflict", "merchant_memberships_conflict",
  "redemption_operation_conflict", "redemption_checkout_cancelled", "redemption_pending_checkout_exists",
  "redemption_checkout_context_required", "redemption_checkout_quote_changed", "redemption_checkout_pending", "redemption_checkout_not_terminal",
  "redemption_legacy_operation_requires_review", "membership_not_active", "membership_balance_insufficient",
  "membership_redemption_stock_insufficient", "coupon_already_redeemed", "coupon_not_active", "coupon_not_started",
  "coupon_expired", "coupon_claim_expired",
]);
const INPUT_ERRORS = new Set([
  "invalid_site_id", "mutation_operation_id_required", "mutation_operation_id_invalid",
  "membership_operation_empty", "membership_redemption_quantity_invalid", "membership_redemption_item_conflict",
  "membership_redemption_item_invalid", "coupon_duplicate_settlement_code", "coupon_claim_member_mismatch", "coupon_not_direct_redeemable",
  "coupon_points_voucher_requires_points", "coupon_points_voucher_limit_exceeded", "coupon_points_voucher_minimum_not_met",
]);
const NOT_FOUND_ERRORS = new Set([
  "redemption_checkout_not_found", "membership_not_found", "membership_redemption_item_not_found", "coupon_claim_not_found",
]);

/** Only exact application error codes may cross the checkout HTTP boundary. */
export function readMerchantRedemptionCheckoutError(error: unknown): { code: string; status: number } {
  const code = error instanceof Error ? error.message : "";
  if (CONFLICT_ERRORS.has(code)) return { code, status: 409 };
  if (INPUT_ERRORS.has(code)) return { code, status: 400 };
  if (NOT_FOUND_ERRORS.has(code)) return { code, status: 404 };
  return { code: "merchant_transaction_unavailable", status: 503 };
}
