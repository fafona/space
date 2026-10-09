import { executeOutageReview, outageReviewSiteEnabled } from "@/lib/merchantAttendanceOutageReview.server";
import { createOutageRouteDependencies, handleOutageRoute } from "@/lib/merchantAttendanceOutageRoute.server";

export const outageReviewsDependencies = createOutageRouteDependencies<"reviews">(executeOutageReview, outageReviewSiteEnabled);
export function handleOutageReviews(request: Request, overrides: Partial<typeof outageReviewsDependencies> = {}) {
  return handleOutageRoute("reviews", request, { ...outageReviewsDependencies, ...overrides });
}
