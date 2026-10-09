// Public synthetic UI protocol only. No SQL completeness, real Auth or source
// authority is claimed by these values; actual source projection is separate.
import { DAY_CLASSIFICATION_INPUT_PROTOCOL, type DayClassificationInput } from "../../src/lib/merchantAttendanceDayClassification";
import { DAY_REVIEW_SOURCE_VIEW_PROTOCOL, dayReviewClassificationHead, type DayReviewSourceView } from "../../src/lib/merchantAttendanceDayReviewSource";
import { DAY_REVIEW_PROTOCOL } from "../../src/lib/merchantAttendanceDayReviewContract";
import type { DayReviewCaseHead } from "../../src/lib/merchantAttendanceDayReviewResult";
export const dayUiId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const dayUiOwner = dayUiId(1), dayUiSelf = dayUiId(3), dayUiWorker = dayUiId(4), dayUiSite = "99990199", dayUiDate = "2026-10-07";
export const dayUiAt = "2026-10-08T12:00:00.000001Z";
export function dayUiSource(kind: "candidates" | "preview" = "candidates", plan = false, head: DayReviewCaseHead | null = null): DayReviewSourceView {
  const identity = { workerId: dayUiWorker, employeeId: dayUiId(2), employeeAuthUserId: dayUiSelf };
  const plans = [1, 2].map(n => ({ ...identity, slotId: dayUiId(10 + n), revision: 1, locationId: dayUiId(5), workDate: dayUiDate, timeZone: "UTC",
    startAt: `2026-10-07T${n === 1 ? "08" : "16"}:00:00.000000Z`, endAt: `2026-10-07T${n === 1 ? "12" : "20"}:00:00.000000Z`, cancelled: false, hasPublicationEvidence: true }));
  const input: DayClassificationInput = { protocol: DAY_CLASSIFICATION_INPUT_PROTOCOL, siteId: dayUiSite, actorId: dayUiOwner, asOf: dayUiAt,
    target: { ...identity, kind: plan ? "plan" : "day", workDate: dayUiDate, timeZone: "UTC", fromAt: plan ? plans[0].startAt : "2026-10-07T00:00:00.000000Z",
      toAt: plan ? plans[0].endAt : "2026-10-08T00:00:00.000000Z", slotId: plan ? plans[0].slotId : null },
    source: { fingerprint: "a".repeat(64), coverage: "complete", identity: "matching", current: true, plans: plan ? [plans[0]] : plans,
      records: [], calendar: [{ siteId: dayUiSite, entryId: dayUiId(20), operationId: dayUiId(20), revision: 1, kind: "closure", status: "created", locationId: null,
        timeZone: "UTC", fromDate: dayUiDate, throughDate: dayUiDate, fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z", recordedAt: "2026-10-06T12:00:00.000001Z" }],
      pending: [], conflicts: [], arrangements: [], caseHead: null } };
  const saved = head === null ? null : { protocol: DAY_REVIEW_PROTOCOL, kind: "detail" as const, siteId: dayUiSite, actorId: dayUiOwner, readAt: dayUiAt,
    access: "owner" as const, head, operation: null, replayed: false };
  if (saved) Object.assign(input, { source: { ...input.source, caseHead: dayReviewClassificationHead(saved) } });
  return { protocol: DAY_REVIEW_SOURCE_VIEW_PROTOCOL, kind, siteId: dayUiSite, actorId: dayUiOwner, readAt: dayUiAt, input, saved,
    sourceChanged: head === null ? null : head.latestDecision.sourceFingerprint !== input.source.fingerprint };
}
export function dayUiHead(plan = true): DayReviewCaseHead {
  return { caseId: dayUiId(30), target: dayUiSource("preview", plan).input.target, openedAt: dayUiAt, revision: 1, latestSelf: null, needsResponse: false,
    latestDecision: { action: "decide", reason: "合成继续核查，尚无本人说明", outcome: "follow_up", sourceFingerprint: "a".repeat(64), observations: ["no_record"],
      calendarReference: null, selfStatementOperationId: null, receipt: { operationId: dayUiId(31), caseId: dayUiId(30), revision: 1, action: "decide", actorId: dayUiOwner,
        recordedAt: dayUiAt, commandFingerprint: "b".repeat(64) } } };
}
