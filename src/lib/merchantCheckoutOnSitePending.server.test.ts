import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prepareOnSitePendingTerms, parseOnSitePendingReceipt } from "./merchantCheckoutOnSitePending.server";
import type { ConfiguredCheckoutOffer } from "./merchantCheckoutConfiguration";
import { normalizeMerchantMembershipRecord } from "./merchantMemberships";
import { normalizeMerchantCouponRecord, type MerchantCouponInput } from "./merchantCoupons";
import { parseMemberCheckoutResult } from "./merchantMemberCheckoutResult";

const siteId = "10909095", principal = { accountId: "50010105", userId: "synthetic-customer" }, now = "2026-11-23T12:00:00Z";
function fixture() {
  const offer: ConfiguredCheckoutOffer = { version: 1, id: randomUUID(), revision: randomUUID(), siteId, enabled: true, title: "Synthetic", maxQuantity: 3,
    source: { kind: "order", blockId: "synthetic-block", collectionId: "synthetic-collection", productId: "synthetic-product" },
    cash: { currency: "eur", unitAmountMinor: 1001, initialPolicy: { mode: "full" } }, unitPoints: null, allowOnSite: true, couponReturnOnCancel: true,
    checkoutBinding: { sourceKey: "a".repeat(64), sourceVersion: "b".repeat(64), viewport: "desktop", stockItemId: null,
      voucherCouponIds: ["synthetic-coupon"], durationMinutes: 60, pointsReturnOnCancel: false, cancellationAdvanceMinutes: 60 } };
  const membership = normalizeMerchantMembershipRecord({ id: "synthetic-member", siteId, ...principal, status: "active", pointBalance: 123, balanceAmount: 99,
    growthValue: 5, joinedAt: now, updatedAt: now, transactions: [] })!;
  return { siteId, principal, membership, offer, selection: { offerId: offer.id, offerRevision: offer.revision, quantity: 1 },
    coupons: [] as NonNullable<ReturnType<typeof normalizeMerchantCouponRecord>>[], tags: ["games"], now, resourceId: "synthetic-resource" };
}
function coupon(patch: MerchantCouponInput = {}) {
  return normalizeMerchantCouponRecord({ id: "synthetic-coupon", siteId, code: "SYNTHETIC", title: "Synthetic coupon", discountType: "amount_off", discountValue: 2,
    usageScenarios: ["order_cart"], status: "active", createdAt: now, updatedAt: now,
    claimEvents: [{ id: "synthetic-claim", ...principal, at: now, customerName: "Private", email: "private@example.invalid", code: "", settlementType: "qr", settlementCode: "PRIVATE-CODE", validUntil: null }], ...patch })!;
}
const withCoupon = (patch: MerchantCouponInput = {}) => {
  const f = fixture(), row = coupon(patch);
  return { ...f, coupons: [row], selection: { ...f.selection, couponClaims: [{ couponId: row.id, claimEventId: row.claimEvents[0].id }] } };
};
test("cash-only offer prepares unpaid EUR cents without points or membership mutation", () => {
  const f = fixture(), before = structuredClone(f), plan = prepareOnSitePendingTerms(f);
  assert.deepEqual(plan.receipt, { version: 2, method: "on_site", resourceKind: "order", resourceId: f.resourceId,
    currency: "eur", grossMinor: 1001, discountMinor: 0, dueMinor: 1001, capturedMinor: 0, totalPoints: null, couponCount: 0, paymentState: "unpaid" });
  assert.deepEqual(f, before); assert.ok(!/transactions|growthValue|pointBalance|balanceAmount|PRIVATE/.test(JSON.stringify(plan)));
});
test("amount, threshold and stored-value coupons reduce cash only, preserving original single-use semantics", () => {
  for (const discountType of ["amount_off", "threshold_amount_off", "stored_value"] as const) {
    const f = withCoupon({ discountType, minimumAmount: 10 }), before = structuredClone(f), plan = prepareOnSitePendingTerms(f);
    assert.equal(plan.receipt.dueMinor, 801); assert.equal(plan.receipt.capturedMinor, 0); assert.equal(plan.receipt.totalPoints, null);
    assert.equal(plan.couponReturnOnCancel, true); assert.deepEqual(f, before);
  }
});
test("percentage discount uses exact cent rounding and cap, never float subtraction", () => {
  const f = withCoupon({ discountType: "percent_off", discountValue: 25 });
  assert.equal(prepareOnSitePendingTerms(f).receipt.discountMinor, 250);
  f.coupons[0].maxDiscountAmount = 1; assert.equal(prepareOnSitePendingTerms(f).receipt.dueMinor, 901);
});
test("product and booking vouchers distinguish coupon coverage from money received", () => {
  const product = withCoupon({ discountType: "product_voucher", productQuantity: 1 });
  assert.equal(prepareOnSitePendingTerms(product).receipt.paymentState, "coupon_covered");
  for (const discountType of ["exchange_voucher", "ticket_voucher"] as const) {
    const f = withCoupon({ discountType, exchangeQuantity: 1, ticketDurationMinutes: 60 });
    f.offer.source = { kind: "booking", blockId: "booking", serviceId: f.offer.id, timeZone: "Europe/Madrid" };
    f.offer.checkoutBinding.store = "Synthetic"; f.offer.checkoutBinding.item = "Synthetic";
    const plan = prepareOnSitePendingTerms({ ...f, selection: { ...f.selection, slotKey: "slot" } });
    assert.equal(plan.receipt.dueMinor, 0); assert.equal(plan.receipt.capturedMinor, 0); assert.equal(plan.receipt.paymentState, "coupon_covered");
  }
});
test("points vouchers and invented mixed monetary stacking are rejected", () => {
  assert.throws(() => prepareOnSitePendingTerms(withCoupon({ discountType: "points_voucher", discountValue: 999 })), /checkout_coupon_unavailable/);
  const f = withCoupon(), second = { ...f.coupons[0], id: "second-coupon" };
  assert.throws(() => prepareOnSitePendingTerms({ ...f, coupons: [...f.coupons, second], selection: { ...f.selection,
    couponClaims: [...f.selection.couponClaims, { couponId: second.id, claimEventId: second.claimEvents[0].id }] } }), /checkout_coupon_stack_not_allowed/);
});
test("site, membership, current offer revision, method and quantity are not browser authority", () => {
  const f = fixture();
  for (const patch of [{ membership: { ...f.membership, status: "left" as const } }, { principal: { ...principal, userId: "wrong-customer" } },
    { siteId: "10909096" }, { offer: { ...f.offer, allowOnSite: false } }, { selection: { ...f.selection, offerRevision: randomUUID() } },
    { selection: { ...f.selection, quantity: 4 } }]) assert.throws(() => prepareOnSitePendingTerms({ ...f, ...patch }));
});
test("foreign, used, expired and incorrectly scoped coupons fail before any plan", () => {
  const f = withCoupon();
  for (const patch of [{ claimEvents: [{ ...f.coupons[0].claimEvents[0], accountId: "50010106" }] }, { expiresAt: "2026-11-22T00:00:00Z" },
    { applicableProductIds: ["other-product"] }, { usageScenarios: ["checkout_qr" as const] },
    { redeemEvents: [{ id: "used", at: now, claimEventId: "synthetic-claim", settlementCode: "PRIVATE-CODE", ...principal, operatorId: "merchant", note: "" }] }]) {
    assert.throws(() => prepareOnSitePendingTerms({ ...f, coupons: [{ ...f.coupons[0], ...patch }] }), /checkout_coupon_unavailable/);
  }
});
test("on-site projection refuses paid/points/fractional/inconsistent receipts and strips private fields", () => {
  const receipt = prepareOnSitePendingTerms(fixture()).receipt;
  assert.deepEqual(parseOnSitePendingReceipt({ ...receipt, membershipId: "PRIVATE", couponUses: ["PRIVATE"] }), receipt);
  for (const patch of [{ capturedMinor: 1 }, { totalPoints: 0 }, { grossMinor: 1.2 }, { dueMinor: 0 }, { paymentState: "paid" },
    { couponCount: 1 }, { discountMinor: 2000 }, { currency: "usd" }, { version: 1 }]) assert.throws(() => parseOnSitePendingReceipt({ ...receipt, ...patch }), /checkout_invalid_on_site_receipt/);
  assert.throws(() => parseMemberCheckoutResult({ ...receipt, siteId, operationKey: "a".repeat(64) }, { siteId, operationKey: "a".repeat(64) }), /checkout_invalid_response/);
});
