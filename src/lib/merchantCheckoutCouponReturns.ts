import { releaseMerchantCouponRedemption, type MerchantCouponRecord, type MerchantCouponRedeemEvent } from "./merchantCoupons";
import { buildMutationOperationMarker } from "./mutationOperationId";

export type CheckoutCouponUse = { couponId: string; claimEventId: string; redeemEventId: string };
export type CheckoutCouponReturnFact = CheckoutCouponUse & {
  siteId: string; checkoutKey: string; returnedAt: string; originalRedemption: MerchantCouponRedeemEvent;
};
const key = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
const need = (value: unknown): void => { if (!value) throw new Error("checkout_coupon_return_conflict"); };
const couponUseKey = (use: CheckoutCouponUse) => JSON.stringify([use.couponId, use.claimEventId, use.redeemEventId]);

/** PRIVATE preparation only, never a standalone refund command. The caller must
 * load an immutable original receipt/policy, authorize cancellation, and commit
 * resource cancellation + these coupon CAS changes + append-only facts in ONE
 * transaction. A durable unique (site, original redeem event) is mandatory.
 * Existing original coupon helpers remain unchanged. No new coupon is issued,
 * and neither original expiry nor claim ownership is changed. */
export function prepareCheckoutCouponReturns(input: {
  siteId: string; checkoutKey: string; accountId: string; userId: string;
  originalPolicy: { returnOnCancel: boolean }; resourceCancelled: boolean;
  uses: CheckoutCouponUse[]; coupons: MerchantCouponRecord[]; existingReturns: CheckoutCouponReturnFact[]; now: string;
}) {
  need(/^\d{8}$/.test(input.siteId) && /^\d{8}$/.test(input.accountId) && key(input.userId)
    && /^[a-f0-9]{64}$/.test(input.checkoutKey) && Number.isFinite(Date.parse(input.now)));
  need(input.resourceCancelled === true && typeof input.originalPolicy?.returnOnCancel === "boolean");
  need(Array.isArray(input.uses) && input.uses.length <= 20 && input.uses.every(use =>
    key(use.couponId) && key(use.claimEventId) && key(use.redeemEventId))
    && new Set(input.uses.map(couponUseKey)).size === input.uses.length
    && new Set(input.uses.map(use => use.redeemEventId)).size === input.uses.length);
  if (!input.originalPolicy.returnOnCancel) return { changes: [], facts: [], returnedCount: 0, policy: "retain" as const };

  const changed = new Map<string, MerchantCouponRecord>(), facts: CheckoutCouponReturnFact[] = [];
  const marker = buildMutationOperationMarker("member-checkout-coupon", input.checkoutKey);
  for (const use of input.uses) {
    const rows = input.coupons.filter(row => row.siteId === input.siteId && row.id === use.couponId);
    need(rows.length === 1);
    const current = changed.get(use.couponId) ?? rows[0];
    const claims = current.claimEvents.filter(claim => claim.id === use.claimEventId);
    need(claims.length === 1);
    const claim = claims[0];
    need(Boolean(claim.settlementCode) && current.claimEvents.filter(row => row.settlementCode === claim.settlementCode).length === 1);
    need(Boolean(claim.accountId || claim.userId) && (!claim.accountId || claim.accountId === input.accountId)
      && (!claim.userId || claim.userId === input.userId));
    const previous = input.existingReturns.filter(fact => fact.siteId === input.siteId && fact.redeemEventId === use.redeemEventId);
    need(previous.length <= 1);
    if (previous.length) {
      need(previous[0].checkoutKey === input.checkoutKey && couponUseKey(previous[0]) === couponUseKey(use));
      // A returned claim may since have been used for a DIFFERENT order. Never
      // release that later redemption while replaying this old cancellation.
      continue;
    }
    const events = current.redeemEvents.filter(event => event.claimEventId === claim.id || event.settlementCode === claim.settlementCode);
    need(events.length === 1 && events[0].id === use.redeemEventId && Number.isFinite(Date.parse(events[0].at))
      && Date.parse(events[0].at) <= Date.parse(input.now)
      && events[0].accountId === claim.accountId && events[0].userId === claim.userId
      && Number.isSafeInteger(current.usedCount) && current.usedCount >= 1);
    const released = releaseMerchantCouponRedemption(current, { settlementCode: claim.settlementCode, operationMarker: marker, now: input.now });
    need(!released.alreadyReleased);
    // Keep unknown legacy fields and full history; archive the removed original
    // event in the immutable return fact, not only in a truncated UI note.
    changed.set(current.id, { ...current, usedCount: current.usedCount - 1, updatedAt: input.now,
      redeemEvents: current.redeemEvents.filter(event => event.id !== use.redeemEventId) });
    facts.push({ ...use, siteId: input.siteId, checkoutKey: input.checkoutKey, returnedAt: input.now,
      originalRedemption: structuredClone(events[0]) });
  }
  return { changes: [...changed].map(([id, next]) => ({ previous: input.coupons.find(row => row.siteId === input.siteId && row.id === id)!, next })),
    facts, returnedCount: input.uses.length, policy: "return_original" as const };
}
