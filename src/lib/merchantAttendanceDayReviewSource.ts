// Public normalized metadata only. The browser cannot certify the private SQL
// collector or turn these observations into an authorization or saved verdict.
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { freeze, safeTree, same, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseDayClassificationInput, type DayClassificationInput } from "./merchantAttendanceDayClassification";
import { DAY_REVIEW_RESPONSE_LIMIT, parseDayReviewQuery, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { parseDayReviewSavedResult, type DayReviewSavedResult } from "./merchantAttendanceDayReviewResult";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const DAY_REVIEW_SOURCE_VIEW_PROTOCOL = "attendance-day-review-preview-v1" as const;
export type DayReviewSourceQuery = Extract<DayReviewQuery, { mode: "candidates" | "preview" }>;
export type DayReviewSourceView = Readonly<{ protocol: typeof DAY_REVIEW_SOURCE_VIEW_PROTOCOL; kind: "candidates" | "preview";
  siteId: string; actorId: string; readAt: string; input: DayClassificationInput;
  saved: Extract<DayReviewSavedResult, { kind: "detail" }> | null; sourceChanged: boolean | null }>;
function invalid(): never { throw new MerchantAttendanceError("attendance_day_review_invalid"); }
export function dayReviewClassificationHead(saved: NonNullable<DayReviewSourceView["saved"]>): DayClassificationInput["source"]["caseHead"] {
  const h = saved.head, decision = h.latestDecision.receipt, self = h.latestSelf;
  return { caseId: h.caseId, target: h.target, revision: h.revision, coverage: "complete",
    latestDecision: { operationId: decision.operationId, revision: decision.revision, recordedAt: decision.recordedAt },
    latestSelf: self === null ? null : { caseId: h.caseId, operationId: self.receipt.operationId, revision: self.receipt.revision,
      recordedAt: self.receipt.recordedAt, actorId: self.receipt.actorId, decisionOperationId: self.decisionOperationId,
      ...(self.action === "explain" ? { kind: "explain" as const, claim: self.claim } : { kind: "dispute" as const, claim: null }) } };
}
export function parseDayReviewSourceView(raw: unknown, rawQuery: DayReviewSourceQuery, actorId: string): DayReviewSourceView {
  try {
    safeTree(raw, DAY_REVIEW_RESPONSE_LIMIT); const value = JSON.parse(JSON.stringify(raw));
    const q = parseDayReviewQuery(rawQuery), actor = uuid(actorId);
    if (q.mode !== "candidates" && q.mode !== "preview") invalid();
    const v = exact(value, ["protocol", "kind", "siteId", "actorId", "readAt", "input", "saved", "sourceChanged"]);
    if (v.protocol !== DAY_REVIEW_SOURCE_VIEW_PROTOCOL || v.kind !== q.mode || v.siteId !== q.siteId || v.actorId !== actor) invalid();
    const readAt = stamp(v.readAt), input = parseDayClassificationInput(v.input), t = input.target;
    if (input.siteId !== q.siteId || input.actorId !== actor || input.asOf !== readAt || t.workerId !== q.workerId || t.workDate !== q.workDate
      || q.mode === "candidates" && (t.kind !== "day" || t.slotId !== null)
      || q.mode === "preview" && t.slotId !== q.slotId) invalid();
    let saved: DayReviewSourceView["saved"] = null;
    if (v.saved !== null) {
      if (q.mode !== "preview" || q.caseId === null) invalid();
      const parsed = parseDayReviewSavedResult(v.saved, { siteId: q.siteId, access: "owner", mode: "detail", caseId: q.caseId }, actor);
      if (parsed.kind !== "detail" || parsed.operation !== null || parsed.replayed || parsed.readAt > readAt || !same(parsed.head.target, t)) invalid();
      saved = parsed;
    }
    if (q.mode === "preview" && (q.caseId === null) !== (saved === null)
      || !same(input.source.caseHead, saved === null ? null : dayReviewClassificationHead(saved))
      || v.sourceChanged !== (saved === null ? null : saved.head.latestDecision.sourceFingerprint !== input.source.fingerprint)) invalid();
    return freeze({ protocol: DAY_REVIEW_SOURCE_VIEW_PROTOCOL, kind: q.mode, siteId: q.siteId, actorId: actor, readAt, input, saved,
      sourceChanged: v.sourceChanged as boolean | null });
  } catch { return invalid(); }
}
