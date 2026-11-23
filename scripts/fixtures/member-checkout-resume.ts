// Synthetic DTOs only; no sessions, DB, credentials or provider IO.
import { cartReviewFixture } from "./member-checkout-cart-review";
import type { CartClientOriginal } from "../../src/lib/merchantCheckoutCartReview";
import type { PendingCheckoutSnapshot } from "../../src/lib/merchantCheckoutPendingIntent";
export async function checkoutResumeFixture(kind: "cart_points" | "cart_on_site" | "single_points" | "single_on_site" = "cart_points") {
  const x = await cartReviewFixture(kind.endsWith("on_site") ? "on_site" : "points"), siteId = x.f.siteId, operationKey = x.result.operationKey;
  let original: CartClientOriginal = { kind: "cart", result: x.result };
  if (kind === "single_points") original = { kind: "single", original: { method: "points", result: { version: 1, siteId, operationKey, resourceKind: "booking", resourceId: "R-original-synthetic", totalPoints: 100, couponCount: 0,
    closed: false, resource: { status: "active", updatedAt: "2026-11-23T12:00:00Z" }, cancellationAvailable: false, cancellationPolicy: null, cancellation: null } } };
  if (kind === "single_on_site") original = { kind: "single", original: { method: "on_site", result: { version: 2, siteId, operationKey,
    terms: { version: 2, method: "on_site", resourceKind: "booking", resourceId: "R-original-synthetic", currency: "eur", grossMinor: 1000, discountMinor: 0, dueMinor: 1000, capturedMinor: 0, totalPoints: null, couponCount: 0, paymentState: "unpaid" },
    closed: false, termsMatch: true, resource: { status: "active", updatedAt: "2026-11-23T12:00:00Z" }, collection: null, cancellation: null, cancellationAvailable: true,
    cancellationPolicy: { returnCoupons: false, advanceMinutes: 0, cancellableUntil: "2030-01-01T12:00:00Z" } } } };
  const snapshot: PendingCheckoutSnapshot = { version: 1, siteId, pending: { operationKey, generation: 1, reviewHash: "a".repeat(64), reviewRequired: false, original } };
  return { siteId, accountId: x.f.principal.accountId, userId: x.f.principal.userId, original, snapshot };
}
