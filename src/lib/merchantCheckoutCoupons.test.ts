import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantCouponRecord, type MerchantCouponInput, type MerchantCouponRecord } from "./merchantCoupons";
import { checkoutCouponChoices, parseCheckoutCouponClaims, prepareCheckoutCouponChanges, quoteCheckoutCoupons,
  type CheckoutCouponContext } from "./merchantCheckoutCoupons";

const at = "2026-11-22T12:00:00.000Z", accountId = "50010105", userId = "customer-test-1";
const context = (patch: Partial<CheckoutCouponContext> = {}): CheckoutCouponContext => ({
  siteId: "10909095", accountId, userId, membershipActive: true, kind: "order", method: "on_site", targetId: "product-test",
  tags: ["games"], quantity: 2, unitCashMinor: 5000, unitPoints: 300, voucherCouponIds: ["coupon-test"], now: at, ...patch,
});
function coupon(patch: MerchantCouponInput = {}): MerchantCouponRecord {
  return normalizeMerchantCouponRecord({ id: "coupon-test", siteId: "10909095", title: "会员券", code: "TEST",
    discountType: "amount_off", discountValue: 20, status: "active", totalQuantity: 1, claimedCount: 1,
    usageScenarios: ["order_cart", "points_redemption"], createdAt: at, updatedAt: at,
    claimEvents: [{ id: "claim-test", at, accountId, userId, email: "private@example.invalid", customerName: "Private name", code: "", settlementType: "qr",
      settlementCode: "SECRET-SETTLEMENT-CODE", validUntil: "2026-12-22T00:00:00Z" }], ...patch })!;
}
const pick = (row: MerchantCouponRecord) => ({ couponId: row.id, claimEventId: row.claimEvents[0].id });
const quote = (row: MerchantCouponRecord, ctx = context()) => quoteCheckoutCoupons([row], ctx, [pick(row)]);

test("all eight existing coupon types quote in their correct units", () => {
  for (const type of ["amount_off", "threshold_amount_off", "stored_value"] as const) {
    const q = quote(coupon({ discountType: type, discountValue: 20, minimumAmount: 50 }));
    assert.equal(q.cashDiscountMinor, 2000); assert.equal(q.payableCashMinor, 8000); assert.equal(q.payablePoints, 600);
  }
  const percent = quote(coupon({ discountType: "percent_off", discountValue: 25, maxDiscountAmount: 15 }));
  assert.equal(percent.cashDiscountMinor, 1500);
  const product = quote(coupon({ discountType: "product_voucher", productQuantity: 1 }));
  assert.equal(product.coveredQuantity, 1); assert.equal(product.payableCashMinor, 5000);
  const exchange = quote(coupon({ discountType: "exchange_voucher", exchangeQuantity: 2 }), context({ kind: "booking", method: "points" }));
  assert.equal(exchange.payablePoints, 0); assert.equal(exchange.pointsDiscount, 600); assert.equal(exchange.payableCashMinor, 10000);
  const ticket = quote(coupon({ discountType: "ticket_voucher", ticketDurationMinutes: 60 }), context({ kind: "booking", quantity: 1, durationMinutes: 60 }));
  assert.equal(ticket.payableCashMinor, 0);
  const points = quote(coupon({ discountType: "points_voucher", discountValue: 200 }), context({ method: "points" }));
  assert.equal(points.payablePoints, 400); assert.equal(points.cashDiscountMinor, 0);
});

test("issued coupon remains usable when the campaign has no unclaimed stock", () => {
  const row = coupon(); assert.equal(row.totalQuantity, row.claimedCount);
  assert.equal(quote(row).payableCashMinor, 8000);
});

test("ownership requires every present account/user ID to agree, never email/name or a guessed code", () => {
  const row = coupon();
  for (const patch of [{ accountId: "50010106" }, { userId: "other-customer" }, { accountId: "", userId: "" }]) {
    const other = { ...row, claimEvents: [{ ...row.claimEvents[0], ...patch }] };
    assert.deepEqual(checkoutCouponChoices([other], context()), []);
    assert.throws(() => quoteCheckoutCoupons([other], context(), [pick(row)]), /checkout_coupon_unavailable/);
  }
  assert.deepEqual(checkoutCouponChoices([row], context({ membershipActive: false })), []);
  assert.deepEqual(checkoutCouponChoices([{ ...row, siteId: "10909096" }], context()), []);
  assert.equal(checkoutCouponChoices([{ ...row, claimEvents: [{ ...row.claimEvents[0], accountId: "" }] }], context()).length, 1);
});

test("paused, expired, future and redeemed claims cannot be consumed", () => {
  const row = coupon();
  const cases: Array<[Partial<MerchantCouponRecord>, string]> = [
    [{ status: "paused" }, "inactive"], [{ startsAt: "2026-12-01T00:00:00Z" }, "not_started"], [{ expiresAt: "2026-11-21T23:59:59Z" }, "expired"],
    [{ claimEvents: [{ ...row.claimEvents[0], validUntil: "2026-11-21T00:00:00Z" }] }, "expired"],
    [{ redeemEvents: [{ id: "redeem-test", at, claimEventId: "claim-test", settlementCode: "old-code", accountId, userId, operatorId: "merchant", note: "" }] }, "used"],
    [{ expiresAt: "not-a-date" }, "invalid"],
  ];
  for (const [patch, reason] of cases) {
    const next = { ...row, ...patch };
    assert.equal(checkoutCouponChoices([next], context())[0].reason, reason);
    assert.throws(() => quote(next), /checkout_coupon_unavailable/);
  }
});

