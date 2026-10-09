import { createAttendanceReviewFixture } from "./attendance-location-review-model";
import { createDiscussionFixture, discussionEvent } from "./attendance-location-discussion-model";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
export { discussionSite as siteId, discussionOwner as ownerId, discussionEmployee as employeeId, discussionWorker as workerId, discussionEvent as eventId } from "./attendance-location-discussion-model";
export function createExceptionWorkspaceFixture() {
  const review = createAttendanceReviewFixture({ eventId: discussionEvent, occurredAt: "2026-09-28T10:00:00.000001Z", workerName: "合成员工" });
  const discussion = createDiscussionFixture({ reviewState: () => review.detail().item.reviewState });
  const apiFetch: AttendanceApiFetch = (path, init) => {
    const route = new URL(path, "https://local.invalid").pathname;
    if (route === "/api/merchant-enterprise/attendance/location-reviews") return review.apiFetch(path, init);
    if (route === "/api/merchant-enterprise/attendance/location-discussion") return discussion.apiFetch(path, init);
    throw Error("synthetic_routes_only");
  };
  return { apiFetch, review, discussion,
    mode: (v: string) => { review.mode(v); discussion.mode(v); }, enabled: (v: boolean) => { review.enabled(v); discussion.enabled(v); } };
}
