// SYNTHETIC ONLY. No app session, database, environment credentials or live IO.
import { randomUUID } from "node:crypto";
import { cartQuoteFixture } from "./member-checkout-cart-quote";
import { cartConfirmationHash, cartSelectionIdentity, cartSubmissionIdentity, planCartSubmission } from "../../src/lib/merchantCheckoutCartSubmissionPlan.server";
import { reviewCheckoutCartPreviewSnapshot } from "../../src/lib/merchantCheckoutCartQuote.server";
import type { CartCheckoutResult } from "../../src/lib/merchantCheckoutCartResult";
export async function cartReviewFixture(method: "points" | "on_site" = "points") {
  const f = cartQuoteFixture(method), customer = { name: "Synthetic", title: "", email: "synthetic@example.invalid", phone: "000", note: "" };
  const preview = await reviewCheckoutCartPreviewSnapshot(f.refresh(), f.identity(), f.principal);
  const confirmationHash = cartConfirmationHash(preview.quote, f.principal);
  const request = { ...f.request, nonce: randomUUID(), confirmationHash, customer };
  const snapshotFor = (raw: unknown) => {
    const id = cartSubmissionIdentity(raw, f.principal), selection = cartSelectionIdentity(id, f.principal);
    return { version: 1 as const, purpose: "product_cart_submission" as const, siteId: id.siteId, operationKey: id.operationKey, principalKey: id.principalKey, requestHash: id.requestHash,
      quoteSnapshot: { ...structuredClone(f.snapshot), requestHash: selection.requestHash }, orderRows: [] };
  };
  const prepared = await planCartSubmission(snapshotFor(request), cartSubmissionIdentity(request, f.principal), f.principal);
  const result: CartCheckoutResult = { version: 3, purpose: "product_cart_result", siteId: f.siteId, operationKey: cartSubmissionIdentity(request, f.principal).operationKey,
    resourceKind: "order", resourceId: prepared.plan.record.id, method, currency: method === "points" ? null : "eur", ...prepared.plan.terms, capturedMinor: 0,
    lines: prepared.plan.lines.map(l => ({ offerId: l.offerId, offerRevision: l.offerRevision, productId: l.productId, title: l.title, quantity: l.quantity,
      points: l.points, grossMinor: l.grossMinor, discountMinor: l.discountMinor, dueMinor: l.dueMinor, returnPoints: l.returnPoints, returnCoupons: l.returnCoupons, couponCount: l.couponClaims.length })),
    closed: false, reviewRequired: false, cancellationAvailable: true, resource: { status: "pending", updatedAt: new Date().toISOString() }, cancellation: null };
  return { f, customer, request, snapshotFor, prepared, result, review: { ok: true, replayed: false, ...preview, confirmationHash } };
}
