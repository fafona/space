import assert from "node:assert/strict";
import test from "node:test";
import { readMerchantRedemptionCheckoutError } from "./merchantRedemptionCheckoutErrors";

test("checkout conflicts keep their stable safe codes and 409 status", () => {
  for (const code of [
    "merchant_membership_settings_conflict", "merchant_coupons_conflict", "merchant_memberships_conflict",
    "redemption_operation_conflict", "redemption_checkout_cancelled", "redemption_pending_checkout_exists",
    "redemption_checkout_context_required", "redemption_checkout_quote_changed", "redemption_checkout_pending", "redemption_checkout_not_terminal",
    "redemption_legacy_operation_requires_review", "membership_not_active", "membership_balance_insufficient",
    "membership_redemption_stock_insufficient", "coupon_already_redeemed", "coupon_not_active", "coupon_not_started",
    "coupon_expired", "coupon_claim_expired",
  ]) assert.deepEqual(readMerchantRedemptionCheckoutError(new Error(code)), { code, status: 409 });
});

test("checkout input errors include malformed legacy product input without revealing details", () => {
  for (const code of [
    "invalid_site_id", "mutation_operation_id_required", "mutation_operation_id_invalid",
    "membership_operation_empty", "membership_redemption_quantity_invalid", "membership_redemption_item_conflict",
    "membership_redemption_item_invalid", "coupon_duplicate_settlement_code", "coupon_claim_member_mismatch", "coupon_not_direct_redeemable",
    "coupon_points_voucher_requires_points", "coupon_points_voucher_limit_exceeded", "coupon_points_voucher_minimum_not_met",
  ]) assert.deepEqual(readMerchantRedemptionCheckoutError(new Error(code)), { code, status: 400 });
});

test("checkout not-found errors remain explicit 404 responses", () => {
  for (const code of ["redemption_checkout_not_found", "membership_not_found", "membership_redemption_item_not_found", "coupon_claim_not_found"])
    assert.deepEqual(readMerchantRedemptionCheckoutError(new Error(code)), { code, status: 404 });
});

test("unknown failures, SQL details, request payloads and PII collapse to the same unavailable response", () => {
  for (const error of [
    new Error("SQL INSERT INTO faolla_redemption_checkouts request={email:private@example.test, token:secret}"),
    new Error("merchant_memberships_read_failed:private-member-data"),
    new Error("redemption_checkout_store_corrupt"), new Error("redemption_checkout_mutation_not_persisted"),
    new Error("invalid_redemption_checkout"), new Error("merchant_transaction_unavailable"),
    new Error("redemption_operation_conflict:private-value"), new Error(" redemption_operation_conflict"),
    new Error("redemption_operation_conflict\nSQL private-value"), new Error(""),
    { message: "SQL private-value", status: 400, code: "private-value" },
    { message: "redemption_operation_conflict" }, "redemption_operation_conflict", null, undefined, 503,
  ]) assert.deepEqual(readMerchantRedemptionCheckoutError(error), { code: "merchant_transaction_unavailable", status: 503 });
});

test("only the exact error message is considered; causes and custom properties are never returned", () => {
  const error = new Error("redemption_checkout_cancelled", { cause: new Error("SQL private-value") });
  Object.assign(error, { details: "private@example.test", token: "secret", status: 200 });
  assert.deepEqual(readMerchantRedemptionCheckoutError(error), { code: "redemption_checkout_cancelled", status: 409 });
});
