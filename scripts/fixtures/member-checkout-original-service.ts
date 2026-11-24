// Synthetic DTOs only. Not a cancellation implementation or database fixture.
import { checkoutResumeFixture } from "./member-checkout-resume";
import type { OriginalServiceReview } from "../../src/lib/merchantCheckoutOriginalService";
export async function originalServiceFixture(kind: Parameters<typeof checkoutResumeFixture>[0] = "single_points") {
  const f = await checkoutResumeFixture(kind), original = structuredClone(f.original);
  const result = original.kind === "cart" ? original.result : original.original.result;
  if (original.kind === "single" && original.original.method === "points") {
    original.original.result.cancellationAvailable = true;
    original.original.result.cancellationPolicy = { returnPoints: true, returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2036-01-01T12:00:00Z" };
  }
  const review: OriginalServiceReview = { version: 1, siteId: f.siteId, operationKey: f.snapshot.pending!.operationKey, reviewHash: "a".repeat(64), original, reviewRequired: false };
  const closed: OriginalServiceReview = structuredClone(review), r = closed.original.kind === "cart" ? closed.original.result : closed.original.original.result;
  r.closed = true; r.cancellationAvailable = false; r.resource = { status: "cancelled", updatedAt: "2026-11-24T12:00:00Z" }; closed.reviewHash = "b".repeat(64);
  if (closed.original.kind === "cart") r.cancellation = { pointsReturned: closed.original.result.lines.reduce<number>((s, l) => s + (l.returnPoints ? l.points ?? 0 : 0), 0), couponsReturned: 0, stockReleased: 2, cancelledAt: "2026-11-24T12:00:00Z" };
  else if (closed.original.original.method === "points") closed.original.original.result.cancellation = { pointsReturned: 100, couponsReturned: 0, stockReleased: 1, cancelledAt: "2026-11-24T12:00:00Z" };
  else closed.original.original.result.cancellation = { version: 2, siteId: f.siteId, operationKey: review.operationKey, method: "on_site", resourceKind: "booking", resourceId: "R-original-synthetic", closed: true, pointsReturned: 0, cashReturnedMinor: 0, couponsReturned: 0, stockReleased: 1, cancelledAt: "2026-11-24T12:00:00Z" };
  const cancellation = { version: 1, siteId: f.siteId, operationKey: review.operationKey, requestedReviewHash: review.reviewHash, replayed: false, review: closed };
  return { ...f, review, closed, cancellation, input: { siteId: f.siteId, operationKey: review.operationKey, reviewHash: review.reviewHash, expectedUpdatedAt: result.resource!.updatedAt } };
}
