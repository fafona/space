import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantCouponRecord } from "./merchantCoupons";
import { prepareCheckoutCouponChanges, type CheckoutCouponContext } from "./merchantCheckoutCoupons";
import { prepareCheckoutCouponReturns as prepare } from "./merchantCheckoutCouponReturns";

const at = "2026-11-22T12:00:00.000Z", later = "2026-11-23T12:00:00.000Z", checkoutKey = "a".repeat(64);
function fixture() {
  const context: CheckoutCouponContext = { siteId: "10909095", accountId: "50010105", userId: "synthetic-user", membershipActive: true,
    kind: "order", method: "on_site", targetId: "synthetic-product", tags: [], quantity: 1, unitCashMinor: 2000, unitPoints: null, voucherCouponIds: [], now: at };
  const row = normalizeMerchantCouponRecord({ id: "synthetic-coupon", siteId: context.siteId, title: "Synthetic coupon", code: "TEST", discountValue: 10,
    createdAt: at, updatedAt: at, expiresAt: "2026-11-22T13:00:00Z", claimEvents: [{ id: "synthetic-claim", at,
      accountId: context.accountId, userId: context.userId, settlementType: "qr", settlementCode: "PRIVATE-CODE", email: "", code: "", customerName: "", validUntil: "2026-11-22T13:00:00Z" }] });
  assert.ok(row);
  const coupon = prepareCheckoutCouponChanges([row], context, [{ couponId: row.id, claimEventId: row.claimEvents[0].id }], checkoutKey).changes[0].next;
  return { ...context, checkoutKey, originalPolicy: { returnOnCancel: true }, resourceCancelled: true, coupons: [coupon], existingReturns: [], now: later,
    uses: [{ couponId: coupon.id, claimEventId: coupon.claimEvents[0].id, redeemEventId: coupon.redeemEvents[0].id }] };
}
test("merchant's snapshotted policy retains coupons or returns the ORIGINAL claim without extending expiry", () => {
  const input = fixture(), before = structuredClone(input);
  assert.deepEqual(prepare({ ...input, originalPolicy: { returnOnCancel: false } }).changes, []);
  const result = prepare(input), returned = result.changes[0].next;
  assert.equal(returned.usedCount, 0); assert.equal(returned.redeemEvents.length, 0);
  assert.deepEqual(returned.claimEvents, input.coupons[0].claimEvents); assert.equal(returned.expiresAt, input.coupons[0].expiresAt);
  assert.deepEqual(result.facts[0].originalRedemption, input.coupons[0].redeemEvents[0]); assert.deepEqual(input, before);
});
test("durable prior return makes replay a no-op, even if the returned claim was later redeemed on another order", () => {
  const input = fixture(), first = prepare(input), returned = first.changes[0].next;
  const replay = prepare({ ...input, coupons: [returned], existingReturns: first.facts });
  assert.deepEqual(replay.changes, []); assert.deepEqual(replay.facts, []);
  const laterUse = { ...returned, usedCount: 1, redeemEvents: [{ ...first.facts[0].originalRedemption, id: "another-redemption", note: "different-order" }] };
  assert.deepEqual(prepare({ ...input, coupons: [laterUse], existingReturns: first.facts }).changes, []);
});
test("foreign identity, active resource, missing decision, reused nonce and wrong original redemption are refused", () => {
  const input = fixture();
  for (const patch of [{ accountId: "50010106" }, { userId: "someone-else" }, { checkoutKey: "b".repeat(64) },
    { resourceCancelled: false }, { originalPolicy: { returnOnCancel: undefined } },
    { uses: [{ ...input.uses[0], redeemEventId: "different-event" }] }, { uses: [input.uses[0], input.uses[0]] }]) {
    assert.throws(() => prepare({ ...input, ...patch } as Parameters<typeof prepare>[0]));
  }
  assert.throws(() => prepare({ ...input, coupons: [{ ...input.coupons[0], redeemEvents: [] }] }), /checkout_coupon_return_conflict/);
});
test("unknown legacy fields, other claims and other redemption history are preserved", () => {
  const input = fixture(), coupon = input.coupons[0], foreignEvent = { ...coupon.redeemEvents[0], id: "foreign-event", claimEventId: "foreign-claim", settlementCode: "foreign-code" };
  const extended = { ...coupon, usedCount: 2, futureField: { retained: true }, redeemEvents: [...coupon.redeemEvents, foreignEvent] };
  const result = prepare({ ...input, coupons: [extended] }), next = result.changes[0].next;
  assert.deepEqual(next.redeemEvents, [foreignEvent]); assert.equal(next.usedCount, 1);
  assert.deepEqual((next as typeof extended).futureField, extended.futureField);
});