test("scope, scenario, minimum and ticket duration are enforced on the selected resource", () => {
  for (const patch of [{ applicableProductIds: ["other-product"] }, { applicableTags: ["food"] }, { usageScenarios: ["checkout_qr" as const] }, { minimumAmount: 101 }]) {
    assert.throws(() => quote(coupon(patch)), /checkout_coupon_unavailable/);
  }
  assert.throws(() => quote(coupon({ discountType: "product_voucher", productName: "Same display name" }), context({ voucherCouponIds: [] })), /checkout_coupon_unavailable/);
  assert.throws(() => quote(coupon({ discountType: "ticket_voucher", ticketDurationMinutes: 60 }), context({ kind: "booking", durationMinutes: 90 })), /checkout_coupon_unavailable/);
  assert.throws(() => quote(coupon({ discountType: "product_voucher" }), context({ kind: "booking" })), /checkout_coupon_unavailable/);
});

test("points and money are never silently converted or spent by the other coupon kind", () => {
  assert.throws(() => quote(coupon({ discountType: "amount_off" }), context({ method: "points" })), /checkout_coupon_unavailable/);
  assert.throws(() => quote(coupon({ discountType: "points_voucher" })), /checkout_coupon_unavailable/);
  const q = quote(coupon({ discountType: "points_voucher", discountValue: 9999 }), context({ method: "points" }));
  assert.equal(q.payablePoints, 0); assert.equal(q.payableCashMinor, 10000);
});

test("existing multi-points-coupon minimum and count limits apply; new general stacking is not invented", () => {
  const a = coupon({ discountType: "points_voucher", discountValue: 200 }), b = { ...a, id: "coupon-second" };
  const ctx = context({ method: "points" }), selected = [pick(a), pick(b)];
  assert.equal(quoteCheckoutCoupons([a, b], ctx, selected).payablePoints, 200);
  assert.throws(() => quoteCheckoutCoupons([{ ...a, pointsVoucherMaxPerRedemption: 1 }, b], ctx, selected), /checkout_coupon_stack_not_allowed/);
  assert.throws(() => quote({ ...a, pointsVoucherMinimumRedeemPoints: 601 }, ctx), /checkout_coupon_unavailable/);
  assert.throws(() => quoteCheckoutCoupons([coupon(), { ...coupon(), id: "second" }], context(), [pick(coupon()), { couponId: "second", claimEventId: "claim-test" }]), /checkout_coupon_stack_not_allowed/);
  assert.throws(() => quoteCheckoutCoupons([{ ...a, discountValue: 600 }, b], ctx, selected), /checkout_coupon_no_benefit/);
});

test("selection is bounded, canonical and contains IDs only", () => {
  for (const value of [null, [{ couponId: "a" }], [{ ...pick(coupon()), discountValue: 9999 }], [pick(coupon()), pick(coupon())], Array(21).fill(pick(coupon()))]) {
    assert.throws(() => parseCheckoutCouponClaims(value), /checkout_invalid_coupon_selection/);
  }
  const first = { couponId: "a", claimEventId: "z" }, second = { couponId: "b", claimEventId: "x" };
  assert.deepEqual(parseCheckoutCouponClaims([second, first]), [first, second]);
});

test("duplicate stored coupon identities fail closed, including different claim IDs", () => {
  const row = coupon(), duplicate = { ...row, claimEvents: [{ ...row.claimEvents[0], id: "different-claim" }] };
  assert.throws(() => checkoutCouponChoices([row, duplicate], context()), /checkout_coupon_store_ambiguous/);
});

test("quotes do not mutate coupon data or disclose settlement codes, other customers or ledger events", () => {
  const row = coupon(), before = structuredClone(row);
  const result = checkoutCouponChoices([row], context());
  quote(row);
  assert.deepEqual(row, before);
  assert.ok(!/SECRET|private@example|Private name|redeemEvents|claimEvents|userId|accountId/.test(JSON.stringify(result)));
});

test("prepared coupon changes are private, side-effect-free, operation-bound and preserve other claims/unknown fields", () => {
  const row = { ...coupon(), futureField: { preserve: true } }, before = structuredClone(row);
  const plan = prepareCheckoutCouponChanges([row], context(), [pick(row)], "a".repeat(64));
  assert.deepEqual(row, before); assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].next.usedCount, row.usedCount + 1);
  assert.equal(plan.changes[0].next.redeemEvents.length, row.redeemEvents.length + 1);
  assert.deepEqual(plan.changes[0].next.claimEvents, row.claimEvents);
  assert.deepEqual((plan.changes[0].next as typeof row).futureField, row.futureField);
  assert.equal(plan.changes[0].next.redeemEvents[0].operatorId, `customer:${accountId}`);
  assert.match(plan.changes[0].next.redeemEvents[0].note, /member-checkout-coupon/);
  assert.throws(() => prepareCheckoutCouponChanges([plan.changes[0].next], context(), [pick(row)], "b".repeat(64)), /checkout_coupon_unavailable/);
});

test("rounding uses integer minor units, applies caps and never creates negative totals", () => {
  const q = quote(coupon({ discountType: "percent_off", discountValue: 12.5 }), context({ unitCashMinor: 101, quantity: 1 }));
  assert.equal(q.cashDiscountMinor, 13); assert.equal(q.payableCashMinor, 88);
  assert.equal(quote(coupon({ discountType: "stored_value", discountValue: 999 })).payableCashMinor, 0);
  assert.throws(() => quote({ ...coupon({ discountType: "percent_off" }), discountValue: 101 }), /checkout_coupon_unavailable/);
  assert.throws(() => quote(coupon(), context({ unitCashMinor: 99_999_999, quantity: 999 })), /checkout_total_too_large/);
});
